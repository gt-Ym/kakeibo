// subscription.js
// 定期購入の登録
// Firestore を使用してデータを保存する

// ─────────────────────────────────────────
// ページ状態
// ─────────────────────────────────────────

const subscriptionState = {
  items:    [],  // { id, categoryId, name }
  methods:  [],
  currency: "JPY",  // "JPY" | "USD"
};

document.addEventListener("DOMContentLoaded", () => {
  const params     = new URLSearchParams(window.location.search);
  const categoryId = params.get("categoryId") || CATEGORY.EXPENSE;

  updatePageTitle(categoryId);

  const startDateInput = document.getElementById("startDate");
  if (startDateInput) startDateInput.value = getTodayISO();

  ["startDate", "frequencyType", "frequencyValue"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateNextPurchaseDateDisplay);
  });

  initSubscriptionCurrencyToggle();

  requireAuth(() => {
    fetchSubscriptionMasterData(categoryId);
  });
});

// ─────────────────────────────────────────
// 通貨トグル初期化
// ─────────────────────────────────────────

/**
 * 金額フィールドに円/ドル切替ボタンを挿入し、subscriptionState.currency と同期する。
 */
function initSubscriptionCurrencyToggle() {
  const container = document.getElementById("subscription-currency-container");
  if (!container) return;

  CurrencyManager.createToggle(container, (currency) => {
    subscriptionState.currency = currency;
    const amountInput  = document.getElementById("amount");
    const rateInfoEl   = document.getElementById("subscription-rate-info");
    if (currency === "USD") {
      amountInput.step        = "0.01";
      amountInput.placeholder = "例: 9.99";
      if (rateInfoEl) rateInfoEl.textContent = "登録時に開始日のレートで円換算します";
    } else {
      amountInput.step        = "1";
      amountInput.placeholder = "例: 1980";
      if (rateInfoEl) rateInfoEl.textContent = "";
    }
  });
}

// ─────────────────────────────────────────
// マスターデータ取得
// ─────────────────────────────────────────

/**
 * Firestore からカテゴリのマスターデータを取得し、状態とセレクタを更新する。
 * @param {string} categoryId - カテゴリ ID
 * @returns {Promise<void>}
 */
async function fetchSubscriptionMasterData(categoryId) {
  const uid = getCurrentUserId();
  if (!uid) {
    showError("ユーザー情報が取得できません。再度ログインしてください。");
    window.location.href = "/html/login.html";
    return;
  }

  try {
    await loadMasterIntoState(
      uid,
      categoryId,
      subscriptionState,
      document.getElementById("itemId"),
      document.getElementById("methodId")
    );
  } catch (err) {
    console.error("マスターデータ取得エラー:", err);
    showError("マスターデータの読み込みに失敗しました。");
  }
}

// ─────────────────────────────────────────
// 次回購入日の計算・表示
// ─────────────────────────────────────────

/**
 * 開始日・頻度タイプ・頻度値から次回購入日（YYYY-MM-DD）を算出する。
 * @param {string} startDate      - 開始日（YYYY-MM-DD）
 * @param {string} frequencyType  - 頻度タイプ（daily / weekly / monthly / yearly）
 * @param {string|number} frequencyValue - 頻度値
 * @returns {string} YYYY-MM-DD 形式の次回購入日、算出不能なら空文字
 */
function calculateNextPurchaseDate(startDate, frequencyType, frequencyValue) {
  if (!startDate || !frequencyType || !frequencyValue) return "";
  const d = new Date(startDate);
  const v = parseInt(frequencyValue);
  switch (frequencyType) {
    case "daily":   d.setDate(d.getDate() + v);            break;
    case "weekly":  d.setDate(d.getDate() + v * 7);        break;
    case "monthly": d.setMonth(d.getMonth() + v);          break;
    case "yearly":  d.setFullYear(d.getFullYear() + v);    break;
    default: return "";
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/**
 * フォームの値から次回購入日を計算して表示フィールドに反映する。
 */
function updateNextPurchaseDateDisplay() {
  const startDate      = document.getElementById("startDate").value;
  const frequencyType  = document.getElementById("frequencyType").value;
  const frequencyValue = document.getElementById("frequencyValue").value;
  const displayField   = document.getElementById("nextPurchaseDateDisplay");
  displayField.value   = calculateNextPurchaseDate(startDate, frequencyType, frequencyValue);
}

// ─────────────────────────────────────────
// バリデーション（責務分離）
// ─────────────────────────────────────────

/**
 * 定期購入フォームの入力値を検証する。
 * @param {{ uid: string, itemId: string, methodId: string, amount: number, startDate: string, frequencyType: string, frequencyValue: number }} data - 検証対象のデータ
 * @returns {boolean} 有効なら true
 */
function validateSubscriptionForm(data) {
  if (!data.uid)                                  { showError("ログイン情報が見つかりません。");           return false; }
  if (!data.itemId)                               { showError("項目を選択してください。");                 return false; }
  if (!data.methodId)                             { showError("決済方法を選択してください。");             return false; }
  if (!data.amount || data.amount <= 0)           { showError("金額を正しく入力してください。");           return false; }
  if (!data.startDate)                            { showError("開始日を選択してください。");               return false; }
  if (!data.frequencyType)                        { showError("頻度タイプを選択してください。");           return false; }
  if (!data.frequencyValue || data.frequencyValue < 1) { showError("頻度値を選択してください。");         return false; }
  return true;
}

// ─────────────────────────────────────────
// 定期購入を Firestore に登録
// ─────────────────────────────────────────

/**
 * フォームの入力値を Firestore と GAS スプレッドシートに登録する。
 * @returns {Promise<void>}
 */
async function addSubscription() {
  const uid           = getCurrentUserId();
  const params        = new URLSearchParams(window.location.search);
  const categoryId    = params.get("categoryId") || CATEGORY.EXPENSE;

  const itemId         = document.getElementById("itemId").value;
  const methodId       = document.getElementById("methodId").value;
  const amount         = Number(document.getElementById("amount").value);
  const startDate      = document.getElementById("startDate").value;
  const frequencyType  = document.getElementById("frequencyType").value;
  const frequencyValue = Number(document.getElementById("frequencyValue").value);
  const memo           = document.getElementById("memo").value.trim();

  if (!validateSubscriptionForm({ uid, itemId, methodId, amount, startDate, frequencyType, frequencyValue })) return;

  const nextPurchaseDate = calculateNextPurchaseDate(startDate, frequencyType, frequencyValue);
  if (!nextPurchaseDate) { showError("次回購入日の計算に失敗しました。"); return; }

  const itemObj   = subscriptionState.items.find(i => i.id === itemId)     || {};
  const methodObj = subscriptionState.methods.find(m => m.id === methodId) || {};

  const submitButton = document.querySelector('.btn-primary[type="submit"]');

  // USD 入力時は開始日のレートで円換算する
  let finalAmount   = amount;
  let currencyMeta  = {};
  if (subscriptionState.currency === "USD") {
    const rateInfoEl = document.getElementById("subscription-rate-info");
    try {
      if (rateInfoEl) { rateInfoEl.textContent = "レート取得中..."; rateInfoEl.className = "currency-rate-info loading"; }
      const { jpy, rate } = await CurrencyManager.convertUsdToJpy(amount, startDate);
      finalAmount  = jpy;
      currencyMeta = { originalAmount: amount, originalCurrency: "USD", exchangeRate: rate };
      if (rateInfoEl) {
        rateInfoEl.textContent = `$${amount} → ${CurrencyManager.formatJpy(jpy)}（1$ = ${rate.toFixed(2)}円）`;
        rateInfoEl.className   = "currency-rate-info";
      }
    } catch (err) {
      console.error("為替レート取得エラー:", err);
      if (rateInfoEl) { rateInfoEl.textContent = "レートの取得に失敗しました。時間をおいて再試行してください。"; rateInfoEl.className = "currency-rate-info error"; }
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = "登録する"; }
      return;
    }
  }

  // 次回購入日を YYYYMMDD に変換
  const nextPurchaseDateYMD = nextPurchaseDate.replace(/-/g, "");

  if (submitButton) { submitButton.disabled = true; submitButton.textContent = "登録中..."; }

  try {
    // Firestore に登録（戻り値の doc ID を GAS 連携に使用）
    const subRepo     = new SubscriptionRepository(uid);
    const firestoreId = await subRepo.add({
      itemId,
      itemName:         itemObj.name   || "",
      methodId,
      methodName:       methodObj.name || "",
      categoryId,
      amount:           finalAmount,
      startDate,
      frequencyType,
      frequencyValue,
      nextPurchaseDate: nextPurchaseDateYMD,
      memo,
      ...currencyMeta,
    });

    // GAS スプレッドシートにも登録（daily_trigger 用）
    fetch(GAS_MAIN_URL, {
      method: "POST",
      mode:   "no-cors",
      body:   JSON.stringify({
        action:             "addSubscription",
        user_id:            uid,
        item_name:          itemObj.name   || "",
        method_name:        methodObj.name || "",
        category_id:        categoryId,
        amount:             finalAmount,
        start_date:         startDate,
        frequency_type:     frequencyType,
        frequency_value:    frequencyValue,
        next_purchase_date: nextPurchaseDateYMD,
        memo,
        firestore_id:       firestoreId,
      }),
    });

    showSuccess("定期購入情報を登録しました。");
    const form = document.querySelector(".form");
    if (form) {
      form.reset();
      document.getElementById("startDate").value = getTodayISO();
      document.getElementById("nextPurchaseDateDisplay").value = "";
    }
  } catch (err) {
    console.error("登録エラー:", err);
    showError("エラーが発生しました: " + err.message);
  } finally {
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = "登録する"; }
  }
}

// ─────────────────────────────────────────
// ページタイトル
// ─────────────────────────────────────────

/**
 * カテゴリ ID に応じてページタイトルを更新する。
 * @param {string} categoryId - カテゴリ ID
 */
function updatePageTitle(categoryId) {
  const el = document.getElementById("page-title");
  if (!el) return;
  const map = {
    [CATEGORY.INCOME]:  "定期収入登録",
    [CATEGORY.EXPENSE]: "定期支出登録",
    [CATEGORY.CHARGE]:  "定期チャージ登録",
  };
  el.textContent = map[categoryId] || "定期購入登録";
}
