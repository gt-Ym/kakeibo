/**
 * budget_notification.gs
 * 予算超過時の LINE 通知処理
 *
 * doPost からは main_post.gs の handlePost() 経由で呼び出される。
 * daily_trigger.gs からは checkAndNotifyBudgetOver() を直接呼び出す。
 *
 * sendLineNotification() は daily_trigger.gs に定義済みのため再定義不要。
 */

/**
 * フロントエンド（record.js）からの呼び出し用エントリポイント
 * params: { action, itemName, budgetAmount, lineId }
 *
 * @param {Object} params
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function sendBudgetOverNotification(params) {
  const lineId       = params.lineId       || "";
  const itemName     = params.itemName     || "";
  const budgetAmount = Number(params.budgetAmount) || 0;

  if (!lineId) {
    return createJsonResponse({ status: "error", message: "lineId が指定されていません" });
  }

  const message = `「${itemName}」の予算 ${budgetAmount.toLocaleString()}円 がオーバーしました！`;
  const ok = sendLineNotification(lineId, message);

  if (!ok) {
    return createJsonResponse({ status: "error", message: "LINE通知の送信に失敗しました" });
  }
  return createJsonResponse({ status: "success" });
}

/**
 * daily_trigger から呼び出す予算超過チェック＋通知
 * Firestore への書き込み（writeTransactionToFirestore）の直前に呼ぶこと。
 *
 * @param {string} uid
 * @param {string} itemId
 * @param {string} itemName
 * @param {string} categoryId   "1"|"2"|"3"
 * @param {number} amount       今回追加する金額
 * @param {string} year         "2026"
 * @param {string} month        "01"〜"12"
 * @param {string} lineId       通知先 LINE ユーザーID（空なら通知しない）
 */
function checkAndNotifyBudgetOver(uid, itemId, itemName, categoryId, amount, year, month, lineId) {
  if (!lineId) return;

  // 1. budgetTargets/{itemId} から予算額を取得
  const budgetFields = getFirestoreDocument(`users/${uid}/budgetTargets/${itemId}`);
  if (!budgetFields || !budgetFields.amount) return; // 予算未設定なら通知しない

  const budget = Number(
    budgetFields.amount.integerValue ||
    budgetFields.amount.doubleValue  || 0
  );
  if (budget <= 0) return;

  // 2. monthlySummary から登録前の項目合計を取得
  const summaryFields = getFirestoreDocument(
    `users/${uid}/monthlySummary/${year}/months/${month}`
  );
  const prevTotal = _extractItemTotal(summaryFields, categoryId, itemName);

  // 3. 予算超過判定: 登録前は予算内 かつ 登録後に超過する場合のみ通知
  if (prevTotal < budget && (prevTotal + amount) >= budget) {
    const message = `「${itemName}」の予算 ${budget.toLocaleString()}円 がオーバーしました！`;
    const ok = sendLineNotification(lineId, message);
    if (!ok) {
      Logger.log(`[budget_notification] LINE通知失敗: uid=${uid}, item=${itemName}`);
    }
  }
}

/**
 * Firestore REST 形式の monthlySummary フィールドから
 * 指定カテゴリ・項目名の合計金額を取り出す
 *
 * @param {Object|null} fields  getFirestoreDocument() の戻り値
 * @param {string} categoryId
 * @param {string} itemName
 * @returns {number}
 */
function _extractItemTotal(fields, categoryId, itemName) {
  try {
    const val = fields[categoryId]
      .mapValue.fields.items
      .mapValue.fields[itemName];
    return Number(val.integerValue || val.doubleValue || 0);
  } catch (e) {
    return 0; // カテゴリ・項目が未集計の場合は 0 とみなす
  }
}
