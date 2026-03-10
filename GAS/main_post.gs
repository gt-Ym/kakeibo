/**
 * メインのPOSTエントリポイント
 * action パラメータによってすべての処理を振り分ける
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

    if (!action) {
      return createJsonResponse({ status: "error", message: "action が指定されていません" });
    }

    return handlePost(params);
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: "リクエストエラー: " + err.toString()
    });
  }
}

/**
 * action の値に応じて処理を振り分ける
 */
function handlePost(params) {
  switch (params.action) {
    case "addTransaction":     return handleTransactionPost(params);
    case "addSubscription":    return handleSubscriptionPost(params);
    case "update":             return updateData(params);
    case "delete":             return deleteData(params);
    case "deleteSubscription":      return deleteSubscriptionData(params);
    case "updateSubscription":      return updateSubscriptionData(params);
    case "budgetOverNotification":  return sendBudgetOverNotification(params);
    default:
      return createJsonResponse({
        status: "error",
        message: "不明なアクションです: " + params.action
      });
  }
}

/**
 * transactions シートへのデータ挿入処理
 */
function handleTransactionPost(params) {
  const sheetName = "transactions";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return createJsonResponse({
      status: "error",
      message: "Sheet '" + sheetName + "' not found."
    });
  }

  try {
    const userId   = params.userId;
    const itemId   = params.itemId;
    const methodId = params.methodId;
    const amount   = params.amount;
    const date     = params.date;
    const memo     = params.memo;

    // 連番IDを生成
    const lastRow = sheet.getLastRow();
    let newId = 1;

    if (lastRow > 1) {
      const lastId = sheet.getRange(lastRow, 1).getValue();
      if (lastId && !isNaN(Number(lastId)) && Number(lastId) > 0) {
        newId = Number(lastId) + 1;
      } else {
        newId = lastRow;
      }
    }

    sheet.appendRow([newId, userId, itemId, methodId, amount, date, memo]);
    return createJsonResponse({ status: "success" });
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  }
}

/**
 * subscriptions シートへのデータ挿入処理
 */
function handleSubscriptionPost(params) {
  const sheetName = "subscriptions";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return createJsonResponse({
      status: "error",
      message: "Sheet '" + sheetName + "' が見つかりません。"
    });
  }

  try {
    // 連番subscription_idを生成
    const lastRow = sheet.getLastRow();
    let newId = 1;

    if (lastRow > 1) {
      const lastId = sheet.getRange(lastRow, 1).getValue();
      if (lastId && !isNaN(Number(lastId)) && Number(lastId) > 0) {
        newId = Number(lastId) + 1;
      } else {
        newId = lastRow;
      }
    }

    // subscriptions シートのカラム順（0始まり）:
    // 0:subscription_id, 1:user_id, 2:item_name, 3:method_name, 4:category_id,
    // 5:amount, 6:start_date, 7:frequency_type, 8:frequency_value,
    // 9:next_purchase_date, 10:memo, 11:firestore_id
    const rowData = [
      newId,
      params.user_id,
      params.item_name,
      params.method_name,
      params.category_id,
      params.amount,
      params.start_date,
      params.frequency_type,
      params.frequency_value,
      params.next_purchase_date,
      params.memo || "",
      params.firestore_id || ""
    ];

    sheet.appendRow(rowData);
    return createJsonResponse({ status: "success" });
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: "サーバーエラー: " + err.toString()
    });
  }
}

/**
 * JSONレスポンスを生成する共通関数
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
