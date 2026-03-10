// import.js
// item.csv / method.csv / sample.csv を読んで Firestore へ一括インポートする
//
// 実行方法:
//   cd e:/_html/kakeibo/import
//   npm install
//   node import.js

const admin = require("firebase-admin");
const fs    = require("fs");

// ══════════════════════════════════════════════════════════════
// ★ 設定（ここを埋めてから実行してください）
// ══════════════════════════════════════════════════════════════

// Firebase Authentication のユーザー UID
const UID = "lBF5i2FlCMZW9dANZkO3cK39LUj1";

// ユーザーの表示名（transactions の userName フィールドに保存）
const USER_NAME = "daiwa"; // ← ログイン時のユーザー名に合わせてください

// ユーザーが所属するグループID（users/{uid}.groupId と一致させてください）
// グループなし/未設定の場合は空文字 "" のままにしてください
const GROUP_ID = "1"; // ← Firestore の users/{uid}.groupId の値

// ══════════════════════════════════════════════════════════════
// 以下は変更不要
// ══════════════════════════════════════════════════════════════

admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccount.json")),
});
const db = admin.firestore();

// ─────────────────────────────────────────
// CSV パーサー（タブ・カンマ両対応、BOM除去、ダブルクォート対応）
// ─────────────────────────────────────────
function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, "utf-8").replace(/^\uFEFF/, "");
  const lines   = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers   = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ""));

  return lines.slice(1)
    .filter(l => l.trim() !== "")
    .map(line => {
      const values = splitLine(line, delimiter);
      return headers.reduce((obj, h, i) => {
        obj[h] = (values[i] || "").trim().replace(/^"|"$/g, "");
        return obj;
      }, {});
    });
}

function splitLine(line, delimiter) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === delimiter && !inQ) { result.push(cur); cur = ""; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

// ─────────────────────────────────────────
// メイン処理
// ─────────────────────────────────────────
async function main() {
  // 設定チェック
  if (UID === "YOUR_USER_UID") {
    console.error("❌ import.js の UID を設定してください。");
    process.exit(1);
  }

  // ① item.csv を読む
  console.log("▶ item.csv 読み込み中...");
  const itemRows = parseCSV("./item.csv");
  console.log(`  ${itemRows.length} 件`);

  // ② method.csv を読む
  console.log("▶ method.csv 読み込み中...");
  const methodRows = parseCSV("./method.csv");
  console.log(`  ${methodRows.length} 件`);

  // ③ sample.csv を読む
  console.log("▶ sample.csv 読み込み中...");
  const sampleRows = parseCSV("./sample.csv");
  console.log(`  ${sampleRows.length} 件`);

  // ④ items をグローバルコレクション items/{itemId} へ登録
  //    GASのitem_id → Firestoreのdoc IDマップを作成
  console.log("\n▶ items（グローバル）を Firestore へ登録中...");
  const itemIdMap = {}; // { "1": { firestoreId, name, categoryId } }

  for (const row of itemRows) {
    const gasId  = row["item_id"];
    const name   = row["item_name"];
    const catId  = String(row["category_id"]);

    // 同名・同カテゴリが既に存在するか確認（冪等性のため）
    const existing = await db.collection("items")
      .where("name",       "==", name)
      .where("categoryId", "==", catId)
      .limit(1).get();

    let firestoreId;
    if (!existing.empty) {
      firestoreId = existing.docs[0].id;
      console.log(`  スキップ（既存）: [${catId}] ${name}`);
    } else {
      const ref = await db.collection("items").add({ name, categoryId: catId });
      firestoreId = ref.id;
      console.log(`  登録: [${catId}] ${name} → ${firestoreId}`);
    }
    itemIdMap[gasId] = { firestoreId, name, categoryId: catId };
  }

  // ⑤ methods を登録
  //    group_flag=FALSE → users/{uid}/methods
  //    group_flag=TRUE  → groups/{groupId}/methods
  console.log("\n▶ methods を Firestore へ登録中...");
  const methodIdMap = {}; // { "1": { firestoreId, name, isGroupShared } }

  for (const row of methodRows) {
    const gasId       = row["method_id"];
    const name        = row["method_name"];
    const catId       = String(row["category_id"]);
    const isGroupShared = String(row["group_flag"]).toUpperCase() === "TRUE";

    let collectionRef;
    if (isGroupShared && GROUP_ID) {
      collectionRef = db.collection(`groups/${GROUP_ID}/methods`);
    } else {
      collectionRef = db.collection(`users/${UID}/methods`);
    }

    const existing = await collectionRef
      .where("name",       "==", name)
      .where("categoryId", "==", catId)
      .limit(1).get();

    let firestoreId;
    if (!existing.empty) {
      firestoreId = existing.docs[0].id;
      console.log(`  スキップ（既存）: [${catId}] ${name} (${isGroupShared ? "グループ共有" : "個人"})`);
    } else {
      const ref = await collectionRef.add({ name, categoryId: catId, isGroupShared });
      firestoreId = ref.id;
      console.log(`  登録: [${catId}] ${name} → ${firestoreId} (${isGroupShared ? "グループ共有" : "個人"})`);
    }
    methodIdMap[gasId] = { firestoreId, name, isGroupShared };
  }

  // ⑥ transactions を Firestore へ一括登録（400件ずつ batch）
  console.log("\n▶ transactions を Firestore へ登録中...");
  const BATCH_SIZE = 400;
  let batch   = db.batch();
  let count   = 0;
  let total   = 0;
  let skipped = 0;

  for (const row of sampleRows) {
    const gasItemId   = row["項目ID"];
    const gasMethodId = row["方法ID"];
    const amount      = row["金額"];
    const date        = (row["日付YYYYmmdd"] || "").replace(/[\/\-]/g, "").slice(0, 8);
    const memo        = row["メモ"] || "";

    const itemInfo   = itemIdMap[gasItemId];
    const methodInfo = methodIdMap[gasMethodId];

    if (!itemInfo) {
      console.warn(`  ⚠ 行${total + 1}: 項目ID "${gasItemId}" がitem.csvにありません → スキップ`);
      skipped++; total++; continue;
    }
    if (!methodInfo) {
      console.warn(`  ⚠ 行${total + 1}: 方法ID "${gasMethodId}" がmethod.csvにありません → スキップ`);
      skipped++; total++; continue;
    }
    if (!date || date.length !== 8) {
      console.warn(`  ⚠ 行${total + 1}: 日付が不正 "${row["日付YYYYmmdd"]}" → スキップ`);
      skipped++; total++; continue;
    }

    const ref = db.collection(`users/${UID}/transactions`).doc();
    batch.set(ref, {
      itemId:        itemInfo.firestoreId,
      itemName:      itemInfo.name,
      methodId:      methodInfo.firestoreId,
      methodName:    methodInfo.name,
      categoryId:    itemInfo.categoryId,
      amount:        Number(amount) || 0,
      date,
      memo,
      uid:           UID,
      userName:      USER_NAME,
      groupId:       GROUP_ID || "",
      isGroupShared: methodInfo.isGroupShared,
      createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    });

    count++;
    total++;

    if (count >= BATCH_SIZE) {
      await batch.commit();
      console.log(`  ${total} 件処理済み...`);
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`\n✅ 完了`);
  console.log(`   items:        ${Object.keys(itemIdMap).length} 件（グローバル）`);
  console.log(`   methods:      ${Object.keys(methodIdMap).length} 件（個人 + グループ共有）`);
  console.log(`   transactions: ${total - skipped} 件登録 / ${skipped} 件スキップ`);
}

main().catch(err => {
  console.error("❌ エラー:", err.message);
  process.exit(1);
});
