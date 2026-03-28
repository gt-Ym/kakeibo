// record.js
// 家計簿入力（収入・支出・チャージ）のモーダルウィザード
// Firestore を使用してデータを保存する

// ─────────────────────────────────────────
// ページ状態
// ─────────────────────────────────────────

const recordState = {
  categoryId:   null,
  items:        [],   // [{ id, categoryId, name }, ...]
  methods:      [],   // [{ id, categoryId, name }, ...]
  currency:     "JPY",  // "JPY" | "USD"
  usdAmount:    null,   // number | null — USD入力時の元の金額
  exchangeRate: null,   // number | null — USD入力時の為替レート
};

document.addEventListener("DOMContentLoaded", function () {
  const params     = new URLSearchParams(window.location.search);
  const categoryId = params.get("categoryId");
  recordState.categoryId = categoryId;
  openModal("modal-loading");
  updatePageTitle(categoryId);
  initCurrencyToggle();

  requireAuth(() => {
    loadMasterData(categoryId).then(() => {
      startInput();
    });
  });
});

// ─────────────────────────────────────────
// ウィザード制御
// ─────────────────────────────────────────

/**
 * 入力ウィザードの先頭ステップへ進む。
 */
function startInput() {
  document.getElementById("modal-date").value = getTodayISO();
  openModal("modal-item");
}

/**
 * 指定モーダルを開き、他を閉じる。
 * @param {string} modalId - 開くモーダルの要素 ID
 */
function openModal(modalId) {
  closeAllModals();
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
    if (modalId === "modal-item")   showRecentItems();
    if (modalId === "modal-method") {
      showRecentMethods();
      const methodTitle = document.querySelector("#modal-method .modal-title");
      if (methodTitle) {
        methodTitle.textContent = recordState.categoryId === CATEGORY.INCOME
          ? "受取方法を選択してください"
          : "決済方法を選択してください";
      }
    }
  }
}

/**
 * 全モーダルを非アクティブにする。
 */
function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
}

/**
 * 現在ステップを検証し、次のモーダルへ進む。
 * @param {number} currentStep - 現在のステップ番号（1〜5）
 */
function nextStep(currentStep) {
  if (!validateStep(currentStep)) return;
  const map = { 1: "modal-method", 2: "modal-amount-overlay", 3: "modal-date-overlay", 4: "modal-memo-overlay" };
  if (currentStep === 5) {
    showConfirmModal();
  } else {
    openModal(map[currentStep]);
  }
}

/**
 * 前のステップのモーダルへ戻る。
 * @param {number} currentStep - 現在のステップ番号（2〜5）
 */
function previousStep(currentStep) {
  const map = { 2: "modal-item", 3: "modal-method", 4: "modal-amount-overlay", 5: "modal-date-overlay" };
  openModal(map[currentStep]);
}

// ─────────────────────────────────────────
// バリデーション（責務分離）
// ─────────────────────────────────────────

/**
 * 指定ステップの入力値を DOM から収集して返す。
 * @param {number} step - ステップ番号
 * @returns {string|number|null} ステップに応じた入力値
 */
function getStepValue(step) {
  if (step === 1) return document.getElementById("modal-itemId").value;
  if (step === 2) return document.getElementById("modal-methodId").value;
  if (step === 3) {
    const input = document.getElementById("modal-amount");
    return evalAmount(input.value);
  }
  if (step === 4) return document.getElementById("modal-date").value;
  return null;
}

/**
 * 指定ステップの値が有効かどうかを判定する。
 * @param {number} step - ステップ番号
 * @param {string|number|null} value - getStepValue() で取得した値
 * @returns {boolean} 有効なら true
 */
function isValidStepValue(step, value) {
  if (step === 1) return !!value;
  if (step === 2) return !!value;
  if (step === 3) return !isNaN(value) && value > 0;
  if (step === 4) return !!value;
  return true;
}

/**
 * 指定ステップの入力を検証し、無効なら alert を出して false を返す。
 * @param {number} step - ステップ番号
 * @returns {boolean} 有効なら true
 */
function validateStep(step) {
  if (step === 1) {
    if (!isValidStepValue(1, getStepValue(1))) { showError("項目を選択してください");     return false; }
  }
  if (step === 2) {
    if (!isValidStepValue(2, getStepValue(2))) { showError("決済方法を選択してください"); return false; }
  }
  if (step === 3) {
    const v = getStepValue(3);
    if (!isValidStepValue(3, v))               { showError("金額を入力してください");     return false; }
    // JPY は整数に丸める。USD は小数点（セント）を保持する。
    document.getElementById("modal-amount").value = recordState.currency === "JPY" ? Math.floor(v) : v;
  }
  if (step === 4) {
    if (!isValidStepValue(4, getStepValue(4))) { showError("日付を選択してください");     return false; }
  }
  return true;
}

// ─────────────────────────────────────────
// 金額計算
// ─────────────────────────────────────────

/**
 * 四則演算式文字列を評価して数値を返す。無効な式は NaN を返す。
 * @param {string} expr - 評価する式文字列
 * @returns {number}
 */
function evalAmount(expr) {
  const s = String(expr).trim();
  if (!s) return NaN;
  if (!/^[\d\s\+\-\*\/\.]+$/.test(s)) return NaN;
  try {
    const result = Function('"use strict"; return (' + s + ')')();
    return (typeof result === "number" && isFinite(result)) ? result : NaN;
  } catch (e) {
    return NaN;
  }
}

// ─────────────────────────────────────────
// 確認モーダル
// ─────────────────────────────────────────

/**
 * 確認モーダルを表示し、入力値をコピーする。
 * USD 入力時は為替レートを取得して円換算額を設定する。
 */
async function showConfirmModal() {
  populateConfirmSelects();
  document.getElementById("confirm-itemId").value   = document.getElementById("modal-itemId").value;
  document.getElementById("confirm-methodId").value = document.getElementById("modal-methodId").value;
  document.getElementById("confirm-date").value     = document.getElementById("modal-date").value;
  document.getElementById("confirm-memo").value     = document.getElementById("modal-memo").value;

  const rawAmount  = evalAmount(document.getElementById("modal-amount").value);
  const rateInfoEl = document.getElementById("confirm-rate-info");

  if (recordState.currency === "USD") {
    const dateISO = document.getElementById("modal-date").value; // YYYY-MM-DD

    // 先にモーダルを開いて「取得中」を表示する
    document.getElementById("confirm-amount").value = "";
    if (rateInfoEl) {
      rateInfoEl.textContent = "レート取得中...";
      rateInfoEl.className   = "currency-rate-info loading";
    }
    openModal("modal-confirm");

    try {
      const { jpy, rate } = await CurrencyManager.convertUsdToJpy(rawAmount, dateISO);
      recordState.usdAmount    = rawAmount;
      recordState.exchangeRate = rate;
      document.getElementById("confirm-amount").value = jpy;
      if (rateInfoEl) {
        rateInfoEl.textContent = `$${rawAmount} → ${CurrencyManager.formatJpy(jpy)}（1$ = ${rate.toFixed(2)}円）`;
        rateInfoEl.className   = "currency-rate-info";
      }
    } catch (err) {
      console.error("為替レート取得エラー:", err);
      recordState.usdAmount    = rawAmount;
      recordState.exchangeRate = null;
      if (rateInfoEl) {
        rateInfoEl.textContent = "レートの取得に失敗しました。円金額を直接入力してください。";
        rateInfoEl.className   = "currency-rate-info error";
      }
    }
  } else {
    recordState.usdAmount    = null;
    recordState.exchangeRate = null;
    document.getElementById("confirm-amount").value = Math.floor(rawAmount);
    if (rateInfoEl) {
      rateInfoEl.textContent = "";
      rateInfoEl.className   = "currency-rate-info";
    }
    openModal("modal-confirm");
  }
}

/**
 * 確認モーダルの項目・決済方法セレクタをマスターデータで初期化する。
 */
function populateConfirmSelects() {
  const itemSelect   = document.getElementById("confirm-itemId");
  const methodSelect = document.getElementById("confirm-methodId");

  itemSelect.innerHTML = "";
  recordState.items.forEach(item => {
    const opt       = document.createElement("option");
    opt.value       = item.id;
    opt.textContent = item.name;
    itemSelect.appendChild(opt);
  });

  methodSelect.innerHTML = "";
  recordState.methods.forEach(method => {
    const opt       = document.createElement("option");
    opt.value       = method.id;
    opt.textContent = method.name;
    methodSelect.appendChild(opt);
  });
}

/**
 * 確認モーダルから入力モーダルへ戻り、値を復元する。
 */
function backToEdit() {
  document.getElementById("modal-itemId").value   = document.getElementById("confirm-itemId").value;
  document.getElementById("modal-methodId").value = document.getElementById("confirm-methodId").value;
  document.getElementById("modal-amount").value   = document.getElementById("confirm-amount").value;
  document.getElementById("modal-date").value     = document.getElementById("confirm-date").value;
  document.getElementById("modal-memo").value     = document.getElementById("confirm-memo").value;
  openModal("modal-item");
}

// ─────────────────────────────────────────
// 送信（責務分割）
// ─────────────────────────────────────────

/**
 * 確認フォームから送信用の入力値を収集して返す。
 * USD 入力時は元の金額・レートを含む。
 * @returns {Object}
 */
function collectTransactionInput() {
  const base = {
    uid:      getCurrentUserId(),
    itemId:   document.getElementById("confirm-itemId").value,
    methodId: document.getElementById("confirm-methodId").value,
    amount:   Number(document.getElementById("confirm-amount").value),
    date:     document.getElementById("confirm-date").value.replace(/-/g, ""),
    memo:     document.getElementById("confirm-memo").value.trim(),
  };
  if (recordState.currency === "USD" && recordState.usdAmount !== null) {
    base.originalAmount   = recordState.usdAmount;
    base.originalCurrency = "USD";
    if (recordState.exchangeRate !== null) base.exchangeRate = recordState.exchangeRate;
  }
  return base;
}

/**
 * 予算超過時に LINE 通知をリクエストする（fire-and-forget）。
 * @param {string} uid - Firebase Auth の UID
 * @param {{ amount: number }} input - 送信データ
 * @param {string} itemName - 項目名
 * @param {number} prevTotal - 登録前の月次合計
 * @param {number} budget - 予算額
 * @param {string} lineId - LINE ユーザー ID
 */
async function notifyIfBudgetOver(uid, input, itemName, prevTotal, budget, lineId) {
  if (budget > 0 && prevTotal < budget && (prevTotal + input.amount) >= budget && lineId) {
    fetch(GAS_MAIN_URL, {
      method: "POST",
      mode:   "no-cors",
      body:   JSON.stringify({
        action:       "budgetOverNotification",
        itemName,
        budgetAmount: budget,
        lineId,
      }),
    }).catch(() => {});
  }
}

/**
 * Firestore へトランザクションを保存する（オーケストレーター）。
 * @returns {Promise<void>}
 */
async function sendData() {
  const input     = collectTransactionInput();
  const itemObj   = recordState.items.find(i => i.id === input.itemId)     || {};
  const methodObj = recordState.methods.find(m => m.id === input.methodId) || {};

  const btn = document.getElementById("send-btn");
  btn.disabled    = true;
  btn.textContent = "送信中...";

  try {
    // 予算チェック用データを登録前に並列取得
    const year  = input.date.slice(0, 4);
    const month = input.date.slice(4, 6);
    const [prevSummarySnap, budgetDoc, userDoc] = await Promise.all([
      db.doc(`users/${input.uid}/monthlySummary/${year}/months/${month}`).get().catch(() => null),
      db.doc(`users/${input.uid}/budgetTargets/${input.itemId}`).get().catch(() => null),
      db.doc(`users/${input.uid}`).get().catch(() => null),
    ]);

    const prevTotal = (prevSummarySnap && prevSummarySnap.exists)
      ? (prevSummarySnap.data()[recordState.categoryId]?.items?.[itemObj.name] ?? 0)
      : 0;
    const budget = (budgetDoc && budgetDoc.exists) ? (budgetDoc.data().amount ?? 0) : 0;
    const lineId = (userDoc  && userDoc.exists)   ? (userDoc.data().lineId  || "")  : "";

    // トランザクション保存
    const txRepo = new TransactionRepository(input.uid);
    await txRepo.add({
      itemId:        input.itemId,
      itemName:      itemObj.name        || "",
      methodId:      input.methodId,
      methodName:    methodObj.name      || "",
      categoryId:    recordState.categoryId,
      amount:        input.amount,
      date:          input.date,
      memo:          input.memo,
      isGroupShared: methodObj.isGroupShared || false,
    });

    await updateMonthlySummaryForDate(input.uid, input.date);

    // 予算超過判定: 登録前は予算内 かつ 登録後に超過した場合のみ通知
    await notifyIfBudgetOver(input.uid, input, itemObj.name || "", prevTotal, budget, lineId);

    saveRecentInput(input.itemId, input.methodId);
    showSuccess("送信しました。");
    window.location.href = "/html/menu.html";
  } catch (err) {
    console.error("送信エラー:", err);
    showError("送信に失敗しました。");
    btn.disabled    = false;
    btn.textContent = "送信する";
  }
}

// ─────────────────────────────────────────
// 通貨トグル初期化
// ─────────────────────────────────────────

/**
 * 金額入力モーダルに円/ドル切替ボタンを挿入し、recordState.currency と同期する。
 */
function initCurrencyToggle() {
  const container = document.getElementById("amount-currency-container");
  if (!container) return;

  CurrencyManager.createToggle(container, (currency) => {
    recordState.currency = currency;
    const amountInput = document.getElementById("modal-amount");
    if (currency === "USD") {
      amountInput.placeholder = "例: 9.99 または 10+5.50";
    } else {
      amountInput.placeholder = "例: 1500 または 500+200";
    }
  });
}

// ─────────────────────────────────────────
// マスターデータ読み込み
// ─────────────────────────────────────────

/**
 * Firestore からカテゴリのマスターデータを取得し、セレクタと状態を更新する。
 * @param {string} categoryId - カテゴリ ID
 * @returns {Promise<void>}
 */
async function loadMasterData(categoryId) {
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
      recordState,
      document.getElementById("modal-itemId"),
      document.getElementById("modal-methodId")
    );
  } catch (err) {
    console.error("マスターデータ取得エラー:", err);
    showError("データの取得に失敗しました。");
  }
}

// ─────────────────────────────────────────
// ページタイトル・最近の入力
// ─────────────────────────────────────────

/**
 * カテゴリ ID に応じてページタイトルを更新する。
 * @param {string} categoryId - カテゴリ ID
 */
function updatePageTitle(categoryId) {
  const el = document.getElementById("page-title");
  if (!el) return;
  const map = {
    [CATEGORY.INCOME]:  "収入入力",
    [CATEGORY.EXPENSE]: "支出入力",
    [CATEGORY.CHARGE]:  "チャージ入力",
  };
  el.textContent = map[categoryId] || "家計簿入力";
}

/**
 * 直近の入力項目・決済方法を localStorage に保存する。
 * @param {string} itemId   - 保存する項目 ID
 * @param {string} methodId - 保存する決済方法 ID
 */
function saveRecentInput(itemId, methodId) {
  const itemsKey   = `recentItems_${recordState.categoryId}`;
  const methodsKey = `recentMethods_${recordState.categoryId}`;

  let ri = JSON.parse(localStorage.getItem(itemsKey) || "[]").filter(id => id !== itemId);
  ri.unshift(itemId);
  localStorage.setItem(itemsKey, JSON.stringify(ri.slice(0, 3)));

  let rm = JSON.parse(localStorage.getItem(methodsKey) || "[]").filter(id => id !== methodId);
  rm.unshift(methodId);
  localStorage.setItem(methodsKey, JSON.stringify(rm.slice(0, 3)));
}

/**
 * 最近使用した項目のクイック選択ボタンを表示する。
 */
function showRecentItems() {
  const recentItems = JSON.parse(localStorage.getItem(`recentItems_${recordState.categoryId}`) || "[]");
  const container   = document.getElementById("recent-items-buttons");
  if (recentItems.length === 0) { container.style.display = "none"; return; }

  container.innerHTML = "";
  recentItems.forEach(itemId => {
    const item = recordState.items.find(i => i.id === itemId);
    if (!item) return;
    const btn       = document.createElement("button");
    btn.type        = "button";
    btn.className   = "btn btn-quick";
    btn.onclick     = () => applyRecentItem(itemId);
    btn.textContent = item.name;
    container.appendChild(btn);
  });
  container.style.display = "flex";
}

/**
 * 最近使用した決済方法のクイック選択ボタンを表示する。
 */
function showRecentMethods() {
  const recentMethods = JSON.parse(localStorage.getItem(`recentMethods_${recordState.categoryId}`) || "[]");
  const container     = document.getElementById("recent-methods-buttons");
  if (recentMethods.length === 0) { container.style.display = "none"; return; }

  container.innerHTML = "";
  recentMethods.forEach(methodId => {
    const method = recordState.methods.find(m => m.id === methodId);
    if (!method) return;
    const btn       = document.createElement("button");
    btn.type        = "button";
    btn.className   = "btn btn-quick";
    btn.onclick     = () => applyRecentMethod(methodId);
    btn.textContent = method.name;
    container.appendChild(btn);
  });
  container.style.display = "flex";
}

/**
 * 指定項目 ID をモーダルセレクタに反映する。
 * @param {string} itemId - 選択する項目 ID
 */
function applyRecentItem(itemId)     { document.getElementById("modal-itemId").value   = itemId; }

/**
 * 指定決済方法 ID をモーダルセレクタに反映する。
 * @param {string} methodId - 選択する決済方法 ID
 */
function applyRecentMethod(methodId) { document.getElementById("modal-methodId").value = methodId; }
