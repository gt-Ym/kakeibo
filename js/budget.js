// budget.js
// 予算管理ページ（budget.html）の処理
// カテゴリタブ切替・月次予算目標の表示・インライン編集
// データは Firestore の users/{uid}/budgetTargets/{itemId} に保存される

// ─────────────────────────────────────────
// ページ状態
// ─────────────────────────────────────────

const budgetState = {
  uid:        null,
  categoryId: CATEGORY.EXPENSE,  // デフォルト: 支出
  year:       null,
  month:      null,
  items:      [],   // [{ id, name }]
  targets:    {},   // { itemId: amount }
  actuals:    {},   // { itemName: amount }
  editingId:  null,
};

document.addEventListener("DOMContentLoaded", () => {
  budgetState.uid = getCurrentUserId();
  if (!budgetState.uid) return;

  const now          = new Date();
  budgetState.year   = String(now.getFullYear());
  budgetState.month  = String(now.getMonth() + 1).padStart(2, "0");

  const labelEl = document.getElementById("budget-month-label");
  if (labelEl) labelEl.textContent = `${budgetState.year}年${Number(budgetState.month)}月`;

  _activateBudgetTab(CATEGORY.EXPENSE);
  loadBudget();
});

// ─────────────────────────────────────────
// タブ切替
// ─────────────────────────────────────────

/**
 * 予算カテゴリタブを切り替えてデータを再読み込みする。
 * @param {string} categoryId - 切り替え先のカテゴリ ID
 */
function switchBudgetCategory(categoryId) {
  if (budgetState.categoryId === categoryId) return;
  if (budgetState.editingId) _cancelBudgetEdit();
  budgetState.categoryId = categoryId;
  _activateBudgetTab(categoryId);
  loadBudget();
}

/**
 * @param {string} categoryId - アクティブにするカテゴリ ID
 */
function _activateBudgetTab(categoryId) {
  const colorMap = {
    [CATEGORY.INCOME]:  "income",
    [CATEGORY.EXPENSE]: "expense",
    [CATEGORY.CHARGE]:  "charge",
  };
  [CATEGORY.INCOME, CATEGORY.EXPENSE, CATEGORY.CHARGE].forEach(cid => {
    const btn = document.getElementById(`budget-cat-${cid}`);
    if (!btn) return;
    btn.className = "budget-tab";
    if (cid === categoryId) btn.classList.add("active", `active-${colorMap[cid]}`);
  });
}

// ─────────────────────────────────────────
// データ読み込み
// ─────────────────────────────────────────

/**
 * 現在のカテゴリ・年月の予算データを Firestore から読み込んでテーブルを描画する。
 * @returns {Promise<void>}
 */
async function loadBudget() {
  _setBudgetTbody(`<tr><td colspan="4" class="budget-empty">読み込み中...</td></tr>`);
  try {
    const budgetRepo = new BudgetTargetRepository(budgetState.uid);
    const [itemsRaw, summarySnap, targetsMap, sortDoc] = await Promise.all([
      new ItemRepository(budgetState.categoryId).getAll(),
      db.doc(`users/${budgetState.uid}/monthlySummary/${budgetState.year}/months/${budgetState.month}`)
        .get().catch(() => null),
      budgetRepo.getByCategoryId(budgetState.categoryId),
      db.doc("settings/itemSortOrder").get().catch(() => null),
    ]);

    let items = itemsRaw;
    if (sortDoc && sortDoc.exists) {
      const sortOrderIds = sortDoc.data()[budgetState.categoryId];
      if (Array.isArray(sortOrderIds) && sortOrderIds.length > 0) {
        const idIndex = Object.fromEntries(sortOrderIds.map((id, i) => [id, i]));
        items = itemsRaw.slice().sort((a, b) =>
          (idIndex[a.id] ?? 9999) - (idIndex[b.id] ?? 9999) || a.name.localeCompare(b.name, "ja")
        );
      }
    }
    budgetState.items = items;

    budgetState.actuals = {};
    if (summarySnap && summarySnap.exists) {
      const catData = summarySnap.data()[budgetState.categoryId];
      if (catData && catData.items) budgetState.actuals = catData.items;
    }

    budgetState.targets = targetsMap; // { itemId: amount }

    _renderBudgetTable();
  } catch (e) {
    console.error("予算読み込みエラー:", e);
    _setBudgetTbody(`<tr><td colspan="4" class="budget-empty" style="color:#dc2626;">読み込みに失敗しました</td></tr>`);
  }
}

// ─────────────────────────────────────────
// テーブル描画
// ─────────────────────────────────────────

/**
 * 予算テーブルを現在の状態から再描画する。
 */
function _renderBudgetTable() {
  const tbody = document.getElementById("budget-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (budgetState.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="budget-empty">項目がありません</td></tr>`;
    return;
  }

  const isIncome = budgetState.categoryId === CATEGORY.INCOME;

  budgetState.items.forEach(item => {
    const target = budgetState.targets[item.id] ?? 0;
    const actual = budgetState.actuals[item.name] ?? 0;

    let progressHtml = "";
    if (target > 0) {
      const pct   = Math.round((actual / target) * 100);
      const fill  = Math.min(pct, 100);
      const color = isIncome
        ? (pct >= 100 ? "#16a34a" : "#4a90e2")
        : (pct >= 100 ? "#dc2626" : pct >= 80 ? "#f97316" : "#16a34a");
      const overClass = (!isIncome && pct >= 100) ? " over-budget" : "";
      progressHtml = `
        <div class="budget-progress-wrap">
          <div class="budget-bar"><div class="budget-bar-fill" style="width:${fill}%;background:${color}"></div></div>
          <span class="budget-pct${overClass}">${pct}%</span>
        </div>`;
    }

    const tr = document.createElement("tr");
    tr.dataset.id = item.id;
    tr.innerHTML = `
      <td class="budget-name">${_escHtml(item.name)}</td>
      <td class="budget-target-cell">
        <span class="budget-target-val">${target > 0 ? "¥" + target.toLocaleString() : "—"}</span>
      </td>
      <td class="budget-actual-cell">
        <span class="budget-actual-val">¥${actual.toLocaleString()}</span>
        ${progressHtml}
      </td>
      <td class="budget-action-cell">
        <button class="budget-edit-btn" onclick="startBudgetEdit('${item.id}')">編集</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ─────────────────────────────────────────
// インライン編集
// ─────────────────────────────────────────

/**
 * 指定項目の予算をインライン編集モードにする。
 * @param {string} itemId - 編集する項目の ID
 */
function startBudgetEdit(itemId) {
  if (budgetState.editingId) _cancelBudgetEdit();
  budgetState.editingId = itemId;

  const tr = document.querySelector(`#budget-tbody tr[data-id="${itemId}"]`);
  if (!tr) return;

  const cell = tr.querySelector(".budget-target-cell");
  const cur  = budgetState.targets[itemId] ?? 0;
  cell.innerHTML = `
    <input type="number" class="budget-input" id="budget-input-field"
           value="${cur}" min="0" step="1000" />
    <div class="budget-edit-btns">
      <button class="budget-save-btn" onclick="saveBudgetTarget('${itemId}')">保存</button>
      <button class="budget-cancel-btn" onclick="_cancelBudgetEdit()">取消</button>
    </div>`;

  const inp = document.getElementById("budget-input-field");
  if (inp) { inp.focus(); inp.select(); }
}

/**
 * インライン編集をキャンセルして元の表示に戻す。
 */
function _cancelBudgetEdit() {
  if (!budgetState.editingId) return;
  const tr = document.querySelector(`#budget-tbody tr[data-id="${budgetState.editingId}"]`);
  if (tr) {
    const cell = tr.querySelector(".budget-target-cell");
    const val  = budgetState.targets[budgetState.editingId] ?? 0;
    cell.innerHTML = `<span class="budget-target-val">${val > 0 ? "¥" + val.toLocaleString() : "—"}</span>`;
  }
  budgetState.editingId = null;
}

/**
 * 入力された予算額を Firestore に保存してテーブルを再描画する。
 * @param {string} itemId - 保存する項目の ID
 * @returns {Promise<void>}
 */
async function saveBudgetTarget(itemId) {
  const inp = document.getElementById("budget-input-field");
  if (!inp) return;
  const amount = Math.max(0, parseInt(inp.value, 10) || 0);

  try {
    budgetState.targets[itemId] = amount;
    const item     = budgetState.items.find(i => i.id === itemId);
    const itemName = item ? item.name : "";
    const repo     = new BudgetTargetRepository(budgetState.uid);
    await repo.set(itemId, { amount, categoryId: budgetState.categoryId, itemName });
    budgetState.editingId = null;
    _renderBudgetTable();
  } catch (e) {
    console.error("予算保存エラー:", e);
    showError("保存に失敗しました: " + e.message);
  }
}

// ─────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────

/**
 * @param {string} html - 設定する innerHTML
 */
function _setBudgetTbody(html) {
  const tbody = document.getElementById("budget-tbody");
  if (tbody) tbody.innerHTML = html;
}

/**
 * @param {string} s - エスケープする文字列
 * @returns {string}
 */
function _escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
