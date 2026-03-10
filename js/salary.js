// salary.js
// 給与一括入力: 行追加・削除、ドラッグ&ドロップ並び替え、前回入力復元

// カテゴリ別マスターデータキャッシュ { "1": { items, methods }, "2": { ... } }
const masterCache = {};

// ドラッグ中の行を保持
let dragSrcRow = null;

const LS_KEY = "salary_last_input";

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("salary-date").value = getTodayISO();

  requireAuth(async () => {
    await loadAllMasterData();
    populateAllRows();
    setupTableDrag();
  });
});

// ─────────────────────────────────────────
// マスターデータ取得
// ─────────────────────────────────────────

async function loadAllMasterData() {
  const uid = getCurrentUserId();
  if (!uid) {
    alert("ユーザー情報が取得できません。再度ログインしてください。");
    window.location.href = "/html/login.html";
    return;
  }

  try {
    const [income, expense] = await Promise.all([
      fetchMasterData(uid, "1"),
      fetchMasterData(uid, "2"),
    ]);
    masterCache["1"] = income;
    masterCache["2"] = expense;
  } catch (err) {
    console.error("マスターデータ取得エラー:", err);
    alert("マスターデータの読み込みに失敗しました。");
  }
}

// ─────────────────────────────────────────
// テーブル行の初期化
// ─────────────────────────────────────────

/**
 * #salary-body の既存行すべてをカテゴリに合わせて初期化する。
 * data-default-item / data-default-method の名前で初期選択を設定する。
 */
function populateAllRows() {
  document.querySelectorAll("#salary-body tr").forEach(row => {
    const categoryId = row.dataset.category;
    if (!categoryId) return;

    const catSelect = row.querySelector(".row-category");
    if (catSelect) catSelect.value = categoryId;

    populateRowSelects(row, categoryId, {
      nameItem:   row.dataset.defaultItem,
      nameMethod: row.dataset.defaultMethod,
    });
    updateRowClass(row, categoryId);
  });
}

/**
 * 行のセレクトボックスをカテゴリに合わせて再生成する。
 * ID指定がある場合は ID で一致、なければ名前で一致させる。
 *
 * @param {HTMLElement} row
 * @param {string} categoryId
 * @param {{ nameItem?, nameMethod?, idItem?, idMethod? }} opts
 */
function populateRowSelects(row, categoryId, { nameItem = "", nameMethod = "", idItem = "", idMethod = "" } = {}) {
  const { items = [], methods = [] } = masterCache[categoryId] || {};

  const itemSelect = row.querySelector(".row-item");
  if (itemSelect) {
    itemSelect.innerHTML = '<option value="">選択してください</option>';
    items.forEach(item => {
      const opt       = document.createElement("option");
      opt.value       = item.id;
      opt.textContent = item.name;
      if (idItem ? item.id === idItem : (nameItem && item.name === nameItem)) opt.selected = true;
      itemSelect.appendChild(opt);
    });
  }

  const methodSelect = row.querySelector(".row-method");
  if (methodSelect) {
    methodSelect.innerHTML = '<option value="">選択してください</option>';
    methods.forEach(method => {
      const opt       = document.createElement("option");
      opt.value       = method.id;
      opt.textContent = method.name;
      if (idMethod ? method.id === idMethod : (nameMethod && method.name === nameMethod)) opt.selected = true;
      methodSelect.appendChild(opt);
    });
  }

  row.dataset.category = categoryId;
}

/**
 * 行のカテゴリに応じてクラスを付け替え、左ボーダーの色を変える。
 */
function updateRowClass(row, categoryId) {
  row.classList.remove("income-row", "expense-row");
  if (categoryId === "1")      row.classList.add("income-row");
  else if (categoryId === "2") row.classList.add("expense-row");
}

// ─────────────────────────────────────────
// 行の追加 / 削除
// ─────────────────────────────────────────

/**
 * テーブル末尾に新しい行を追加する。
 *
 * @param {{ categoryId?, nameItem?, nameMethod?, idItem?, idMethod?, amount?, memo? }} opts
 */
function addRow({ categoryId = "1", nameItem = "", nameMethod = "", idItem = "", idMethod = "", amount = "", memo = "" } = {}) {
  const tbody = document.getElementById("salary-body");
  const tr    = document.createElement("tr");
  tr.dataset.category = categoryId;

  tr.innerHTML = `
    <td class="col-drag"><span class="drag-handle" title="ドラッグで並び替え">⠿</span></td>
    <td class="col-category">
      <select class="row-category form-input" onchange="handleCategoryChange(this)">
        <option value="1">収入</option>
        <option value="2">支出</option>
      </select>
    </td>
    <td class="col-item"><select class="row-item form-input"><option value="">選択してください</option></select></td>
    <td class="col-method"><select class="row-method form-input"><option value="">選択してください</option></select></td>
    <td class="col-amount"><input type="number" class="row-amount form-input" min="0" step="1" placeholder="0"></td>
    <td class="col-memo"><input type="text" class="row-memo form-input" placeholder="メモ（任意）"></td>
    <td class="col-action"><button class="btn-delete" onclick="deleteRow(this)" title="行を削除">×</button></td>
  `;

  tbody.appendChild(tr);

  // カテゴリ選択を反映してセレクトを生成
  const catSelect = tr.querySelector(".row-category");
  catSelect.value = categoryId;
  populateRowSelects(tr, categoryId, { nameItem, nameMethod, idItem, idMethod });
  updateRowClass(tr, categoryId);

  // 値を安全に設定（XSS 防止）
  tr.querySelector(".row-amount").value = amount;
  tr.querySelector(".row-memo").value   = memo;

  setupRowDragEvents(tr);
}

/**
 * 削除ボタンから最も近い <tr> を削除する。
 */
function deleteRow(btn) {
  const row = btn.closest("tr");
  if (row) row.remove();
}

// ─────────────────────────────────────────
// カテゴリ変更ハンドラ
// ─────────────────────────────────────────

/**
 * カテゴリセレクト変更時に呼ばれ、行の項目・決済方法を再生成する。
 */
function handleCategoryChange(select) {
  const row        = select.closest("tr");
  const categoryId = select.value;
  populateRowSelects(row, categoryId);
  updateRowClass(row, categoryId);
}

// ─────────────────────────────────────────
// ドラッグ＆ドロップ
// ─────────────────────────────────────────

/**
 * tbody レベルのドラッグイベントを設定し、既存行にもハンドル起点のドラッグを設定する。
 */
function setupTableDrag() {
  const tbody = document.getElementById("salary-body");

  tbody.addEventListener("dragover", e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const targetRow = e.target.closest("tr");
    if (!targetRow || targetRow === dragSrcRow || !tbody.contains(targetRow)) return;

    tbody.querySelectorAll("tr").forEach(r => r.classList.remove("drag-over"));
    targetRow.classList.add("drag-over");
  });

  tbody.addEventListener("dragleave", e => {
    if (!tbody.contains(e.relatedTarget)) {
      tbody.querySelectorAll("tr").forEach(r => r.classList.remove("drag-over"));
    }
  });

  tbody.addEventListener("drop", e => {
    e.preventDefault();
    tbody.querySelectorAll("tr").forEach(r => r.classList.remove("drag-over"));
    if (!dragSrcRow) return;

    const targetRow = e.target.closest("tr");
    if (!targetRow || targetRow === dragSrcRow || !tbody.contains(targetRow)) return;

    // マウス位置でターゲット行の前後を判定
    const rect = targetRow.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      tbody.insertBefore(dragSrcRow, targetRow);
    } else {
      tbody.insertBefore(dragSrcRow, targetRow.nextSibling);
    }
  });

  tbody.addEventListener("dragend", () => {
    tbody.querySelectorAll("tr").forEach(r => r.classList.remove("drag-over"));
    if (dragSrcRow) {
      dragSrcRow.classList.remove("dragging");
      dragSrcRow = null;
    }
  });

  // 既存行にもドラッグイベントを設定
  document.querySelectorAll("#salary-body tr").forEach(setupRowDragEvents);
}

/**
 * 指定行にドラッグハンドル起点のドラッグイベントを設定する。
 * ハンドルを押したときだけ draggable を true にすることで、
 * セレクト・インプット操作中に誤ってドラッグが起動しないようにする。
 */
function setupRowDragEvents(row) {
  const handle = row.querySelector(".drag-handle");
  if (!handle) return;

  handle.addEventListener("mousedown", () => {
    row.draggable = true;
  });

  row.addEventListener("dragstart", e => {
    if (!row.draggable) { e.preventDefault(); return; }
    dragSrcRow = row;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ""); // Firefox 対応
  });

  row.addEventListener("dragend", () => {
    row.draggable = false;
  });
}

// ─────────────────────────────────────────
// localStorage 保存・復元
// ─────────────────────────────────────────

/**
 * 現在の行データを localStorage に保存する（送信成功時に呼ぶ）。
 */
function saveToLocalStorage() {
  const rows = [];
  document.querySelectorAll("#salary-body tr").forEach(row => {
    if (!row.dataset.category) return;
    rows.push({
      categoryId: row.dataset.category,
      idItem:     row.querySelector(".row-item")?.value   || "",
      idMethod:   row.querySelector(".row-method")?.value || "",
      amount:     row.querySelector(".row-amount")?.value || "",
      memo:       row.querySelector(".row-memo")?.value   || "",
    });
  });
  localStorage.setItem(LS_KEY, JSON.stringify(rows));
}

/**
 * localStorage に保存した前回の入力を反映する。
 * tbody をクリアして addRow() で再構築する。
 */
function loadFromLocalStorage() {
  const saved = localStorage.getItem(LS_KEY);
  if (!saved) {
    alert("保存された入力データがありません。\n先に一括送信を行うと次回から反映できます。");
    return;
  }

  let rows;
  try {
    rows = JSON.parse(saved);
  } catch {
    alert("保存データの読み込みに失敗しました。");
    return;
  }

  document.getElementById("salary-body").innerHTML = "";
  rows.forEach(r => addRow({
    categoryId: r.categoryId,
    idItem:     r.idItem,
    idMethod:   r.idMethod,
    amount:     r.amount,
    memo:       r.memo,
  }));
}

// ─────────────────────────────────────────
// 送信
// ─────────────────────────────────────────

/**
 * #salary-body の全行からデータを収集し、
 * 金額 > 0 かつ項目が選択されている行を Firestore へ一括登録する。
 */
async function submitSalary() {
  const uid       = getCurrentUserId();
  const dateInput = document.getElementById("salary-date").value;
  if (!dateInput) { alert("日付を選択してください。"); return; }

  const date = dateInput.replace(/-/g, ""); // YYYYMMDD

  const transactions = [];
  document.querySelectorAll("#salary-body tr").forEach(row => {
    const categoryId = row.dataset.category;
    if (!categoryId) return;

    const itemSelect   = row.querySelector(".row-item");
    const methodSelect = row.querySelector(".row-method");
    const amountInput  = row.querySelector(".row-amount");
    const memoInput    = row.querySelector(".row-memo");

    const amount = Number(amountInput?.value);
    if (!amount || amount <= 0) return;

    const itemId     = itemSelect?.value                       || "";
    const itemName   = itemSelect?.selectedOptions[0]?.text   || "";
    const methodId   = methodSelect?.value                     || "";
    const methodName = methodSelect?.selectedOptions[0]?.text || "";
    const memo       = memoInput?.value.trim()                 || "";

    if (!itemId) return;

    transactions.push({ itemId, itemName, methodId, methodName, categoryId, amount, date, memo });
  });

  if (transactions.length === 0) {
    alert("送信できるデータがありません。\n金額を1件以上入力してください。");
    return;
  }

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled    = true;
  submitBtn.textContent = "送信中...";

  try {
    const txRepo = new TransactionRepository(uid);

    await Promise.all(
      transactions.map(tx =>
        txRepo.add({
          itemId:        tx.itemId,
          itemName:      tx.itemName,
          methodId:      tx.methodId,
          methodName:    tx.methodName,
          categoryId:    tx.categoryId,
          amount:        tx.amount,
          date:          tx.date,
          memo:          tx.memo,
          isGroupShared: false,
        })
      )
    );

    await updateMonthlySummaryForDate(uid, date);
    saveToLocalStorage();
    alert(`${transactions.length}件のデータを送信しました。`);
    window.location.href = "/html/menu.html";

  } catch (err) {
    console.error("送信エラー:", err);
    alert("エラーが発生しました: " + err.message);
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "一括送信";
  }
}
