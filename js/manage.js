// manage.js
// 履歴検索・編集・削除
// Firestore を使用してデータを操作する

// ─────────────────────────────────────────
// ページ状態
// ─────────────────────────────────────────

const manageState = {
  deleteTargetRow: null,
  masterDataCache: {}, // { [categoryId]: { items: [...], methods: [...] } }
};

document.addEventListener("DOMContentLoaded", () => {
  initializeDateFilters();

  const categorySelect = document.getElementById("searchCategory");

  categorySelect.addEventListener("change", (e) => {
    document.getElementById("searchItem").innerHTML   = '<option value="">読み込み中...</option>';
    document.getElementById("searchMethod").innerHTML = '<option value="">読み込み中...</option>';
    fetchMasterDataForSearch(e.target.value);
  });

  document.getElementById("search-btn").addEventListener("click", fetchHistory);

  requireAuth(() => {
    fetchMasterDataForSearch(categorySelect.value);
  });
});

// ─────────────────────────────────────────
// マスターデータ取得（検索用セレクタ）
// ─────────────────────────────────────────

/**
 * 検索フォームの項目・決済方法セレクタをカテゴリに応じて更新する。
 * @param {string} categoryId - カテゴリ ID（空文字は「すべて」）
 * @returns {Promise<void>}
 */
async function fetchMasterDataForSearch(categoryId) {
  const uid = getCurrentUserId();
  if (!uid) return;

  // 「すべて」選択時は項目・決済方法フィルタを使用しないため、空リストで初期化するだけ
  if (!categoryId) {
    populateSelect(document.getElementById("searchItem"),   [], "全て表示");
    populateSelect(document.getElementById("searchMethod"), [], "全て表示");
    return;
  }

  try {
    const { items, methods } = await fetchMasterData(uid, categoryId);
    manageState.masterDataCache[categoryId] = { items, methods };
    populateSelect(document.getElementById("searchItem"),   items,   "全て表示");
    populateSelect(document.getElementById("searchMethod"), methods, "全て表示");
  } catch (err) {
    console.error("マスターデータ取得エラー:", err);
    document.getElementById("searchItem").innerHTML   = '<option value="">取得失敗</option>';
    document.getElementById("searchMethod").innerHTML = '<option value="">取得失敗</option>';
  }
}

// ─────────────────────────────────────────
// 履歴検索
// ─────────────────────────────────────────

/**
 * 検索条件を Firestore に送信してトランザクション履歴を取得・描画する。
 * @returns {Promise<void>}
 */
async function fetchHistory() {
  const uid      = getCurrentUserId();
  const year     = document.getElementById("searchYear").value;
  const month    = document.getElementById("searchMonth").value;
  const category = document.getElementById("searchCategory").value;
  const itemId   = document.getElementById("searchItem").value;
  const methodId = document.getElementById("searchMethod").value;
  const minAmt   = document.getElementById("minAmount").value;
  const maxAmt   = document.getElementById("maxAmount").value;
  const sortKey  = document.getElementById("sortKey").value;

  const statusMsg = document.getElementById("status-message");
  const table     = document.getElementById("result-table");
  const tbody     = document.getElementById("result-body");

  statusMsg.style.display = "block";
  statusMsg.textContent   = "データを取得中...";
  table.style.display     = "none";
  tbody.innerHTML         = "";

  try {
    const txRepo = new TransactionRepository(uid);
    const data = await txRepo.getAll({
      year,
      month,
      categoryId:   category,
      itemId,
      methodId,
      minAmount:    minAmt,
      maxAmount:    maxAmt,
      sortKey,
      includeGroup: true,
    });

    if (data.length === 0) {
      statusMsg.textContent = "該当するデータが見つかりませんでした。";
      return;
    }

    data.forEach(row => {
      const tr    = document.createElement("tr");
      const isOwn = !row.uid || row.uid === uid;

      tr.setAttribute("data-id",        row.id);
      tr.setAttribute("data-item-id",   row.itemId   || "");
      tr.setAttribute("data-method-id", row.methodId || "");
      tr.setAttribute("data-date",      row.date);
      tr.setAttribute("data-amount",    row.amount);
      tr.setAttribute("data-memo",      row.memo || "");
      tr.setAttribute("data-category",  row.categoryId || "");

      const ownerLabel = isOwn
        ? ""
        : `<span class="group-owner">${row.userName || "グループ"}</span>`;
      const actionCell = isOwn
        ? `<div class="action-menu">
             <button class="menu-btn" onclick="toggleMenu(event, this)">⋮</button>
             <div class="menu-dropdown">
               <button class="menu-item edit"   onclick="enterEditMode(this)">編集</button>
               <button class="menu-item delete" onclick="showDeleteModal(this)">削除</button>
             </div>
           </div>`
        : `<span class="group-badge">共有</span>`;

      tr.innerHTML = `
        <td class="date-cell">${formatDate(row.date)}</td>
        <td class="item-cell" data-category="${row.categoryId || ''}">${row.itemName || ""}${ownerLabel}</td>
        <td class="method-cell">${row.methodName || ""}</td>
        <td class="amount-cell" style="text-align: right;">${Number(row.amount).toLocaleString()} 円</td>
        <td class="memo-cell">${row.memo || ""}</td>
        <td class="action-cell" style="text-align: center;">${actionCell}</td>
      `;
      tbody.appendChild(tr);
    });

    statusMsg.style.display = "none";
    table.style.display     = "block";

  } catch (err) {
    console.error(err);
    statusMsg.textContent = "通信エラーが発生しました。";
  }
}

// ─────────────────────────────────────────
// メニュートグル
// ─────────────────────────────────────────

/**
 * 行ごとの操作メニュードロップダウンを開閉する。
 * @param {MouseEvent} event - クリックイベント
 * @param {HTMLButtonElement} btn - メニューボタン要素
 */
function toggleMenu(event, btn) {
  event.stopPropagation();
  const dropdown  = btn.nextElementSibling;
  const isVisible = dropdown.classList.contains("show");
  document.querySelectorAll(".menu-dropdown.show").forEach(m => m.classList.remove("show"));
  if (!isVisible) dropdown.classList.add("show");
}

document.addEventListener("click", () => {
  document.querySelectorAll(".menu-dropdown.show").forEach(m => m.classList.remove("show"));
});

// ─────────────────────────────────────────
// 編集
// ─────────────────────────────────────────

/**
 * カテゴリのマスターデータをキャッシュ付きで取得する。
 * @param {string} categoryId - カテゴリ ID
 * @returns {Promise<{ items: Array, methods: Array }>}
 */
async function getMasterDataForCategory(categoryId) {
  if (manageState.masterDataCache[categoryId]) return manageState.masterDataCache[categoryId];
  const uid = getCurrentUserId();
  try {
    const data = await fetchMasterData(uid, categoryId);
    manageState.masterDataCache[categoryId] = data;
  } catch (err) {
    console.error("マスターデータ取得エラー:", err);
  }
  return manageState.masterDataCache[categoryId] || { items: [], methods: [] };
}

/**
 * 指定行をインライン編集モードに切り替える。
 * @param {HTMLButtonElement} btn - 編集ボタン要素
 * @returns {Promise<void>}
 */
async function enterEditMode(btn) {
  const row   = btn.closest("tr");
  const cells = row.querySelectorAll("td");

  const rowId           = row.getAttribute("data-id");
  const categoryId      = row.getAttribute("data-category");
  const currentDate     = row.getAttribute("data-date");
  const currentItemId   = row.getAttribute("data-item-id");
  const currentMethodId = row.getAttribute("data-method-id");
  const currentAmount   = row.getAttribute("data-amount");
  const currentMemo     = row.getAttribute("data-memo");

  const dateForInput = currentDate.length === 8
    ? `${currentDate.slice(0, 4)}-${currentDate.slice(4, 6)}-${currentDate.slice(6, 8)}`
    : currentDate;

  const { items, methods } = await getMasterDataForCategory(categoryId);

  const itemOptions = items.map(item =>
    `<option value="${item.id}" ${item.id === currentItemId ? "selected" : ""}>${item.name}</option>`
  ).join("");

  const methodOptions = methods.map(method =>
    `<option value="${method.id}" ${method.id === currentMethodId ? "selected" : ""}>${method.name}</option>`
  ).join("");

  cells[0].innerHTML = `<input type="date"   class="edit-input" id="edit-date-${rowId}"   value="${dateForInput}">`;
  cells[1].innerHTML = `<select              class="edit-input" id="edit-item-${rowId}">${itemOptions}</select>`;
  cells[2].innerHTML = `<select              class="edit-input" id="edit-method-${rowId}">${methodOptions}</select>`;
  cells[3].innerHTML = `<input type="number" class="edit-input" id="edit-amount-${rowId}" value="${currentAmount}">`;
  cells[4].innerHTML = `<input type="text"   class="edit-input" id="edit-memo-${rowId}"   value="${currentMemo}">`;
  cells[5].innerHTML = `
    <div class="edit-actions">
      <button class="btn-small btn-save"        onclick="saveEdit(this)">保存</button>
      <button class="btn-small btn-cancel-edit" onclick="cancelEdit()">キャンセル</button>
    </div>
  `;
}

/**
 * インライン編集をキャンセルして履歴を再取得する。
 */
function cancelEdit() { fetchHistory(); }

/**
 * インライン編集の入力内容を Firestore に保存して履歴を再取得する。
 * @param {HTMLButtonElement} btn - 保存ボタン要素
 * @returns {Promise<void>}
 */
async function saveEdit(btn) {
  const row   = btn.closest("tr");
  const rowId = row.getAttribute("data-id");
  const uid   = getCurrentUserId();

  const dateValue   = document.getElementById(`edit-date-${rowId}`).value;
  const newItemId   = document.getElementById(`edit-item-${rowId}`).value;
  const newMethodId = document.getElementById(`edit-method-${rowId}`).value;
  const newAmount   = document.getElementById(`edit-amount-${rowId}`).value;
  const newMemo     = document.getElementById(`edit-memo-${rowId}`).value;

  if (!newAmount || Number(newAmount) < 0) { showError("金額を正しく入力してください。"); return; }
  if (!dateValue)                          { showError("日付を入力してください。");       return; }

  btn.disabled    = true;
  btn.textContent = "保存中...";

  const oldDate = row.getAttribute("data-date");
  const newDate = dateValue.replace(/-/g, "");

  try {
    const txRepo = new TransactionRepository(uid);
    await txRepo.update(rowId, {
      itemId:   newItemId,
      methodId: newMethodId,
      amount:   Number(newAmount),
      date:     newDate,
      memo:     newMemo,
    });
    updateMonthlySummaryForDate(uid, oldDate);
    if (newDate.slice(0, 6) !== oldDate.slice(0, 6)) {
      updateMonthlySummaryForDate(uid, newDate);
    }
    fetchHistory();
  } catch (err) {
    console.error(err);
    showError("エラーが発生しました: " + err.message);
    btn.disabled    = false;
    btn.textContent = "保存";
  }
}

// ─────────────────────────────────────────
// 削除
// ─────────────────────────────────────────

/**
 * 削除確認モーダルを開く。
 * @param {HTMLButtonElement} btn - 削除ボタン要素
 */
function showDeleteModal(btn) {
  manageState.deleteTargetRow = btn.closest("tr");
  document.getElementById("delete-modal").style.display = "flex";
}

/**
 * 削除確認モーダルを閉じて状態をリセットする。
 */
function closeDeleteModal() {
  manageState.deleteTargetRow = null;
  document.getElementById("delete-modal").style.display = "none";
}

/**
 * 削除確認後に Firestore からトランザクションを削除して履歴を再取得する。
 * @returns {Promise<void>}
 */
async function confirmDelete() {
  if (!manageState.deleteTargetRow) return;
  const rowId = manageState.deleteTargetRow.getAttribute("data-id");
  const date  = manageState.deleteTargetRow.getAttribute("data-date");
  const uid   = getCurrentUserId();

  try {
    const txRepo = new TransactionRepository(uid);
    await txRepo.delete(rowId);
    updateMonthlySummaryForDate(uid, date);
    closeDeleteModal();
    fetchHistory();
  } catch (err) {
    console.error(err);
    showError("エラーが発生しました: " + err.message);
  }
}
