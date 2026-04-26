// chart.js

import { PieChart, LineChart, BalancePieChart, BalanceLineChart } from "./chartModels.js";

// カルーセルボタン縦位置の同期関数（グラフ描画後に呼び出す）
let syncPieButtons  = () => {};
let syncLineButtons = () => {};
// クローン canvas へグラフ内容をコピーする関数（グラフ描画後に呼び出す）
let syncPieClones   = () => {};
let syncLineClones  = () => {};

// 推移グラフの項目フィルタ用: 取得済みデータと LineChart インスタンスをキャッシュ
//   ・DB 再取得を避けて項目切替時の再描画に利用する
//   ・month / year は LineChart.render() の引数復元のため保持
const chartDataCache = {
  income:  null,  // { pieItemData, pieMethodData, lineData, month, year }
  expense: null,
  charge:  null,
};
const trendChartByCat = {
  income:  null,  // LineChart インスタンス（DOMContentLoaded で代入）
  expense: null,
  charge:  null,
};

document.addEventListener("DOMContentLoaded", () => {
  // 0. 表示期間セレクト（開始/終了の年）の初期化: 過去5年分を追加
  //    デフォルト: 開始=今年1月、終了=今年当月
  const now          = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");

  const startYearSel = document.getElementById("startYear");
  const endYearSel   = document.getElementById("endYear");
  for (let i = 0; i < 5; i++) {
    const y = currentYear - i;
    [startYearSel, endYearSel].forEach(sel => {
      const opt = document.createElement("option");
      opt.value       = y;
      opt.textContent = `${y}年`;
      sel.appendChild(opt);
    });
  }
  startYearSel.value = currentYear;
  endYearSel.value   = currentYear;
  document.getElementById("startMonth").value = "01";
  document.getElementById("endMonth").value   = currentMonth;

  // 0b. 月次集計用年セレクトの初期化
  const aggYearSelect = document.getElementById("aggregateYear");
  for (let i = 0; i < 4; i++) {
    const y   = currentYear - i;
    const opt = document.createElement("option");
    opt.value       = y;
    opt.textContent = `${y}年`;
    aggYearSelect.appendChild(opt);
  }

  // 1. 収入グラフのインスタンス
  const incomePie = new PieChart({
    canvasId: "income-pie-chart",
    aggregateKey: "itemName",
  });
  const incomeDoughnut = new PieChart({
    canvasId: "income-doughnut-chart",
    aggregateKey: "methodName",
    type: "doughnut",
  });
  const incomeLine = new LineChart({
    canvasId: "income-line-chart",
    dateKey: "date",
    color: "#4ade80",
  });

  // 2. 支出グラフのインスタンス
  const expensePie = new PieChart({
    canvasId: "expense-pie-chart",
    aggregateKey: "itemName",
  });
  const expenseDoughnut = new PieChart({
    canvasId: "expense-doughnut-chart",
    aggregateKey: "methodName",
    type: "doughnut",
  });
  const expenseLine = new LineChart({
    canvasId: "expense-line-chart",
    dateKey: "date",
    color: "#f87171",
  });

  // 3. チャージグラフのインスタンス
  const chargePie = new PieChart({
    canvasId: "charge-pie-chart",
    aggregateKey: "itemName",
  });
  const chargeDoughnut = new PieChart({
    canvasId: "charge-doughnut-chart",
    aggregateKey: "methodName",
    type: "doughnut",
  });
  const chargeLine = new LineChart({
    canvasId: "charge-line-chart",
    dateKey: "date",
    color: "#22d3ee",
  });

  // 4. 収支グラフのインスタンス
  const balancePie  = new BalancePieChart({ canvasId: "balance-pie-chart" });
  const balanceLine = new BalanceLineChart({
    canvasId: "balance-line-chart",
    dateKey: "date",
    color: "#8b5cf6",
  });

  // 5. カルーセル初期化
  const pieC  = initCarousel("pie-wrapper",  "pie-track",  "pie-prev",  "pie-next",  "pie-dots");
  const lineC = initCarousel("line-wrapper", "line-track", "line-prev", "line-next", "line-dots");
  if (pieC)  { syncPieButtons  = pieC.syncButtonTop;  syncPieClones  = pieC.syncCloneCanvases; }
  if (lineC) { syncLineButtons = lineC.syncButtonTop; syncLineClones = lineC.syncCloneCanvases; }

  const allCharts = [
    incomePie, incomeDoughnut, incomeLine,
    expensePie, expenseDoughnut, expenseLine,
    chargePie, chargeDoughnut, chargeLine,
    balancePie, balanceLine,
  ];

  // 5b. 推移グラフのインスタンスをカテゴリキーで参照可能にする
  trendChartByCat.income  = incomeLine;
  trendChartByCat.expense = expenseLine;
  trendChartByCat.charge  = chargeLine;

  // 5c. 項目フィルタ select の change を委譲リスナーで処理（クローンスライドにも対応）
  document.addEventListener("change", (e) => {
    const sel = e.target.closest(".trend-item-select");
    if (!sel) return;
    const cat = sel.dataset.cat;
    if (!cat || !trendChartByCat[cat]) return;

    // 同カテゴリの全 select（クローン含む）の値を同期
    document.querySelectorAll(`.trend-item-select[data-cat="${cat}"]`).forEach(s => {
      if (s !== sel) s.value = sel.value;
    });

    rerenderTrendChart(cat);
  });

  // 6. 「グラフを更新」ボタン
  document
    .getElementById("fetch-chart-data")
    .addEventListener("click", () => fetchAndRenderCharts(...allCharts));

  // 6b. 「月次集計を実行」ボタン
  document
    .getElementById("run-aggregation")
    .addEventListener("click", runAggregation);

  // 6c. プリセットボタン: 期間をワンクリックで設定して再描画
  document.querySelectorAll(".btn-preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      await applyPeriodPreset(btn.dataset.preset);
      fetchAndRenderCharts(...allCharts);
    });
  });

  // 7. Firebase Auth の認証状態が確定してから初期描画する
  requireAuth(() => fetchAndRenderCharts(...allCharts));
});

// ─────────────────────────────────────────
// グラフ描画
// ─────────────────────────────────────────

/**
 * 表示期間（開始年月〜終了年月）に応じてデータ取得元を切り替え、全グラフを更新する。
 *
 * 【単月（開始 === 終了）】: transactions から当月のデータを取得し日別集計
 * 【範囲（複数月）】       : 範囲内全年の monthlySummary を並列取得し月別集計
 */
async function fetchAndRenderCharts(
  incomePie, incomeDoughnut, incomeLine,
  expensePie, expenseDoughnut, expenseLine,
  chargePie, chargeDoughnut, chargeLine,
  balancePie, balanceLine
) {
  const statusMsg = document.getElementById("status-message");
  statusMsg.textContent   = "グラフデータを取得中...";
  statusMsg.style.display = "block";

  const startYear  = document.getElementById("startYear").value;
  const startMonth = document.getElementById("startMonth").value;
  const endYear    = document.getElementById("endYear").value;
  const endMonth   = document.getElementById("endMonth").value;
  const userId     = getCurrentUserId();

  // バリデーション: 開始 ≤ 終了
  if (Number(startYear) * 100 + Number(startMonth) > Number(endYear) * 100 + Number(endMonth)) {
    statusMsg.textContent = "開始年月は終了年月より前に設定してください。";
    return;
  }

  const isSingleMonth = startYear === endYear && startMonth === endMonth;

  try {
    let income, expense, charge;
    let chartMonth, chartYear;  // LineChart.render() 用引数（単月時のみ意味を持つ）

    if (isSingleMonth) {
      // ── 単月（日別表示）: トランザクションからリアルタイム取得 ──
      const [incomeData, expenseData, chargeData] = await Promise.all([
        fetchCategoryData(userId, startYear, startMonth, "1"),
        fetchCategoryData(userId, startYear, startMonth, "2"),
        fetchCategoryData(userId, startYear, startMonth, "3"),
      ]);
      income  = { pieItemData: incomeData,  pieMethodData: incomeData,  lineData: incomeData  };
      expense = { pieItemData: expenseData, pieMethodData: expenseData, lineData: expenseData };
      charge  = { pieItemData: chargeData,  pieMethodData: chargeData,  lineData: chargeData  };
      chartMonth = startMonth;
      chartYear  = startYear;

    } else {
      // ── 範囲（月別表示）: 範囲内全年の月次サマリーを並列取得 ──
      const summaryRepo = new MonthlySummaryRepository(userId);
      const years = [];
      for (let y = Number(startYear); y <= Number(endYear); y++) years.push(String(y));

      const yearSummaries = await Promise.all(years.map(y => summaryRepo.getYear(y)));
      const summariesByYear = {};
      years.forEach((y, i) => { summariesByYear[y] = yearSummaries[i]; });

      const totalDocs = Object.values(summariesByYear)
        .reduce((sum, ys) => sum + Object.keys(ys).length, 0);
      if (totalDocs === 0) {
        statusMsg.textContent = "選択範囲に月次集計データがありません。「月次集計を実行」で集計してください。";
        [incomePie, incomeDoughnut, incomeLine,
         expensePie, expenseDoughnut, expenseLine,
         chargePie,  chargeDoughnut,  chargeLine,
         balancePie, balanceLine].forEach(c => c.destroyChart());
        return;
      }

      income  = summaryToCategoryDataRange(summariesByYear, "1", startYear, startMonth, endYear, endMonth);
      expense = summaryToCategoryDataRange(summariesByYear, "2", startYear, startMonth, endYear, endMonth);
      charge  = summaryToCategoryDataRange(summariesByYear, "3", startYear, startMonth, endYear, endMonth);
      chartMonth = "";   // 月別集計
      chartYear  = null; // 範囲データは事前に0埋め済みなので auto-fill 不要
    }

    statusMsg.style.display = "none";

    // 折れ線グラフのタイトルを更新
    updateLineTitles(startYear, startMonth, endYear, endMonth, isSingleMonth);

    // 見出しに合計金額を表示
    updateCategoryTotals(income, expense, charge);

    // 各カテゴリの3グラフ（円・ドーナツ・折れ線）を描画
    renderCategoryCharts(incomePie,  incomeDoughnut,  incomeLine,  income,  chartMonth, chartYear);
    renderCategoryCharts(expensePie, expenseDoughnut, expenseLine, expense, chartMonth, chartYear);
    renderCategoryCharts(chargePie,  chargeDoughnut,  chargeLine,  charge,  chartMonth, chartYear);

    // 収支グラフを描画（収入・支出どちらかにデータがあれば描画）
    const hasIncome  = income.lineData.some(d  => Number(d.amount)  > 0);
    const hasExpense = expense.lineData.some(d => Number(d.amount) > 0);

    if (hasIncome || hasExpense) {
      balancePie.render(income.lineData, expense.lineData);
      balanceLine.render(income.lineData, expense.lineData, chartMonth, chartYear);
    } else {
      balancePie.destroyChart();
      balanceLine.destroyChart();
    }

    const hasCharge = charge.lineData.some(d => Number(d.amount) > 0);
    if (!hasIncome && !hasExpense && !hasCharge) {
      statusMsg.textContent   = "表示するデータがありません。";
      statusMsg.style.display = "block";
    }

    // 推移グラフ項目フィルタ用にデータをキャッシュし、項目 select を再構築する
    chartDataCache.income  = { ...income,  month: chartMonth, year: chartYear };
    chartDataCache.expense = { ...expense, month: chartMonth, year: chartYear };
    chartDataCache.charge  = { ...charge,  month: chartMonth, year: chartYear };
    populateItemSelectors();

    // ボタン縦位置・クローン canvas を同期
    requestAnimationFrame(() => {
      syncPieButtons();
      syncLineButtons();
      syncPieClones();
      syncLineClones();
    });

  } catch (error) {
    console.error("グラフデータの取得に失敗しました:", error);
    statusMsg.textContent = "エラー: " + error.message;
  }
}

// ─────────────────────────────────────────
// ヘルパー関数
// ─────────────────────────────────────────

/**
 * 月次サマリーを1カテゴリ分のグラフ用データに変換する（範囲指定版）。
 * 開始年月から終了年月まで1ヶ月ずつ巡回し、欠損月も lineData に 0 埋めで埋めることで
 * LineChart 内の年単位 auto-fill を不要にする（chartYear=null 渡しと組み合わせる）。
 *
 * @param {Object} summariesByYear  { "2025": { "01": {...}, ... }, "2026": {...} }
 * @param {string} categoryId       "1" | "2" | "3"
 * @param {string} startYear        "2025"
 * @param {string} startMonth       "01"
 * @param {string} endYear          "2026"
 * @param {string} endMonth         "12"
 * @returns {{ pieItemData: Array, pieMethodData: Array, lineData: Array }}
 */
function summaryToCategoryDataRange(summariesByYear, categoryId, startYear, startMonth, endYear, endMonth) {
  const pieItemData   = [];
  const pieMethodData = [];
  const lineData      = [];

  let curY = Number(startYear);
  let curM = Number(startMonth);
  const endKey = Number(endYear) * 100 + Number(endMonth);

  while (curY * 100 + curM <= endKey) {
    const ystr    = String(curY);
    const mstr    = String(curM).padStart(2, "0");
    const dateKey = `${ystr}${mstr}`;
    const catData = summariesByYear[ystr]?.[mstr]?.[categoryId];

    if (catData) {
      Object.entries(catData.items   || {}).forEach(([name, amount]) =>
        pieItemData.push({ itemName: name, amount, date: dateKey })
      );
      Object.entries(catData.methods || {}).forEach(([name, amount]) =>
        pieMethodData.push({ methodName: name, amount, date: dateKey })
      );
      lineData.push({ date: dateKey, amount: catData.total || 0 });
    } else {
      lineData.push({ date: dateKey, amount: 0 });
    }

    curM++;
    if (curM > 12) { curM = 1; curY++; }
  }

  return { pieItemData, pieMethodData, lineData };
}

/**
 * カテゴリの3グラフ（円・ドーナツ・折れ線）を描画する。
 * データが空の場合は既存グラフを破棄する。
 */
function renderCategoryCharts(pie, doughnut, line, { pieItemData, pieMethodData, lineData }, month, year) {
  const hasData = pieItemData.length > 0 || lineData.some(d => Number(d.amount) > 0);

  if (hasData) {
    pie.render(pieItemData);
    doughnut.render(pieMethodData);
    line.render(lineData, month, year);
  } else {
    pie.destroyChart();
    doughnut.destroyChart();
    line.destroyChart();
  }
}

/**
 * 指定カテゴリのトランザクションを Firestore から取得する（月別表示用）
 */
async function fetchCategoryData(userId, year, month, categoryId) {
  const txRepo = new TransactionRepository(userId);
  return txRepo.getByCategory(categoryId, year, month);
}

/**
 * 折れ線グラフのタイトルを期間に応じて更新する。
 * @param {string}  startYear  "2025"
 * @param {string}  startMonth "01"
 * @param {string}  endYear    "2026"
 * @param {string}  endMonth   "04"
 * @param {boolean} isSingleMonth 単月（日別表示）かどうか
 */
function updateLineTitles(startYear, startMonth, endYear, endMonth, isSingleMonth) {
  const ids = [
    ["income-line-title",  "収入"],
    ["expense-line-title", "支出"],
    ["charge-line-title",  "チャージ"],
    ["balance-line-title", "収支"],
  ];

  const sm = parseInt(startMonth, 10);
  const em = parseInt(endMonth, 10);
  const sameYear = startYear === endYear;

  ids.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isSingleMonth) {
      el.textContent = `${startYear}年${sm}月 日別${label}の推移`;
    } else if (sameYear) {
      el.textContent = `${startYear}年 ${sm}〜${em}月 月別${label}の推移`;
    } else {
      el.textContent = `${startYear}年${sm}月 〜 ${endYear}年${em}月 月別${label}の推移`;
    }
  });
}

/**
 * 円グラフ・折れ線グラフの h2 見出し横に各カテゴリの合計金額を表示する。
 * data-total 属性を持つ全 span（クローンスライド含む）を一括更新する。
 *
 * @param {{ lineData: Array }} income  収入データ
 * @param {{ lineData: Array }} expense 支出データ
 * @param {{ lineData: Array }} charge  チャージデータ
 */
function updateCategoryTotals(income, expense, charge) {
  const sum = (lineData) => lineData.reduce((acc, d) => acc + Number(d.amount), 0);

  const incomeTotal  = sum(income.lineData);
  const expenseTotal = sum(expense.lineData);
  const chargeTotal  = sum(charge.lineData);
  const balanceTotal = incomeTotal - expenseTotal;

  [
    ["income",  incomeTotal],
    ["expense", expenseTotal],
    ["charge",  chargeTotal],
    ["balance", balanceTotal],
  ].forEach(([key, total]) => {
    const text = total.toLocaleString("ja-JP") + " 円";
    document.querySelectorAll(`[data-total="${key}"]`).forEach(el => {
      el.textContent = text;
    });
  });
}

// ─────────────────────────────────────────
// 期間プリセット
// ─────────────────────────────────────────

/**
 * プリセット名に応じて開始/終了の年月セレクトを更新する。
 *  - "this-month" : 当月（→ 単月日別表示）
 *  - "this-year"  : 今年1月 〜 当月
 *  - "last-12"    : 直近12ヶ月（前年同月+1 〜 当月）
 *  - "all"        : monthlySummary が存在する最古年1月 〜 当月
 *
 * @param {"this-month"|"this-year"|"last-12"|"all"} preset
 */
async function applyPeriodPreset(preset) {
  const now          = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1〜12

  let sy = currentYear, sm = currentMonth;
  let ey = currentYear, em = currentMonth;

  if (preset === "this-month") {
    sy = ey = currentYear;
    sm = em = currentMonth;
  } else if (preset === "this-year") {
    sy = currentYear; sm = 1;
    ey = currentYear; em = currentMonth;
  } else if (preset === "last-12") {
    // 当月から 11 ヶ月前を開始月にする（合計12ヶ月）
    const start = new Date(currentYear, currentMonth - 1 - 11, 1);
    sy = start.getFullYear(); sm = start.getMonth() + 1;
    ey = currentYear;          em = currentMonth;
  } else if (preset === "all") {
    const userId = getCurrentUserId();
    if (!userId) return;
    const summaryRepo = new MonthlySummaryRepository(userId);
    const years = await summaryRepo.listYears();
    if (years.length === 0) {
      alert("月次集計データがありません。\n「月次集計を実行」を実行してください。");
      return;
    }
    sy = Number(years[0]);                   sm = 1;
    ey = Number(years[years.length - 1]);    em = 12;
    // 最終年が現在年なら当月までに調整
    if (ey === currentYear) em = currentMonth;
  }

  setPeriodSelects(sy, sm, ey, em);
}

/**
 * 開始/終了の年月セレクトに値をセットする。
 * 年セレクトに該当オプションが無い場合は動的に追加する（5年範囲を超える「全期間」用）。
 */
function setPeriodSelects(sy, sm, ey, em) {
  ensureYearOption("startYear", sy);
  ensureYearOption("endYear",   ey);
  document.getElementById("startYear").value  = String(sy);
  document.getElementById("startMonth").value = String(sm).padStart(2, "0");
  document.getElementById("endYear").value    = String(ey);
  document.getElementById("endMonth").value   = String(em).padStart(2, "0");
}

/**
 * 指定 year がセレクトに無ければ option を追加する（昇順保持）。
 */
function ensureYearOption(selectId, year) {
  const sel  = document.getElementById(selectId);
  const yStr = String(year);
  if ([...sel.options].some(o => o.value === yStr)) return;

  const opt = document.createElement("option");
  opt.value       = yStr;
  opt.textContent = `${yStr}年`;
  // 降順（新しい年が上）に挿入
  let inserted = false;
  for (const o of sel.options) {
    if (Number(o.value) < year) { sel.insertBefore(opt, o); inserted = true; break; }
  }
  if (!inserted) sel.appendChild(opt);
}

// ─────────────────────────────────────────
// 推移グラフ: 項目フィルタ
// ─────────────────────────────────────────

/**
 * キャッシュされた pieItemData から項目名を抽出して、推移グラフの select を再構築する。
 * 全クローンスライドの select も class セレクタで一括更新する。
 * 既存の選択値はキャッシュ後の項目一覧に存在すれば維持する。
 */
function populateItemSelectors() {
  ["income", "expense", "charge"].forEach(cat => {
    const data = chartDataCache[cat];
    if (!data) return;

    const items = [...new Set(data.pieItemData.map(d => d.itemName).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ja"));

    document.querySelectorAll(`.trend-item-select[data-cat="${cat}"]`).forEach(sel => {
      const prev = sel.value;
      sel.innerHTML = '<option value="">全項目</option>';
      items.forEach(name => {
        const opt = document.createElement("option");
        opt.value       = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      if (prev && items.includes(prev)) sel.value = prev;
    });
  });
}

/**
 * 指定カテゴリの推移グラフを、キャッシュデータと現在の項目フィルタで再描画する。
 *   ・全項目: lineData（合計）をそのまま描画
 *   ・特定項目: pieItemData を itemName で絞り込んで日/月別合計に再集計
 * @param {"income"|"expense"|"charge"} cat
 */
function rerenderTrendChart(cat) {
  const cached = chartDataCache[cat];
  const chart  = trendChartByCat[cat];
  if (!cached || !chart) return;

  const sel        = document.querySelector(`.trend-item-select[data-cat="${cat}"]`);
  const itemFilter = sel ? sel.value : "";

  const dataToRender = !itemFilter
    ? cached.lineData
    : cached.pieItemData
        .filter(d => d.itemName === itemFilter)
        .map(d => ({ date: d.date, amount: d.amount }));

  chart.render(dataToRender, cached.month, cached.year);

  // 項目フィルタ変更後もカルーセルクローンへ反映
  requestAnimationFrame(() => syncLineClones());
}

// ─────────────────────────────────────────
// 月次集計
// ─────────────────────────────────────────

/**
 * 「月次集計を実行」ボタンのハンドラ。
 * 選択年の全トランザクションを集計して monthlySummary に書き込む。
 */
async function runAggregation() {
  const year   = document.getElementById("aggregateYear").value;
  const userId = getCurrentUserId();
  const btn    = document.getElementById("run-aggregation");
  const status = document.getElementById("agg-status");

  btn.disabled        = true;
  btn.textContent     = "集計中...";
  status.textContent  = `${year}年のデータを集計しています...`;
  status.style.display = "block";
  status.className    = "agg-status agg-running";

  try {
    const summaryRepo = new MonthlySummaryRepository(userId);
    const count       = await summaryRepo.buildYear(year);
    status.textContent = `${year}年の月次集計が完了しました（${count}件処理）`;
    status.className   = "agg-status agg-success";
  } catch (err) {
    console.error("集計エラー:", err);
    status.textContent = "エラー: " + err.message;
    status.className   = "agg-status agg-error";
  } finally {
    btn.disabled    = false;
    btn.textContent = "月次集計を実行";
  }
}

// ─────────────────────────────────────────
// カルーセル
// ─────────────────────────────────────────

/**
 * カルーセルを初期化する（前後クローン方式によるシームレスループ）
 *
 * 構造: [lastClone | slide0 | slide1 | ... | slideLast | firstClone]
 *   currentIndex=1 が初期位置（slide0）
 *   currentIndex=0 → lastClone（左端）に到達 → 実 slideLast へ瞬間移動
 *   currentIndex=slides.length-1 → firstClone（右端）に到達 → 実 slide0 へ瞬間移動
 */
function initCarousel(wrapperId, trackId, prevId, nextId, dotsId) {
  const wrapper = document.getElementById(wrapperId);
  const track   = document.getElementById(trackId);
  const prevBtn = document.getElementById(prevId);
  const nextBtn = document.getElementById(nextId);
  const dotsEl  = document.getElementById(dotsId);
  if (!wrapper || !track) return;

  const originalSlides = Array.from(track.querySelectorAll(".carousel-slide"));
  const originalCount  = originalSlides.length;
  const dots = dotsEl ? Array.from(dotsEl.querySelectorAll(".carousel-dot")) : [];

  // 先頭に lastClone、末尾に firstClone を挿入
  const firstClone = originalSlides[0].cloneNode(true);
  const lastClone  = originalSlides[originalCount - 1].cloneNode(true);
  firstClone.setAttribute("aria-hidden", "true");
  lastClone.setAttribute("aria-hidden", "true");
  track.insertBefore(lastClone, track.firstChild);
  track.appendChild(firstClone);

  // slides: [lastClone, slide0, ..., slideLast, firstClone]
  const slides = Array.from(track.children);
  let currentIndex = 1;  // 初期位置: slide0
  let slideWidth   = 0;
  let startX       = 0;
  let isDragging   = false;

  /** ドット表示を現在の実スライドに合わせる */
  function updateDots() {
    const realIdx = ((currentIndex - 1) % originalCount + originalCount) % originalCount;
    dots.forEach((d, i) => d.classList.toggle("active", i === realIdx));
  }

  /** 指定インデックスへ移動。withTransition=false で瞬間移動（ループ用） */
  function moveTo(index, withTransition = true) {
    track.style.transition = withTransition ? "transform 0.4s ease" : "none";
    if (!withTransition) void track.offsetWidth; // transition:none を確実に適用
    track.style.transform = `translateX(${-slideWidth * index}px)`;
    currentIndex = index;
    updateDots();
  }

  /** 全スライドの幅を更新し、現在位置を再描画 */
  function setWidths() {
    slideWidth = wrapper.clientWidth;
    slides.forEach(s => (s.style.width = slideWidth + "px"));
    track.style.transition = "none";
    void track.offsetWidth;
    track.style.transform = `translateX(${-slideWidth * currentIndex}px)`;
    requestAnimationFrame(() => { track.style.transition = "transform 0.4s ease"; });
  }

  setWidths();

  // クローン端に到達したら本物スライドへ瞬間移動（無限ループ）
  track.addEventListener("transitionend", () => {
    if (currentIndex === slides.length - 1) {
      moveTo(1, false);             // firstClone → 実 slide0
    } else if (currentIndex === 0) {
      moveTo(originalCount, false); // lastClone  → 実 slideLast
    }
  });

  // ボタン
  if (prevBtn) prevBtn.addEventListener("click", () => moveTo(currentIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => moveTo(currentIndex + 1));
  dots.forEach((dot, i) => dot.addEventListener("click", () => moveTo(i + 1)));

  // ドラッグ & スワイプ共通処理
  function startDrag(x) {
    isDragging = true;
    startX = x;
    track.style.transition = "none";
  }

  function moveDrag(x) {
    if (!isDragging) return;
    track.style.transform = `translateX(${-slideWidth * currentIndex + (x - startX)}px)`;
  }

  function endDrag(x) {
    if (!isDragging) return;
    isDragging = false;
    const diff = x - startX;
    if      (diff < -slideWidth * 0.25) moveTo(currentIndex + 1);
    else if (diff >  slideWidth * 0.25) moveTo(currentIndex - 1);
    else                                moveTo(currentIndex);
  }

  // インタラクティブ要素（select/input/button等）はドラッグ対象外。
  //  - mousedown の preventDefault が select のドロップダウン展開を阻害するのを防ぐ
  //  - 続くタッチ操作で意図せず carousel が動くのを防ぐ
  const isInteractive = (target) =>
    target && target.closest && target.closest("select, input, button, textarea, label, a");

  // マウス
  wrapper.addEventListener("mousedown", e => {
    if (isInteractive(e.target)) return;
    e.preventDefault();
    startDrag(e.clientX);
    wrapper.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", e => moveDrag(e.clientX));
  window.addEventListener("mouseup",   e => { endDrag(e.clientX); wrapper.style.cursor = ""; });

  // タッチ
  wrapper.addEventListener("touchstart", e => {
    if (isInteractive(e.target)) return;
    startDrag(e.touches[0].clientX);
  }, { passive: true });
  wrapper.addEventListener("touchmove",  e => moveDrag(e.touches[0].clientX),           { passive: true });
  wrapper.addEventListener("touchend",   e => endDrag(e.changedTouches[0].clientX));

  /** モバイル時: ボタンの top をカレントスライドの canvas 中央に合わせる */
  function syncButtonTop() {
    if (window.innerWidth > 700) return;
    const realIdx = ((currentIndex - 1) % originalCount + originalCount) % originalCount;
    const slide   = originalSlides[realIdx];
    const canvas  = slide ? slide.querySelector("canvas") : null;
    if (!canvas) return;
    const carouselEl = wrapper.parentElement;
    const cr  = carouselEl.getBoundingClientRect();
    const cv  = canvas.getBoundingClientRect();
    const top = cv.top - cr.top + cv.height / 2;
    if (top <= 0) return;
    if (prevBtn) { prevBtn.style.top = top + "px"; prevBtn.style.transform = "translateY(-50%)"; }
    if (nextBtn) { nextBtn.style.top = top + "px"; nextBtn.style.transform = "translateY(-50%)"; }
  }

  /** グラフ描画後にクローンの canvas へ内容をコピー（クローンを空白にしない） */
  function syncCloneCanvases() {
    [
      [originalSlides[0],                 firstClone],
      [originalSlides[originalCount - 1], lastClone ],
    ].forEach(([src, dst]) => {
      const srcList = src.querySelectorAll("canvas");
      const dstList = dst.querySelectorAll("canvas");
      srcList.forEach((srcC, i) => {
        const dstC = dstList[i];
        if (!dstC || srcC.width === 0 || srcC.height === 0) return;
        dstC.width  = srcC.width;
        dstC.height = srcC.height;
        dstC.style.width  = srcC.style.width;
        dstC.style.height = srcC.style.height;
        dstC.getContext("2d").drawImage(srcC, 0, 0);
      });
    });
  }

  window.addEventListener("resize", () => { setWidths(); syncButtonTop(); });
  return { syncButtonTop, syncCloneCanvases };
}
