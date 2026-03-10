// master_manage.js
// 項目・方法のマスター管理（作成/編集/非表示/並び替え）
// 変更は「確定」ボタンを押すまで Firestore に送信しない。

// ─────────────────────────────────────────
// ページ状態
// ─────────────────────────────────────────

let currentType       = "item";   // "item" | "method"
let currentCategoryId = CATEGORY.INCOME;
let currentList       = [];
let sortableInstance  = null;
let editTargetId      = null;     // null = 追加モード
let uid               = null;
let hasGroup          = false;
let targetUid         = null;     // 方法タブで選択中のユーザー UID（null = 自分）

/**
 * 方法タブで操作対象のユーザー UID を返す。
 * @returns {string|null}
 */
function getMethodUid() {
  return targetUid || uid;
}

// ─────────────────────────────────────────
// 保留中の変更管理
// ─────────────────────────────────────────

/**
 * 未確定の変更を一元管理するオブジェクト。
 * 確定ボタン押下時に Firestore へ書き込む。
 */
const pendingChanges = {
  newItems:  new Map(),  // tempId → item data
  existing:  new Map(),  // id → partial changes { name?, isHidden?, isGroupShared? }
  sortOrder: null,       // null = 変更なし | string[] = 現在の表示順 ID リスト
  isDirty:   false,

  /**
   * 全保留変更をリセットする。
   */
  reset() {
    this.newItems  = new Map();
    this.existing  = new Map();
    this.sortOrder = null;
    this.isDirty   = false;
  },

  /**
   * 変更ありフラグを立てる。
   */
  markDirty() { this.isDirty = true; },
};

let newItemCounter = 0;

/**
 * 変更ありフラグと確定バーの表示を同期する。
 * dirty=false の場合は保留変更も全リセットする。
 * @param {boolean} dirty - 変更ありなら true
 */
function setDirty(dirty) {
  pendingChanges.isDirty = dirty;
  document.getElementById("confirm-bar").style.display = dirty ? "flex" : "none";
  if (!dirty) {
    pendingChanges.reset();
    newItemCounter = 0;
  }
}

/**
 * 保留中の変更を Firestore に確定保存する。
 * @returns {Promise<void>}
 */
async function confirmChanges() {
  const btn = document.getElementById("confirm-btn");
  btn.disabled    = true;
  btn.textContent = "保存中...";

  try {
    const tempToReal = {};

    // 1. 新規アイテムを Firestore に作成して実 ID を取得
    for (const [tempId, ni] of pendingChanges.newItems) {
      let realId;
      if (currentType === "item") {
        const repo = new ItemRepository(ni.categoryId);
        realId = await repo.add(ni.categoryId, ni.name);
        if (ni.isHidden) await repo.setHidden(realId, true);
      } else {
        const repo = new MethodRepository(getMethodUid(), ni.categoryId);
        realId = await repo.add(ni.categoryId, { name: ni.name, isGroupShared: ni.isGroupShared });
        if (ni.isHidden) await repo.setHidden(realId, true);
      }
      tempToReal[tempId] = realId;
    }

    // 2. 既存アイテムの変更を Firestore に書き込み
    for (const [id, changes] of pendingChanges.existing) {
      if (currentType === "item") {
        const repo = new ItemRepository(currentCategoryId);
        if (changes.name     !== undefined) await repo.updateName(id, changes.name);
        if (changes.isHidden !== undefined) await repo.setHidden(id, changes.isHidden);
      } else {
        const repo = new MethodRepository(getMethodUid(), currentCategoryId);
        if (changes.name !== undefined || changes.isGroupShared !== undefined) {
          const item = currentList.find(i => i.id === id);
          await repo.updateMethod(id, {
            name:          changes.name          ?? item?.name          ?? "",
            isGroupShared: changes.isGroupShared ?? item?.isGroupShared ?? false,
          });
        }
        if (changes.isHidden !== undefined) await repo.setHidden(id, changes.isHidden);
      }
    }

    // 3. 並び順を保存（tempId → realId に置換）
    if (pendingChanges.sortOrder) {
      const realOrder = pendingChanges.sortOrder.map(id => tempToReal[id] || id);
      if (currentType === "item") {
        await saveItemSortOrders(currentCategoryId, realOrder);
      } else {
        const repo = new MethodRepository(getMethodUid(), currentCategoryId);
        await repo.updateSortOrders(realOrder);
      }
    }

    setDirty(false);
    showSuccess("保存しました。");
    location.href = "../html/menu.html";
  } catch (e) {
    console.error("確定エラー:", e);
    showError("保存に失敗しました: " + e.message);
    btn.disabled    = false;
    btn.textContent = "確定";
  }
}

/**
 * 保留中の変更を破棄してリストを再読み込みする。
 * @returns {Promise<void>}
 */
async function cancelChanges() {
  setDirty(false);
  await loadList();
}

// ─────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  requireAuth(user => {
    const userName = sessionStorage.getItem("userName") || "";
    if (userName !== "admin") {
      showError("この機能は管理者のみ使用できます。");
      location.href = "../html/menu.html";
      return;
    }
    uid      = user.uid;
    hasGroup = !!(sessionStorage.getItem("groupId") || "");
    loadUserList().then(() => loadList());
  });
});

// ─────────────────────────────────────────
// ユーザー一覧（方法タブ用）
// ─────────────────────────────────────────

/**
 * Firestore の users コレクションからユーザー一覧を取得してセレクタを初期化する。
 * @returns {Promise<void>}
 */
async function loadUserList() {
  try {
    const snap = await db.collection("users").get();
    const users = snap.docs
      .map(doc => ({ uid: doc.id, userName: doc.data().userName || doc.id }))
      .sort((a, b) => a.userName.localeCompare(b.userName, "ja"));

    const sel = document.getElementById("target-user-select");
    sel.innerHTML = users
      .map(u => `<option value="${u.uid}">${escapeHtml(u.userName)}</option>`)
      .join("");

    // デフォルト選択: 管理者自身
    targetUid = uid;
    sel.value  = uid;
  } catch (e) {
    console.warn("ユーザー一覧の取得に失敗:", e.message);
  }
}

/**
 * ユーザー選択セレクタの変更時に、未保存の確認をしてリストを再読み込みする。
 */
function onUserSelectChange() {
  if (pendingChanges.isDirty) {
    if (!confirm("未保存の変更があります。変更を破棄して切り替えますか？")) {
      document.getElementById("target-user-select").value = targetUid || uid;
      return;
    }
    setDirty(false);
  }
  targetUid = document.getElementById("target-user-select").value || uid;
  loadList();
}

// ─────────────────────────────────────────
// タブ切り替え
// ─────────────────────────────────────────

/**
 * 項目タブと方法タブを切り替える。
 * @param {string} type - "item" または "method"
 */
function switchType(type) {
  if (pendingChanges.isDirty) {
    if (!confirm("未保存の変更があります。変更を破棄して切り替えますか？")) return;
    setDirty(false);
  }
  currentType = type;

  document.getElementById("tab-item").classList.toggle("active",   type === "item");
  document.getElementById("tab-method").classList.toggle("active", type === "method");

  const thGroupShared  = document.getElementById("th-group-shared");
  const infoNote       = document.getElementById("info-note-item");
  const userSelectRow  = document.getElementById("user-select-row");
  if (type === "item") {
    thGroupShared.style.display  = "none";
    infoNote.style.display       = "";
    userSelectRow.style.display  = "none";
  } else {
    thGroupShared.style.display  = "";
    infoNote.style.display       = "none";
    userSelectRow.style.display  = "";
  }

  loadList();
}

/**
 * カテゴリタブを切り替える。
 * @param {string} id - カテゴリ ID
 */
function switchCategory(id) {
  if (pendingChanges.isDirty) {
    if (!confirm("未保存の変更があります。変更を破棄して切り替えますか？")) return;
    setDirty(false);
  }
  currentCategoryId = id;

  [CATEGORY.INCOME, CATEGORY.EXPENSE, CATEGORY.CHARGE].forEach(cid => {
    const btn = document.getElementById(`cat-${cid}`);
    if (!btn) return;
    btn.classList.remove("active", "active-income", "active-expense", "active-charge");
    if (cid === id) {
      btn.classList.add("active");
      if (cid === CATEGORY.INCOME)  btn.classList.add("active-income");
      if (cid === CATEGORY.EXPENSE) btn.classList.add("active-expense");
      if (cid === CATEGORY.CHARGE)  btn.classList.add("active-charge");
    }
  });

  loadList();
}

// ─────────────────────────────────────────
// 項目の並び順を settings/itemSortOrder に保存・読み込み
// ─────────────────────────────────────────

/**
 * settings/itemSortOrder から指定カテゴリの並び順 ID 配列を取得する。
 * @param {string} categoryId - カテゴリ ID
 * @returns {Promise<string[]|null>}
 */
async function getItemSortOrders(categoryId) {
  try {
    const doc = await db.doc("settings/itemSortOrder").get();
    if (doc.exists && Array.isArray(doc.data()[categoryId])) {
      return doc.data()[categoryId];
    }
  } catch (e) {
    console.warn("itemSortOrder 取得エラー:", e.message);
  }
  return null;
}

/**
 * settings/itemSortOrder に指定カテゴリの並び順を保存する。
 * @param {string} categoryId - カテゴリ ID
 * @param {string[]} orderedIds - 並び順の ID 配列
 * @returns {Promise<void>}
 */
async function saveItemSortOrders(categoryId, orderedIds) {
  await db.doc("settings/itemSortOrder").set(
    { [categoryId]: orderedIds },
    { merge: true }
  );
}

/**
 * 並び順 ID 配列に従ってアイテムリストをソートして返す。
 * @param {Array<{ id: string, name: string }>} items - ソート対象
 * @param {string[]|null} sortOrderIds - 並び順 ID 配列
 * @returns {Array}
 */
function applyItemSortOrder(items, sortOrderIds) {
  if (!sortOrderIds || sortOrderIds.length === 0) return items;
  const idIndex = Object.fromEntries(sortOrderIds.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ai = idIndex[a.id] ?? 9999;
    const bi = idIndex[b.id] ?? 9999;
    return ai - bi || a.name.localeCompare(b.name, "ja");
  });
}

// ─────────────────────────────────────────
// データ読み込み・描画
// ─────────────────────────────────────────

/**
 * 現在のタブ・カテゴリのマスターリストを Firestore から読み込んで描画する。
 * @returns {Promise<void>}
 */
async function loadList() {
  showStatus("読み込み中...");
  try {
    if (currentType === "item") {
      const repo = new ItemRepository(currentCategoryId);
      let list = await repo.getAllForManage(currentCategoryId);
      const sortOrderIds = await getItemSortOrders(currentCategoryId);
      if (sortOrderIds) list = applyItemSortOrder(list, sortOrderIds);
      currentList = list;
    } else {
      const repo = new MethodRepository(getMethodUid(), currentCategoryId);
      currentList = await repo.getAllForManage(currentCategoryId);
    }
    hideStatus();
    renderTable(currentList);
  } catch (e) {
    console.error("読み込みエラー:", e);
    showStatus("データの取得に失敗しました: " + e.message);
  }
}

/**
 * マスターリストをテーブルに描画する。
 * @param {Array} list - 描画するアイテムリスト
 */
function renderTable(list) {
  const tbody = document.getElementById("master-tbody");
  tbody.innerHTML = "";

  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align:center; color:#999; padding:24px;">データがありません</td>`;
    tbody.appendChild(tr);
    initSortable(tbody);
    return;
  }

  list.forEach(item => {
    const tr = document.createElement("tr");
    tr.dataset.id = item.id;
    if (item.isHidden) tr.classList.add("hidden-row");

    const statusBadge = item.isHidden
      ? `<span class="badge badge-hidden">非表示</span>`
      : `<span class="badge badge-visible">表示中</span>`;

    const toggleBtn = item.isHidden
      ? `<button class="btn-sm btn-show-sm" onclick="toggleHidden('${item.id}', false)">表示する</button>`
      : `<button class="btn-sm btn-hide-sm" onclick="toggleHidden('${item.id}', true)">非表示</button>`;

    let groupCell = "";
    if (currentType === "method") {
      const sharedBadge = item.isGroupShared
        ? `<span class="badge badge-shared">共有</span>`
        : `<span class="badge badge-personal">個人</span>`;
      groupCell = `<td>${sharedBadge}</td>`;
    }

    const editBtn = currentType === "item"
      ? `<button class="btn-sm btn-edit-sm" onclick="showEditModal('${item.id}', '${escapeAttr(item.name)}')">編集</button>`
      : `<button class="btn-sm btn-edit-sm" onclick="showEditModal('${item.id}', '${escapeAttr(item.name)}', ${item.isGroupShared})">編集</button>`;

    tr.innerHTML = `
      <td><span class="drag-handle" title="ドラッグで並び替え">☰</span></td>
      <td>${escapeHtml(item.name)}</td>
      ${groupCell}
      <td>${statusBadge}</td>
      <td class="action-cell">${editBtn}${toggleBtn}</td>
    `;
    tbody.appendChild(tr);
  });

  initSortable(tbody);
}

// ─────────────────────────────────────────
// SortableJS
// ─────────────────────────────────────────

/**
 * テーブルボディに SortableJS をアタッチする。
 * @param {HTMLTableSectionElement} tbody - 対象の tbody 要素
 */
function initSortable(tbody) {
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
  sortableInstance = Sortable.create(tbody, {
    handle:      ".drag-handle",
    animation:   150,
    ghostClass:  "sortable-ghost",
    chosenClass: "sortable-chosen",
    onEnd:       onDragEnd,
  });
}

/**
 * ドラッグ終了時に並び順を保留変更に記録する。
 */
function onDragEnd() {
  const tbody = document.getElementById("master-tbody");
  const orderedIds = Array.from(tbody.querySelectorAll("tr[data-id]"))
    .map(tr => tr.dataset.id);

  pendingChanges.sortOrder = orderedIds;
  const idToItem = Object.fromEntries(currentList.map(i => [i.id, i]));
  currentList = orderedIds.map(id => idToItem[id]).filter(Boolean);
  setDirty(true);
}

// ─────────────────────────────────────────
// モーダル（追加/編集）
// ─────────────────────────────────────────

/**
 * 追加モーダルを開く。
 */
function showAddModal() {
  editTargetId = null;
  document.getElementById("modal-title").textContent =
    currentType === "item" ? "項目を追加" : "方法を追加";
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-save-btn").textContent = "追加";

  const groupRow = document.getElementById("group-shared-row");
  if (currentType === "method" && hasGroup) {
    groupRow.style.display = "";
    document.getElementById("modal-group-shared").checked = false;
  } else {
    groupRow.style.display = "none";
  }

  document.getElementById("modal-edit").style.display = "flex";
  setTimeout(() => document.getElementById("modal-name").focus(), 50);
}

/**
 * 編集モーダルを開いて現在の値を反映する。
 * @param {string} id - 編集するアイテムの ID
 * @param {string} name - 現在の名前
 * @param {boolean} [isGroupShared=false] - グループ共有フラグ（方法タブのみ）
 */
function showEditModal(id, name, isGroupShared = false) {
  editTargetId = id;
  document.getElementById("modal-title").textContent =
    currentType === "item" ? "項目を編集" : "方法を編集";
  document.getElementById("modal-name").value = name;
  document.getElementById("modal-save-btn").textContent = "保存";

  const groupRow = document.getElementById("group-shared-row");
  if (currentType === "method" && hasGroup) {
    groupRow.style.display = "";
    document.getElementById("modal-group-shared").checked = !!isGroupShared;
  } else {
    groupRow.style.display = "none";
  }

  document.getElementById("modal-edit").style.display = "flex";
  setTimeout(() => document.getElementById("modal-name").focus(), 50);
}

/**
 * 追加/編集モーダルを閉じる。
 */
function closeModal() {
  document.getElementById("modal-edit").style.display = "none";
}

/**
 * モーダルの入力内容を保留変更に記録してリストを再描画する。
 */
function saveModal() {
  const name = document.getElementById("modal-name").value.trim();
  if (!name) {
    showError("名前を入力してください。");
    return;
  }

  const isGroupShared = document.getElementById("modal-group-shared").checked;

  if (editTargetId) {
    // 編集: ローカル状態だけ更新して保留キューに追加
    const item = currentList.find(i => i.id === editTargetId);
    if (item) {
      item.name = name;
      if (currentType === "method") item.isGroupShared = isGroupShared;
    }
    if (editTargetId.startsWith("new_")) {
      // 未確定の新規アイテムを編集: pendingChanges.newItems を上書き
      const ni = pendingChanges.newItems.get(editTargetId);
      if (ni) {
        ni.name = name;
        if (currentType === "method") ni.isGroupShared = isGroupShared;
      }
    } else {
      // 既存アイテムの変更を記録
      const changes = pendingChanges.existing.get(editTargetId) || {};
      pendingChanges.existing.set(editTargetId, {
        ...changes,
        name,
        ...(currentType === "method" ? { isGroupShared } : {}),
      });
    }
  } else {
    // 新規追加: temp ID を振ってローカルリストに追加
    const tempId  = `new_${newItemCounter++}`;
    const newItem = {
      id:            tempId,
      categoryId:    currentCategoryId,
      name,
      isGroupShared: currentType === "method" ? isGroupShared : false,
      isHidden:      false,
      sortOrder:     9999,
    };
    currentList.push(newItem);
    pendingChanges.newItems.set(tempId, { ...newItem });
    // 並び順が既に設定されている場合は末尾に追加
    if (pendingChanges.sortOrder) pendingChanges.sortOrder.push(tempId);
  }

  setDirty(true);
  closeModal();
  renderTable(currentList);
}

// Enterキーで保存、Escapeで閉じる
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && document.getElementById("modal-edit").style.display !== "none") {
    saveModal();
  }
  if (e.key === "Escape" && document.getElementById("modal-edit").style.display !== "none") {
    closeModal();
  }
});

// ─────────────────────────────────────────
// 非表示切替（ローカル状態のみ更新、Firestore への書き込みは確定時）
// ─────────────────────────────────────────

/**
 * アイテムの非表示フラグをローカルで切り替えて保留変更に記録する。
 * @param {string} id       - アイテムの ID
 * @param {boolean} isHidden - 非表示にするなら true
 */
function toggleHidden(id, isHidden) {
  const item = currentList.find(i => i.id === id);
  if (!item) return;
  item.isHidden = isHidden;

  if (id.startsWith("new_")) {
    const ni = pendingChanges.newItems.get(id);
    if (ni) ni.isHidden = isHidden;
  } else {
    const changes = pendingChanges.existing.get(id) || {};
    pendingChanges.existing.set(id, { ...changes, isHidden });
  }

  setDirty(true);
  renderTable(currentList);
}

// ─────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────

/**
 * @param {string} msg - 表示するメッセージ
 */
function showStatus(msg) {
  const el = document.getElementById("status-msg");
  el.textContent   = msg;
  el.style.display = "";
}

/**
 * ステータスメッセージを非表示にする。
 */
function hideStatus() {
  document.getElementById("status-msg").style.display = "none";
}

/**
 * @param {string} str - エスケープする文字列
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} str - エスケープする文字列
 * @returns {string}
 */
function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
}
