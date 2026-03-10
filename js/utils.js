// utils.js
// 全ページ共通のユーティリティ関数
// firebase.js・firebaseDb.js より後に読み込むこと（auth・db・各 Repository が定義済みであること）

// ─────────────────────────────────────────
// カテゴリ定数
// ─────────────────────────────────────────

/**
 * カテゴリ ID の定数。JS ロジック内で文字列リテラルの代わりに使用する。
 * HTML の select option value や Firestore クエリ文字列はそのまま。
 */
const CATEGORY = Object.freeze({ INCOME: "1", EXPENSE: "2", CHARGE: "3" });

// ─────────────────────────────────────────
// 通知ヘルパー
// ─────────────────────────────────────────

/**
 * エラーメッセージをユーザーに通知する（将来的にトースト通知などに変更しやすいよう一元化）。
 * @param {string} message - 表示するエラーメッセージ
 */
function showError(message) {
  alert(message);
}

/**
 * 成功メッセージをユーザーに通知する（将来的にトースト通知などに変更しやすいよう一元化）。
 * @param {string} message - 表示する成功メッセージ
 */
function showSuccess(message) {
  alert(message);
}

// ─────────────────────────────────────────
// 認証
// ─────────────────────────────────────────

/**
 * Firebase Auth の認証状態を一度だけ確認し、認証済みなら onReady() を呼び出す。
 * 未認証の場合は login.html へリダイレクトする。
 *
 * 各ページの DOMContentLoaded 内で使用する:
 *   requireAuth(() => { fetchData(); });
 *
 * @param {function(firebase.User): void} onReady - 認証確認後に実行するコールバック
 */
function requireAuth(onReady) {
  const unsubscribe = auth.onAuthStateChanged(function (user) {
    unsubscribe();
    if (!user) {
      window.location.href = "/html/login.html";
      return;
    }
    onReady(user);
  });
}

/**
 * sessionStorage から userId を取得する。
 * @returns {string|null}
 */
function getCurrentUserId() {
  return sessionStorage.getItem("userId");
}

// ─────────────────────────────────────────
// 日付
// ─────────────────────────────────────────

/**
 * 日付文字列（YYYYMMDD / YYYY-MM-DD / YYYY/MM/DD）を「YYYY/MM/DD」形式に変換する。
 * @param {string|Date} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  const s = String(dateStr).replace(/[-/]/g, "");
  if (s.length === 8) return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`;
  return String(dateStr);
}

/**
 * 今日の日付を「YYYY-MM-DD」形式で返す（input[type=date] の value に使用する）。
 * @returns {string}
 */
function getTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ─────────────────────────────────────────
// UI ヘルパー
// ─────────────────────────────────────────

/**
 * <select> 要素のオプションを items で置き換える。
 * @param {HTMLSelectElement} selectEl   - 対象の select 要素
 * @param {Array<{id: string, name: string}>} items
 * @param {string} [defaultLabel="選択してください"] - 先頭に追加するデフォルト選択肢のラベル
 */
function populateSelect(selectEl, items, defaultLabel = "選択してください") {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">${defaultLabel}</option>`;
  items.forEach(item => {
    const opt       = document.createElement("option");
    opt.value       = item.id;
    opt.textContent = item.name;
    selectEl.appendChild(opt);
  });
}

/**
 * 年月セレクタを初期化する（過去4年分の年を追加し、今年・今月をデフォルト選択）。
 * @param {string} [yearSelectId="searchYear"]
 * @param {string} [monthSelectId="searchMonth"]
 */
function initializeDateFilters(yearSelectId = "searchYear", monthSelectId = "searchMonth") {
  const yearSelect  = document.getElementById(yearSelectId);
  const monthSelect = document.getElementById(monthSelectId);
  if (!yearSelect || !monthSelect) return;

  const now         = new Date();
  const currentYear = now.getFullYear();

  for (let i = 0; i < 4; i++) {
    const year      = currentYear - i;
    const opt       = document.createElement("option");
    opt.value       = year;
    opt.textContent = `${year}年`;
    yearSelect.appendChild(opt);
  }
  yearSelect.value  = currentYear;
  monthSelect.value = String(now.getMonth() + 1).padStart(2, "0");
}

// ─────────────────────────────────────────
// Firestore マスターデータ
// ─────────────────────────────────────────

/**
 * カテゴリのマスターデータ（項目・決済方法）を Firestore から並列取得する。
 * @param {string} uid
 * @param {string} categoryId
 * @returns {Promise<{items: Array, methods: Array}>}
 */
async function fetchMasterData(uid, categoryId) {
  const itemRepo   = new ItemRepository(categoryId);
  const methodRepo = new MethodRepository(uid, categoryId);
  const [itemsRaw, methods, sortDoc] = await Promise.all([
    itemRepo.getAll(),
    methodRepo.getAll(),
    db.doc("settings/itemSortOrder").get().catch(() => null),
  ]);

  const sortOrderIds = (sortDoc && sortDoc.exists && Array.isArray(sortDoc.data()[categoryId]))
    ? sortDoc.data()[categoryId]
    : [];

  let items = itemsRaw;
  if (sortOrderIds.length > 0) {
    const idIndex = Object.fromEntries(sortOrderIds.map((id, i) => [id, i]));
    items = itemsRaw.slice().sort((a, b) =>
      (idIndex[a.id] ?? 9999) - (idIndex[b.id] ?? 9999) || a.name.localeCompare(b.name, "ja")
    );
  }

  return { items, methods };
}

/**
 * マスターデータを取得して state に格納し、セレクト要素を更新する共通処理。
 * record.js・subscription.js・subscription_manage.js の読み込み部分で使用する。
 * @param {string} uid - Firebase Auth の UID
 * @param {string} categoryId - カテゴリ ID
 * @param {{ items: Array, methods: Array }} state - items・methods プロパティを持つ状態オブジェクト
 * @param {HTMLSelectElement|null} itemSelectEl - 項目 select 要素（null なら更新しない）
 * @param {HTMLSelectElement|null} methodSelectEl - 決済方法 select 要素（null なら更新しない）
 * @returns {Promise<void>}
 */
async function loadMasterIntoState(uid, categoryId, state, itemSelectEl, methodSelectEl) {
  const { items, methods } = await fetchMasterData(uid, categoryId);
  state.items   = items;
  state.methods = methods;
  if (itemSelectEl)   populateSelect(itemSelectEl,   items,   "選択してください");
  if (methodSelectEl) populateSelect(methodSelectEl, methods, "選択してください");
}

/**
 * 指定日付の属する月次サマリーを更新する。
 * 送信・編集・削除後に await して呼び出す（エラーは警告ログのみで再スローしない）。
 * @param {string} uid   Firebase Auth の UID
 * @param {string} date  YYYYMMDD 形式の日付文字列
 * @returns {Promise<void>}
 */
async function updateMonthlySummaryForDate(uid, date) {
  const s = String(date).replace(/[-/]/g, "");
  if (s.length < 6) return;
  const year  = s.slice(0, 4);
  const month = s.slice(4, 6);
  try {
    const summaryRepo = new MonthlySummaryRepository(uid);
    await summaryRepo.updateMonth(year, month);
  } catch (e) {
    console.warn("月次サマリー更新エラー:", e.message);
  }
}
