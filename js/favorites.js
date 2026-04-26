// favorites.js
// お気に入り（項目・決済方法）の管理ページ
// users/{uid}/favorites/main を読み書きする
//
// State 構造:
//   activeCat:  "1" | "2" | "3"
//   activeKind: "items" | "methods"
//   master:     { items: { "1":[{id,name}], ... }, methods: { ... } }
//   favorites:  { items: { "1":[id,...], ... }, methods: { ... } }

const favState = {
  uid:        null,
  activeCat:  "1",
  activeKind: "items",
  master:     { items: { "1": [], "2": [], "3": [] }, methods: { "1": [], "2": [], "3": [] } },
  favorites:  { items: { "1": [], "2": [], "3": [] }, methods: { "1": [], "2": [], "3": [] } },
  repo:       null,
};

// ─────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  requireAuth(async () => {
    favState.uid  = getCurrentUserId();
    favState.repo = new FavoriteRepository(favState.uid);

    setupTabs();
    await loadAllData();
    render();
  });
});

/**
 * 全カテゴリのマスターデータとお気に入りを並列取得して state に格納する。
 */
async function loadAllData() {
  try {
    const [m1, m2, m3, fav] = await Promise.all([
      fetchMasterData(favState.uid, "1"),
      fetchMasterData(favState.uid, "2"),
      fetchMasterData(favState.uid, "3"),
      favState.repo.get(),
    ]);
    favState.master.items["1"]   = m1.items;
    favState.master.items["2"]   = m2.items;
    favState.master.items["3"]   = m3.items;
    favState.master.methods["1"] = m1.methods;
    favState.master.methods["2"] = m2.methods;
    favState.master.methods["3"] = m3.methods;
    favState.favorites = fav;
  } catch (err) {
    console.error("データ取得エラー:", err);
    showStatus("データの取得に失敗しました。", "error");
  }
}

// ─────────────────────────────────────────
// タブ
// ─────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll("#cat-tabs .fav-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      favState.activeCat = btn.dataset.cat;
      document.querySelectorAll("#cat-tabs .fav-tab").forEach(b => b.classList.toggle("active", b === btn));
      render();
    });
  });
  document.querySelectorAll("#kind-tabs .fav-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      favState.activeKind = btn.dataset.kind;
      document.querySelectorAll("#kind-tabs .fav-tab").forEach(b => b.classList.toggle("active", b === btn));
      render();
    });
  });
}

// ─────────────────────────────────────────
// 描画
// ─────────────────────────────────────────

function render() {
  renderFavorites();
  renderCandidates();
  updateCount();
}

/**
 * 現在のお気に入り一覧（順序保持、× ボタン、ドラッグハンドル）を描画。
 */
function renderFavorites() {
  const list  = document.getElementById("fav-list");
  const empty = document.getElementById("fav-empty");
  const ids   = favState.favorites[favState.activeKind][favState.activeCat] || [];
  const masterList = favState.master[favState.activeKind][favState.activeCat] || [];

  list.innerHTML = "";
  let visibleCount = 0;
  ids.forEach((id, idx) => {
    const m = masterList.find(x => x.id === id);
    if (!m) return; // 削除済み/非表示のものはスキップ
    list.appendChild(buildFavRow(m, idx));
    visibleCount++;
  });
  empty.style.display = visibleCount === 0 ? "block" : "none";

  setupListDrag(list);
}

/**
 * 候補リスト（マスターからお気に入り未登録のもの）を描画。
 * 5件到達時は + ボタンを disabled にする。
 */
function renderCandidates() {
  const list  = document.getElementById("candidate-list");
  const empty = document.getElementById("candidate-empty");
  const favIds = new Set(favState.favorites[favState.activeKind][favState.activeCat] || []);
  const masterList = favState.master[favState.activeKind][favState.activeCat] || [];

  const candidates = masterList.filter(m => !favIds.has(m.id));
  const isFull     = favIds.size >= FavoriteRepository.MAX_FAVORITES;

  list.innerHTML = "";
  candidates.forEach(m => list.appendChild(buildCandidateRow(m, isFull)));
  empty.style.display = candidates.length === 0 ? "block" : "none";
}

function updateCount() {
  const ids   = favState.favorites[favState.activeKind][favState.activeCat] || [];
  const max   = FavoriteRepository.MAX_FAVORITES;
  document.getElementById("fav-count").textContent = `${ids.length}/${max}`;
}

/**
 * お気に入り行の DOM を生成（ドラッグハンドル + 名前 + × ボタン）
 */
function buildFavRow(item, idx) {
  const li = document.createElement("li");
  li.className = "fav-row";
  li.dataset.id  = item.id;
  li.dataset.idx = String(idx);

  const handle = document.createElement("span");
  handle.className   = "fav-handle";
  handle.title       = "ドラッグで並び替え";
  handle.textContent = "⠿";

  const name = document.createElement("span");
  name.className   = "fav-name";
  name.textContent = item.name;

  const remove = document.createElement("button");
  remove.type        = "button";
  remove.className   = "btn-action btn-remove";
  remove.title       = "削除";
  remove.textContent = "×";
  remove.addEventListener("click", () => removeFavorite(item.id));

  li.append(handle, name, remove);
  return li;
}

/**
 * 候補行の DOM を生成（名前 + + ボタン）
 */
function buildCandidateRow(item, disabled) {
  const li = document.createElement("li");
  li.className   = "fav-row";
  li.dataset.id  = item.id;

  const name = document.createElement("span");
  name.className   = "fav-name";
  name.textContent = item.name;

  const add = document.createElement("button");
  add.type        = "button";
  add.className   = "btn-action btn-add";
  add.title       = disabled ? "お気に入りは最大5件です" : "追加";
  add.textContent = "+";
  add.disabled    = disabled;
  add.addEventListener("click", () => addFavorite(item.id));

  li.append(name, add);
  return li;
}

// ─────────────────────────────────────────
// 追加 / 削除 / 並び替え
// ─────────────────────────────────────────

async function addFavorite(id) {
  const ids = (favState.favorites[favState.activeKind][favState.activeCat] || []).slice();
  if (ids.length >= FavoriteRepository.MAX_FAVORITES) {
    showStatus(`お気に入りは最大${FavoriteRepository.MAX_FAVORITES}件までです。`, "warn");
    return;
  }
  if (ids.includes(id)) return;
  ids.push(id);
  await persist(ids);
}

async function removeFavorite(id) {
  const ids = (favState.favorites[favState.activeKind][favState.activeCat] || []).filter(x => x !== id);
  await persist(ids);
}

async function reorderFavorites(orderedIds) {
  await persist(orderedIds);
}

/**
 * 配列を Firestore に保存し、state を更新して再描画する。
 */
async function persist(orderedIds) {
  try {
    await favState.repo.setList(favState.activeKind, favState.activeCat, orderedIds);
    favState.favorites[favState.activeKind][favState.activeCat] = orderedIds.slice(0, FavoriteRepository.MAX_FAVORITES);
    showStatus("保存しました。", "success", 1500);
    render();
  } catch (err) {
    console.error("保存エラー:", err);
    showStatus("保存に失敗しました。", "error");
  }
}

// ─────────────────────────────────────────
// ドラッグ＆ドロップ並び替え
// ─────────────────────────────────────────

let dragSrc = null;

function setupListDrag(listEl) {
  listEl.querySelectorAll(".fav-row").forEach(row => {
    const handle = row.querySelector(".fav-handle");
    if (!handle) return;

    handle.addEventListener("mousedown", () => { row.draggable = true; });

    row.addEventListener("dragstart", e => {
      if (!row.draggable) { e.preventDefault(); return; }
      dragSrc = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    });

    row.addEventListener("dragend", () => {
      row.draggable = false;
      row.classList.remove("dragging");
      listEl.querySelectorAll(".fav-row").forEach(r => r.classList.remove("drag-over"));
      dragSrc = null;
    });
  });

  listEl.addEventListener("dragover", e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = e.target.closest(".fav-row");
    if (!target || target === dragSrc || !listEl.contains(target)) return;
    listEl.querySelectorAll(".fav-row").forEach(r => r.classList.toggle("drag-over", r === target));
  });

  listEl.addEventListener("drop", e => {
    e.preventDefault();
    listEl.querySelectorAll(".fav-row").forEach(r => r.classList.remove("drag-over"));
    if (!dragSrc) return;

    const target = e.target.closest(".fav-row");
    if (!target || target === dragSrc || !listEl.contains(target)) return;

    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      listEl.insertBefore(dragSrc, target);
    } else {
      listEl.insertBefore(dragSrc, target.nextSibling);
    }

    const orderedIds = [...listEl.querySelectorAll(".fav-row")].map(r => r.dataset.id);
    reorderFavorites(orderedIds);
  });
}

// ─────────────────────────────────────────
// ステータス表示
// ─────────────────────────────────────────

function showStatus(msg, type = "success", autoHideMs = 0) {
  const el = document.getElementById("fav-status");
  el.textContent  = msg;
  el.className    = `fav-status ${type}`;
  el.style.display = "block";
  if (autoHideMs > 0) {
    setTimeout(() => { el.style.display = "none"; }, autoHideMs);
  }
}
