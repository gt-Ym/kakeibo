/**
 * daily_trigger.gs
 * 毎日1回実行する定期購入の自動登録処理
 *
 * ■ トリガー設定方法
 *   GASエディタ → 左メニュー「トリガー」→「トリガーを追加」
 *   - 実行する関数: dailySubscriptionJob
 *   - イベントのソース: 時間主導型
 *   - 時間ベースのトリガーのタイプ: 日タイマー
 *   - 時刻: 任意（例: 午前0時〜1時）
 *
 * ■ 必要な OAuth スコープ（appsscript.json に記載）
 *   - https://www.googleapis.com/auth/spreadsheets
 *   - https://www.googleapis.com/auth/datastore
 */

const FIRESTORE_PROJECT_ID = "kakeibo-e8dc2";

/**
 * メイン処理 - タイムトリガーから呼び出す
 * subscriptions シートを全件走査し、nextPurchaseDate が今日の行を
 * Firestore の users/{uid}/transactions へ追加し、次回購入日を更新する
 */
function dailySubscriptionJob() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("subscriptions");

  if (!sheet) {
    Logger.log("[daily_trigger] subscriptionsシートが見つかりません");
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log("[daily_trigger] 定期購入データがありません");
    return;
  }

  const today    = getTodayDate();
  const todayStr = toDateString(today); // "yyyyMMdd" で比較

  // カラム順: 0:subscription_id, 1:user_id, 2:item_name, 3:method_name,
  //           4:category_id, 5:amount, 6:start_date, 7:frequency_type,
  //           8:frequency_value, 9:next_purchase_date, 10:memo, 11:firestore_id
  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  let processed = 0;

  // 同一ユーザーの users/{uid} を繰り返し読まないためのキャッシュ
  const userDataCache = {};

  data.forEach((row, i) => {
    const nextPurchaseDateRaw = row[9];
    const nextDateStr         = toDateString(nextPurchaseDateRaw);

    // 今日が次回購入日でなければスキップ
    if (nextDateStr !== todayStr) return;

    const userId      = String(row[1]);
    const itemName    = String(row[2]);
    const methodName  = String(row[3]);
    const categoryId  = String(row[4]);
    const amount      = Number(row[5]);
    const memo        = String(row[10] || "");
    const firestoreId = String(row[11] || "");

    // subscriptions ドキュメントから itemId / methodId を取得
    let itemId   = "";
    let methodId = "";
    if (firestoreId) {
      const subFields = getFirestoreDocument(`users/${userId}/subscriptions/${firestoreId}`);
      itemId   = extractString(subFields, "itemId");
      methodId = extractString(subFields, "methodId");
    }

    // users/{uid} ドキュメントから userName / groupId を取得（キャッシュあり）
    if (!userDataCache[userId]) {
      const userFields = getFirestoreDocument(`users/${userId}`);
      userDataCache[userId] = {
        userName:   extractString(userFields, "userName"),
        groupId:    extractString(userFields, "groupId"),
        lineId: extractString(userFields, "lineId"),
      };
    }
    const { userName, groupId, lineId } = userDataCache[userId];

    // 年月（予算チェック・月次集計で共用）
    const txYear  = todayStr.slice(0, 4);
    const txMonth = todayStr.slice(4, 6);

    // 予算超過チェック（Firestore 書き込み前に実行して登録前の月次合計を参照する）
    checkAndNotifyBudgetOver(userId, itemId, itemName, categoryId, amount, txYear, txMonth, lineId);

    // Firestore にトランザクションを追加
    const success = writeTransactionToFirestore(userId, {
      itemId,
      itemName,
      methodId,
      methodName,
      categoryId,
      amount,
      date: todayStr,
      memo,
      userName,
      groupId,
    });

    if (!success) {
      Logger.log(`[daily_trigger] Firestore書き込み失敗: userId=${userId}, row=${i + 2}`);
      return;
    }

    processed++;

    // 定期購入登録の LINE 通知
    if (lineId) {
      Logger.log(`[daily_trigger] LINE通知 lineId="${lineId}"`);
      const dateFormatted = `${todayStr.slice(0,4)}/${todayStr.slice(4,6)}/${todayStr.slice(6,8)}`;
      const message = `${userName}さん、家計簿が更新されました！\n日付：${dateFormatted}\n項目：${itemName}\n方法：${methodName}\n金額：${amount}円\nメモ：${memo}`;
      const lineOk = sendLineNotification(lineId, message);
      if (!lineOk) {
        Logger.log(`[daily_trigger] LINE通知失敗: userId=${userId}`);
      }
    }

    // 次回購入日を計算する
    const frequencyType  = String(row[7]);
    const frequencyValue = Number(row[8]);
    const nextDate    = calcNextDate(today, frequencyType, frequencyValue);
    const nextDateStr2 = toDateString(nextDate);

    // スプレッドシートの next_purchase_date を更新（J列 = 10列目）
    sheet.getRange(i + 2, 10).setValue(nextDate);

    // Firestore の subscriptions ドキュメントの nextPurchaseDate を更新
    if (firestoreId) {
      const fsSuccess = updateSubscriptionNextDate(userId, firestoreId, nextDateStr2);
      if (!fsSuccess) {
        Logger.log(`[daily_trigger] Firestore subscriptions更新失敗: userId=${userId}, firestoreId=${firestoreId}`);
      }
    } else {
      Logger.log(`[daily_trigger] firestoreId未設定のためFirestore更新スキップ: userId=${userId}, row=${i + 2}`);
    }

    // 月次集計ドキュメントを更新
    const summarySuccess = updateMonthlySummary(userId, txYear, txMonth);
    if (!summarySuccess) {
      Logger.log(`[daily_trigger] 月次集計更新失敗: userId=${userId}, ${txYear}/${txMonth}`);
    }
  });

  Logger.log(`[daily_trigger] 完了: ${processed}件処理しました（${todayStr}）`);
}

/**
 * Firestore REST API を使用して users/{uid}/transactions に1件追加する
 * ScriptApp.getOAuthToken() を使用するため、GASスクリプトを実行するGoogleアカウントが
 * Firebaseプロジェクトの Owner または Editor 権限を持っている必要がある
 *
 * @param {string} uid
 * @param {Object} data - { itemId, itemName, methodId, methodName, categoryId, amount, date, memo, userName, groupId }
 * @returns {boolean} 成功した場合 true
 */
function writeTransactionToFirestore(uid, data) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${uid}/transactions`;

  const body = {
    fields: {
      itemId:        { stringValue: data.itemId    || "" },
      itemName:      { stringValue: data.itemName  || "" },
      methodId:      { stringValue: data.methodId  || "" },
      methodName:    { stringValue: data.methodName || "" },
      categoryId:    { stringValue: String(data.categoryId) },
      amount:        { integerValue: String(data.amount) },
      date:          { stringValue: String(data.date) },
      memo:          { stringValue: data.memo || "" },
      uid:           { stringValue: uid },
      userName:      { stringValue: data.userName  || "" },
      groupId:       { stringValue: data.groupId   || "" },
      isGroupShared: { booleanValue: false },
      createdAt:     { timestampValue: new Date().toISOString() },
    },
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method:  "post",
      headers: {
        "Authorization": "Bearer " + ScriptApp.getOAuthToken(),
        "Content-Type":  "application/json",
      },
      payload:              JSON.stringify(body),
      muteHttpExceptions:   true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log(`[daily_trigger] Firestore APIエラー: ${code} ${response.getContentText()}`);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log(`[daily_trigger] Firestore書き込み例外: ${e.message}`);
    return false;
  }
}

/**
 * Firestore REST API を使用して users/{uid}/subscriptions/{firestoreId} の
 * nextPurchaseDate フィールドだけを PATCH する
 *
 * @param {string} uid
 * @param {string} firestoreId  - subscriptions ドキュメントID
 * @param {string} nextDateStr  - 更新後の日付 ("yyyyMMdd")
 * @returns {boolean} 成功した場合 true
 */
function updateSubscriptionNextDate(uid, firestoreId, nextDateStr) {
  // updateMask.fieldPaths で更新するフィールドを限定することで他フィールドを上書きしない
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${uid}/subscriptions/${firestoreId}?updateMask.fieldPaths=nextPurchaseDate`;

  const body = {
    fields: {
      nextPurchaseDate: { stringValue: nextDateStr },
    },
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method:            "patch",
      headers: {
        "Authorization": "Bearer " + ScriptApp.getOAuthToken(),
        "Content-Type":  "application/json",
      },
      payload:           JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log(`[daily_trigger] subscriptions PATCH エラー: ${code} ${response.getContentText()}`);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log(`[daily_trigger] subscriptions PATCH 例外: ${e.message}`);
    return false;
  }
}

/**
 * 指定年月のトランザクションを集計し monthlySummary ドキュメントを更新する。
 * Firestore の runQuery エンドポイントで日付範囲フィルタを適用してサーバー側絞り込みする。
 *
 * monthlySummary ドキュメント構造:
 *   users/{uid}/monthlySummary/{year}/months/{month}
 *   { "<categoryId>": { items: { "<名前>": 合計 }, methods: { "<名前>": 合計 }, total: 合計 },
 *     updatedAt: <timestamp> }
 *
 * @param {string} uid    Firebase Auth の UID
 * @param {string} year   4桁の年 ("2026")
 * @param {string} month  2桁の月 ("01"〜"12")
 * @returns {boolean} 成功した場合 true
 */
function updateMonthlySummary(uid, year, month) {
  const dateFrom = `${year}${month}01`;
  const dateTo   = `${year}${month}31`;

  // ── 1. 該当月のトランザクションを runQuery で取得 ──────────────────
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${uid}:runQuery`;

  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: "transactions" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "date" },
                op:    "GREATER_THAN_OR_EQUAL",
                value: { stringValue: dateFrom },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "date" },
                op:    "LESS_THAN_OR_EQUAL",
                value: { stringValue: dateTo },
              },
            },
          ],
        },
      },
    },
  };

  let txDocs;
  try {
    const queryRes  = UrlFetchApp.fetch(queryUrl, {
      method:             "post",
      headers: {
        "Authorization": "Bearer " + ScriptApp.getOAuthToken(),
        "Content-Type":  "application/json",
      },
      payload:            JSON.stringify(queryBody),
      muteHttpExceptions: true,
    });
    if (queryRes.getResponseCode() !== 200) {
      Logger.log(`[daily_trigger] runQuery エラー (${queryRes.getResponseCode()}): ${queryRes.getContentText()}`);
      return false;
    }
    txDocs = JSON.parse(queryRes.getContentText());
  } catch (e) {
    Logger.log(`[daily_trigger] runQuery 例外: ${e.message}`);
    return false;
  }

  // ── 2. カテゴリ別・項目名・決済方法名で集計 ─────────────────────────
  const catSummary = {};

  txDocs.forEach(item => {
    if (!item.document) return; // 結果なしの場合に含まれる空エントリを無視
    const f = item.document.fields || {};

    const catId  = f.categoryId ? (f.categoryId.stringValue || "") : "";
    if (!catId) return;

    const nameI  = f.itemName   ? (f.itemName.stringValue   || "不明") : "不明";
    const nameM  = f.methodName ? (f.methodName.stringValue || "不明") : "不明";
    const amount = f.amount
      ? (Number(f.amount.integerValue || f.amount.doubleValue || 0))
      : 0;

    if (!catSummary[catId]) catSummary[catId] = { items: {}, methods: {}, total: 0 };
    catSummary[catId].items[nameI]   = (catSummary[catId].items[nameI]   || 0) + amount;
    catSummary[catId].methods[nameM] = (catSummary[catId].methods[nameM] || 0) + amount;
    catSummary[catId].total         += amount;
  });

  // ── 3. Firestore の monthlySummary ドキュメントを書き込み ────────────
  // Firestore REST API の set (PATCH with documentUpdateMask なし = 上書き)
  const summaryUrl = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${uid}/monthlySummary/${year}/months/${month}`;

  // catSummary を Firestore フィールド形式に変換
  const fields = {
    updatedAt: { timestampValue: new Date().toISOString() },
  };
  Object.entries(catSummary).forEach(([catId, data]) => {
    // items / methods はマップ型で保存
    const itemsMap = {};
    Object.entries(data.items).forEach(([k, v]) => { itemsMap[k] = { integerValue: String(v) }; });
    const methodsMap = {};
    Object.entries(data.methods).forEach(([k, v]) => { methodsMap[k] = { integerValue: String(v) }; });

    fields[catId] = {
      mapValue: {
        fields: {
          items:   { mapValue: { fields: itemsMap   } },
          methods: { mapValue: { fields: methodsMap } },
          total:   { integerValue: String(data.total) },
        },
      },
    };
  });

  try {
    const writeRes = UrlFetchApp.fetch(summaryUrl, {
      method:             "patch",
      headers: {
        "Authorization": "Bearer " + ScriptApp.getOAuthToken(),
        "Content-Type":  "application/json",
      },
      payload:            JSON.stringify({ fields }),
      muteHttpExceptions: true,
    });
    if (writeRes.getResponseCode() !== 200) {
      Logger.log(`[daily_trigger] monthlySummary 書き込みエラー (${writeRes.getResponseCode()}): ${writeRes.getContentText()}`);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log(`[daily_trigger] monthlySummary 書き込み例外: ${e.message}`);
    return false;
  }
}

/**
 * Firestore REST API を使用して任意のドキュメントを GET する汎用ヘルパー
 *
 * @param {string} docPath  "users/{uid}/subscriptions/{id}" などの相対パス
 * @returns {Object|null}   Firestore の fields オブジェクト、取得失敗時は null
 */
function getFirestoreDocument(docPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${docPath}`;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: {
        "Authorization": "Bearer " + ScriptApp.getOAuthToken(),
        "Content-Type":  "application/json",
      },
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log(`[daily_trigger] Firestore GET エラー (${code}): ${docPath}`);
      return null;
    }
    const doc = JSON.parse(response.getContentText());
    return doc.fields || null;
  } catch (e) {
    Logger.log(`[daily_trigger] Firestore GET 例外: ${e.message}`);
    return null;
  }
}

/**
 * LINE Messaging API を使用してプッシュ通知を送信する
 * スクリプトプロパティに LINE_CHANNEL_ACCESS_TOKEN を設定しておく必要がある
 *
 * @param {string} lineId   通知先の LINE ユーザーID
 * @param {string} message  送信するテキストメッセージ
 * @returns {boolean} 成功した場合 true
 */
function sendLineNotification(lineId, message) {
  const token = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) {
    Logger.log("[daily_trigger] LINE_CHANNEL_ACCESS_TOKEN が設定されていません");
    return false;
  }

  const url  = "https://api.line.me/v2/bot/message/push";
  const body = {
    to:       lineId,
    messages: [{ type: "text", text: message }],
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method:  "post",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type":  "application/json",
      },
      payload:            JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log(`[daily_trigger] LINE通知APIエラー: ${code} ${response.getContentText()}`);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log(`[daily_trigger] LINE通知例外: ${e.message}`);
    return false;
  }
}

/**
 * Firestore fields オブジェクトから文字列フィールドを安全に取り出す
 *
 * @param {Object|null} fields  getFirestoreDocument() の戻り値
 * @param {string}      key     フィールド名
 * @returns {string}
 */
function extractString(fields, key) {
  if (!fields || !fields[key]) return "";
  return fields[key].stringValue || "";
}

/**
 * 今日の日付を 00:00:00 で返す
 * @returns {Date}
 */
function getTodayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Date または文字列を "yyyyMMdd" 形式に正規化する
 * @param {Date|string} value
 * @returns {string}
 */
function toDateString(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyyMMdd");
  }
  return String(value).replace(/[\/\-]/g, "").slice(0, 8);
}

/**
 * 頻度に応じて次回購入日を計算する
 * @param {Date}   baseDate
 * @param {string} type     - "daily" | "weekly" | "monthly" | "yearly"
 * @param {number} value
 * @returns {Date}
 */
function calcNextDate(baseDate, type, value) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());

  switch (type) {
    case "daily":   d.setDate(d.getDate() + value);          break;
    case "weekly":  d.setDate(d.getDate() + value * 7);      break;
    case "monthly": d.setMonth(d.getMonth() + value);        break;
    case "yearly":  d.setFullYear(d.getFullYear() + value);  break;
    default:
      Logger.log("[daily_trigger] 不明な頻度タイプ: " + type);
  }

  return d;
}

