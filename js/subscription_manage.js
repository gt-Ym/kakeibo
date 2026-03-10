// subscription_manage.js
// 定期購入の一覧表示・削除
// Firestore を使用してデータを操作する

// ─────────────────────────────────────────
// ページ状態
// ─────────────────────────────────────────

const subscriptionManageState = {
  items:          [],
  methods:        [],
  editTargetId:   null,
  editCategoryId: null,
  deleteTargetId: null,
};

document.addEventListener("DOMContentLoaded", () => {
  requireAuth(() => {
    fetchSubscriptionList();
  });
});

// ─────────────────────────────────────────
// 一覧取得・描画
// ─────────────────────────────────────────

/**
 * 頻度タイプと頻度値を日本語テキストに変換する。
 * @param {string} type  - 頻度タイプ（daily / weekly / monthly / yearly）
 * @param {number} value - 頻度値
 * @returns {string}
 */
function formatFrequency(type, value) {
  const typeMap = { daily: "日", weekly: "週", monthly: "月", yearly: "年" };
  return `${typeMap[type] || type}に${value}回`;
}

/**
 * 定期購入の一覧を Firestore から取得してテーブルに描画する。
 * @returns {Promise<void>}
 */
async function fetchSubscriptionList() {
  const uid = getCurrentUserId();
  if (!uid) {
    showError("ユーザー情報が取得できません。再度ログインしてください。");
    window.location.href = "/html/login.html";
    return;
  }

  const statusMsg = document.getElementById("status-message");
  const table     = document.getElementById("sub-table");
  const tbody     = document.getElementById("sub-body");

  statusMsg.style.display = "block";
  statusMsg.textContent   = "読み込み中...";
  table.style.display     = "none";
  tbody.innerHTML         = "";

  try {
    const subRepo = new SubscriptionRepository(uid);
    const data = await subRepo.getAll();

    if (!Array.isArray(data) || data.length === 0) {
      statusMsg.textContent = "定期購入データがありません。";
      return;
    }

    data.forEach(row => {
      const tr = document.createElement("tr");
      tr.setAttribute("data-id",          row.id);
      tr.setAttribute("data-category-id", row.categoryId    || CATEGORY.EXPENSE);
      tr.setAttribute("data-item-id",     row.itemId        || "");
      tr.setAttribute("data-method-id",   row.methodId      || "");
      tr.setAttribute("data-amount",      row.amount        || "0");
      tr.setAttribute("data-next-date",   row.nextPurchaseDate || "");
      tr.setAttribute("data-memo",        row.memo          || "");

      const memoEsc = (row.memo || "").replace(/"/g, "&quot;");
      tr.innerHTML = `
        <td>${row.itemName   || ""}</td>
        <td>${row.methodName || ""}</td>
        <td class="amount-cell">${Number(row.amount).toLocaleString()} 円</td>
        <td class="start-date-cell">${formatDate(row.startDate)}</td>
        <td class="next-date-cell">${formatDate(row.nextPurchaseDate)}</td>
        <td><span class="frequency-badge">${formatFrequency(row.frequencyType, row.frequencyValue)}</span></td>
        <td class="memo-cell" title="${memoEsc}">${row.memo || ""}</td>
        <td class="action-cell">
          <button class="btn-edit"   onclick="showEditModal(this)">編集</button>
          <button class="btn-delete" onclick="showDeleteModal(this)">削除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    statusMsg.style.display = "none";
    table.style.display     = "table";

  } catch (err) {
    console.error(err);
    statusMsg.textContent = "通信エラーが発生しました。";
  }
}

// ─────────────────────────────────────────
// 編集モーダル
// ─────────────────────────────────────────

/**
 * 編集モーダルを開き、行のデータを反映してマスターデータを読み込む。
 * @param {HTMLButtonElement} btn - 編集ボタン要素
 * @returns {Promise<void>}
 */
async function showEditModal(btn) {
  const row = btn.closest("tr");
  subscriptionManageState.editTargetId   = row.dataset.id;
  subscriptionManageState.editCategoryId = row.dataset.categoryId;
  const uid = getCurrentUserId();

  // 現在値をセット
  document.getElementById("edit-amount").value = row.dataset.amount;
  document.getElementById("edit-memo").value   = row.dataset.memo;

  // YYYYMMDD → YYYY-MM-DD（date input 用）
  const nd = String(row.dataset.nextDate || "");
  document.getElementById("edit-next-date").value =
    nd.length === 8 ? `${nd.slice(0, 4)}-${nd.slice(4, 6)}-${nd.slice(6, 8)}` : "";

  // セレクトを「読み込み中」状態でモーダルを開く
  const editItemSelect   = document.getElementById("edit-item");
  const editMethodSelect = document.getElementById("edit-method");
  editItemSelect.innerHTML   = "<option value=''>読み込み中...</option>";
  editMethodSelect.innerHTML = "<option value=''>読み込み中...</option>";
  document.getElementById("edit-modal").style.display = "flex";

  try {
    await loadMasterIntoState(
      uid,
      subscriptionManageState.editCategoryId,
      subscriptionManageState,
      editItemSelect,
      editMethodSelect
    );
    editItemSelect.value   = row.dataset.itemId;
    editMethodSelect.value = row.dataset.methodId;
  } catch (err) {
    console.error("マスターデータ取得エラー:", err);
    showError("マスターデータの読み込みに失敗しました。");
    closeEditModal();
  }
}

/**
 * 編集モーダルを閉じて状態をリセットする。
 */
function closeEditModal() {
  subscriptionManageState.editTargetId   = null;
  subscriptionManageState.editCategoryId = null;
  document.getElementById("edit-modal").style.display = "none";
}

/**
 * 編集モーダルの入力内容を Firestore と GAS スプレッドシートに保存する。
 * @returns {Promise<void>}
 */
async function saveEditSubscription() {
  if (!subscriptionManageState.editTargetId) return;
  const uid = getCurrentUserId();

  const itemSelect   = document.getElementById("edit-item");
  const methodSelect = document.getElementById("edit-method");
  const itemId       = itemSelect.value;
  const itemName     = itemSelect.selectedIndex >= 0 ? itemSelect.options[itemSelect.selectedIndex].text : "";
  const methodId     = methodSelect.value;
  const methodName   = methodSelect.selectedIndex >= 0 ? methodSelect.options[methodSelect.selectedIndex].text : "";
  const amount       = Number(document.getElementById("edit-amount").value);
  const nextDateISO  = document.getElementById("edit-next-date").value; // YYYY-MM-DD
  const memo         = document.getElementById("edit-memo").value.trim();

  if (!itemId)                { showError("項目を選択してください。");        return; }
  if (!methodId)              { showError("決済方法を選択してください。");    return; }
  if (!amount || amount <= 0) { showError("金額を正しく入力してください。");  return; }
  if (!nextDateISO)           { showError("次回購入日を選択してください。");  return; }

  const nextPurchaseDateYMD = nextDateISO.replace(/-/g, ""); // YYYYMMDD

  const saveBtn = document.getElementById("edit-save-btn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "保存中..."; }

  try {
    const subRepo = new SubscriptionRepository(uid);
    await subRepo.update(subscriptionManageState.editTargetId, {
      itemId,
      itemName,
      methodId,
      methodName,
      amount,
      nextPurchaseDate: nextPurchaseDateYMD,
      memo,
    });

    // GAS スプレッドシートも更新
    fetch(GAS_MAIN_URL, {
      method: "POST",
      mode:   "no-cors",
      body:   JSON.stringify({
        action:           "updateSubscription",
        firestoreId:      subscriptionManageState.editTargetId,
        itemName,
        methodName,
        amount,
        nextPurchaseDate: nextPurchaseDateYMD,
        memo,
      }),
    });

    closeEditModal();
    fetchSubscriptionList();
  } catch (err) {
    console.error("更新エラー:", err);
    showError("エラーが発生しました: " + err.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "保存する"; }
  }
}

// ─────────────────────────────────────────
// 削除モーダル
// ─────────────────────────────────────────

/**
 * 削除確認モーダルを開く。
 * @param {HTMLButtonElement} btn - 削除ボタン要素
 */
function showDeleteModal(btn) {
  const row = btn.closest("tr");
  subscriptionManageState.deleteTargetId = row.getAttribute("data-id");
  document.getElementById("delete-modal").style.display = "flex";
}

/**
 * 削除確認モーダルを閉じて状態をリセットする。
 */
function closeDeleteModal() {
  subscriptionManageState.deleteTargetId = null;
  document.getElementById("delete-modal").style.display = "none";
}

/**
 * 削除確認後に Firestore と GAS スプレッドシートから定期購入を削除する。
 * @returns {Promise<void>}
 */
async function confirmDelete() {
  if (!subscriptionManageState.deleteTargetId) return;
  const uid = getCurrentUserId();

  try {
    const subRepo = new SubscriptionRepository(uid);
    await subRepo.delete(subscriptionManageState.deleteTargetId);

    // GAS スプレッドシートからも削除（firestore_id で行を特定）
    fetch(GAS_MAIN_URL, {
      method: "POST",
      mode:   "no-cors",
      body:   JSON.stringify({
        action:      "deleteSubscription",
        firestoreId: subscriptionManageState.deleteTargetId,
      }),
    });

    closeDeleteModal();
    fetchSubscriptionList();
  } catch (err) {
    console.error(err);
    showError("エラーが発生しました: " + err.message);
  }
}
