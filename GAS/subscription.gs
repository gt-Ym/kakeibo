/**
 * subscriptionsシートからユーザーの定期購入データを取得する
 * main_get.gs の getSubscriptionsData() から呼び出される
 *
 * @param {Object} params - e.parameter（userId 必須）
 * @returns {Array|Object} - 定期購入リスト、またはエラーオブジェクト
 */
function getSubscriptions(params) {
  const userId = params.userId;

  if (!userId) {
    return { error: "userId is required" };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("subscriptions");

  if (!sheet) {
    return { error: "subscriptionsシートが見つかりません" };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return []; // データなし
  }

  // カラム順: 0:subscription_id, 1:user_id, 2:item_name, 3:method_name,
  //           4:category_id, 5:amount, 6:start_date, 7:frequency_type,
  //           8:frequency_value, 9:next_purchase_date, 10:memo, 11:firestore_id
  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();

  return data
    .filter(row => String(row[1]) === String(userId)) // user_id 一致のみ
    .map(row => ({
      subscriptionId:   row[0],
      userId:           row[1],
      itemName:         row[2],
      methodName:       row[3],
      categoryId:       String(row[4]),
      amount:           row[5],
      startDate:        formatDateYMD(row[6]),
      frequencyType:    row[7],
      frequencyValue:   row[8],
      nextPurchaseDate: formatDateYMD(row[9]),
      memo:             row[10] || ""
    }));
}

/**
 * GAS の Date オブジェクトまたは文字列を "YYYY/MM/DD" に変換するユーティリティ
 */
function formatDateYMD(date) {
  if (!date) return "";
  if (date instanceof Date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy/MM/dd");
  }
  // 文字列（YYYYMMDD 等）はそのまま渡す
  const str = String(date).replace(/-/g, "");
  if (str.length === 8) {
    return `${str.slice(0, 4)}/${str.slice(4, 6)}/${str.slice(6, 8)}`;
  }
  return String(date);
}


/**
 * firestore_id をキーに定期購入データを1件削除する
 * main_post.gs の handleManagePost() から呼び出される
 *
 * @param {Object} params - { firestoreId }
 * @returns {Object} - ContentService レスポンス
 */
function deleteSubscriptionData(params) {
  const firestoreId = String(params.firestoreId || "");
  Logger.log(`[deleteSubscription] 受信 firestoreId="${firestoreId}"`);

  if (!firestoreId) {
    return createJsonResponse({ status: "error", message: "firestoreId が指定されていません" });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("subscriptions");

  if (!sheet) {
    return createJsonResponse({ status: "error", message: "subscriptionsシートが見つかりません" });
  }

  const lastRow = sheet.getLastRow();
  Logger.log(`[deleteSubscription] lastRow=${lastRow}`);
  if (lastRow <= 1) {
    return createJsonResponse({ status: "error", message: "該当データが見つかりませんでした" });
  }

  // 列 12（index 11）の firestore_id を検索
  const data = sheet.getRange(2, 12, lastRow - 1, 1).getValues();
  Logger.log(`[deleteSubscription] 検索行数=${data.length}`);

  for (let i = 0; i < data.length; i++) {
    Logger.log(`[deleteSubscription] 行${i + 2}: "${data[i][0]}"`);
    if (String(data[i][0]) === firestoreId) {
      sheet.deleteRow(i + 2); // ヘッダー行分 +2
      Logger.log(`[deleteSubscription] 行${i + 2}を削除しました`);
      return createJsonResponse({ status: "success", message: "削除しました" });
    }
  }

  Logger.log(`[deleteSubscription] 一致する行が見つかりませんでした`);
  return createJsonResponse({ status: "error", message: "該当データが見つかりませんでした" });
}


/**
 * firestore_id をキーに定期購入データを1件更新する
 * main_post.gs の handleManagePost() から呼び出される
 *
 * @param {Object} params - { firestoreId, itemName, methodName, amount, nextPurchaseDate, memo }
 * @returns {Object} - ContentService レスポンス
 */
function updateSubscriptionData(params) {
  const firestoreId      = String(params.firestoreId      || "");
  const itemName         = params.itemName                || "";
  const methodName       = params.methodName              || "";
  const amount           = params.amount                  || "";
  const nextPurchaseDate = params.nextPurchaseDate        || "";
  const memo             = params.memo                    || "";

  Logger.log(`[updateSubscription] 受信 firestoreId="${firestoreId}"`);

  if (!firestoreId) {
    return createJsonResponse({ status: "error", message: "firestoreId が指定されていません" });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("subscriptions");

  if (!sheet) {
    return createJsonResponse({ status: "error", message: "subscriptionsシートが見つかりません" });
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return createJsonResponse({ status: "error", message: "該当データが見つかりませんでした" });
  }

  const data = sheet.getRange(2, 12, lastRow - 1, 1).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === firestoreId) {
      const row = i + 2;
      sheet.getRange(row, 3).setValue(itemName);         // item_name
      sheet.getRange(row, 4).setValue(methodName);       // method_name
      sheet.getRange(row, 6).setValue(amount);           // amount
      sheet.getRange(row, 10).setValue(nextPurchaseDate); // next_purchase_date
      sheet.getRange(row, 11).setValue(memo);            // memo
      Logger.log(`[updateSubscription] 行${row}を更新しました`);
      return createJsonResponse({ status: "success", message: "更新しました" });
    }
  }

  Logger.log(`[updateSubscription] 一致する行が見つかりませんでした`);
  return createJsonResponse({ status: "error", message: "該当データが見つかりませんでした" });
}
