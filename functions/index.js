// functions/index.js
// Firebase Cloud Functions - 定期購入の毎日自動登録

const functions = require("firebase-functions");
const admin     = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * 毎日 00:00 JST に実行するスケジュール関数。
 * 全ユーザーの subscriptions コレクションを走査し、
 * nextPurchaseDate が今日の doc を transactions に追加して nextPurchaseDate を更新する。
 *
 * ■ Firestore インデックス（要作成）
 *   コレクショングループ: subscriptions
 *   フィールド: nextPurchaseDate (昇順)
 *   Firebase Console → Firestore → インデックス → 複合インデックス追加、
 *   または `firebase deploy --only firestore:indexes` で自動作成
 */
exports.dailySubscriptionJob = functions
  .region("asia-northeast1")
  .pubsub.schedule("0 0 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async (_context) => {
    const today = getTodayStr(); // "YYYYMMDD"
    functions.logger.info(`[dailySubscriptionJob] 開始: ${today}`);

    // コレクショングループクエリ: 全ユーザーの subscriptions から今日が nextPurchaseDate のものを取得
    const snapshot = await db
      .collectionGroup("subscriptions")
      .where("nextPurchaseDate", "==", today)
      .get();

    if (snapshot.empty) {
      functions.logger.info("[dailySubscriptionJob] 対象なし");
      return null;
    }

    // Firestore の batch write（1バッチ最大500操作）
    // 1件につき set + update の2操作なので、250件以上は複数バッチに分割する
    const BATCH_LIMIT = 250;
    const docs = snapshot.docs;
    let count  = 0;

    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const chunk = docs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();

      chunk.forEach((subDoc) => {
        const data = subDoc.data();

        // uid は subscriptions コレクションの親ドキュメント (users/{uid}) の ID
        const uid = subDoc.ref.parent.parent.id;

        // transactions に追加（denormalized で保存）
        const txRef = db.collection(`users/${uid}/transactions`).doc();
        batch.set(txRef, {
          itemId:    data.itemId,
          itemName:  data.itemName   || "",
          methodId:  data.methodId,
          methodName: data.methodName || "",
          categoryId: data.categoryId,
          amount:    data.amount,
          date:      today,
          memo:      data.memo       || "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // nextPurchaseDate を更新
        const nextDate = calcNextDate(today, data.frequencyType, Number(data.frequencyValue));
        batch.update(subDoc.ref, { nextPurchaseDate: nextDate });

        count++;
      });

      await batch.commit();
    }

    functions.logger.info(`[dailySubscriptionJob] 完了: ${count}件処理`);
    return null;
  });

// ─────────────────────────────────────────
// ヘルパー関数
// ─────────────────────────────────────────

/**
 * Asia/Tokyo の今日の日付を "YYYYMMDD" 形式で返す
 * @returns {string}
 */
function getTodayStr() {
  const now = new Date();
  // Cloud Functions のタイムゾーンが UTC の場合でも JST で取得
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * 頻度に応じて次回購入日を計算し "YYYYMMDD" で返す
 * @param {string} todayStr     - "YYYYMMDD"
 * @param {string} frequencyType  - "daily" | "weekly" | "monthly" | "yearly"
 * @param {number} frequencyValue - 頻度の値
 * @returns {string} "YYYYMMDD"
 */
function calcNextDate(todayStr, frequencyType, frequencyValue) {
  const y = parseInt(todayStr.slice(0, 4), 10);
  const m = parseInt(todayStr.slice(4, 6), 10) - 1; // 0-indexed
  const d = parseInt(todayStr.slice(6, 8), 10);
  const date = new Date(y, m, d);
  const v    = Number(frequencyValue);

  switch (frequencyType) {
    case "daily":   date.setDate(date.getDate() + v);         break;
    case "weekly":  date.setDate(date.getDate() + v * 7);     break;
    case "monthly": date.setMonth(date.getMonth() + v);       break;
    case "yearly":  date.setFullYear(date.getFullYear() + v); break;
    default:
      functions.logger.warn(`[calcNextDate] 不明な頻度タイプ: ${frequencyType}`);
      return todayStr;
  }

  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, "0");
  const nd = String(date.getDate()).padStart(2, "0");
  return `${ny}${nm}${nd}`;
}
