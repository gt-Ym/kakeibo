// chart.js

import { PieChart, LineChart, BalancePieChart, BalanceLineChart } from "./chartModels.js";

// カルーセルボタン縦位置の同期関数（グラフ描画後に呼び出す）
let syncPieButtons  = () => {};
let syncLineButtons = () => {};
// クローン canvas へグラフ内容をコピーする関数（グラフ描画後に呼び出す）
let syncPieClones   = () => {};
let syncLineClones  = () => {};

document.addEventListener("DOMContentLoaded", () => {
  // 0. 年月フィルタの初期化（今年・今月をデフォルト選択）
  initializeDateFilters();

  // 0b. 月次集計用年セレクトの初期化
  const aggYearSelect = document.getElementById("aggregateYear");
  const currentYear   = new Date().getFullYear();
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

  // 6. 「グラフを更新」ボタン
  document
    .getElementById("fetch-chart-data")
    .addEventListener("click", () => fetchAndRenderCharts(...allCharts));

  // 6b. 「月次集計を実行」ボタン
  document
    .getElementById("run-aggregation")
    .addEventListener("click", runAggregation);

  // 7. Firebase Auth の認証状態が確定してから初期描画する
  requireAuth(() => fetchAndRenderCharts(...allCharts));
});

// ─────────────────────────────────────────
// グラフ描画
// ─────────────────────────────────────────

/**
 * 年全体 or 月別に応じてデータ取得元を切り替え、全グラフを更新する。
 *
 * 【年全体（月未指定）】: monthlySummary から12件の集計ドキュメントを読み取る
 * 【月別（月指定）】    : transactions から当月のデータをリアルタイムで取得する
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

  const year   = document.getElementById("searchYear").value;
  const month  = document.getElementById("searchMonth").value;
  const userId = getCurrentUserId();

  try {
    let income, expense, charge;

    if (!month) {
      // ── 年全体表示: 月次サマリーから取得（最大12読み取り）──
      const summaryRepo = new MonthlySummaryRepository(userId);
      const yearSummary = await summaryRepo.getYear(year);

      if (Object.keys(yearSummary).length === 0) {
        statusMsg.textContent = `${year}年の月次集計データがありません。「月次集計を実行」で集計してください。`;
        [incomePie, incomeDoughnut, incomeLine,
         expensePie, expenseDoughnut, expenseLine,
         chargePie,  chargeDoughnut,  chargeLine,
         balancePie, balanceLine].forEach(c => c.destroyChart());
        return;
      }

      income  = summaryToCategoryData(yearSummary, "1", year);
      expense = summaryToCategoryData(yearSummary, "2", year);
      charge  = summaryToCategoryData(yearSummary, "3", year);

    } else {
      // ── 月別表示: トランザクションからリアルタイム取得 ──
      const [incomeData, expenseData, chargeData] = await Promise.all([
        fetchCategoryData(userId, year, month, "1"),
        fetchCategoryData(userId, year, month, "2"),
        fetchCategoryData(userId, year, month, "3"),
      ]);
      // トランザクション配列はそのままで全3チャートに使える（itemName / methodName / date / amount を持つ）
      income  = { pieItemData: incomeData,  pieMethodData: incomeData,  lineData: incomeData  };
      expense = { pieItemData: expenseData, pieMethodData: expenseData, lineData: expenseData };
      charge  = { pieItemData: chargeData,  pieMethodData: chargeData,  lineData: chargeData  };
    }

    statusMsg.style.display = "none";

    // 折れ線グラフのタイトルを更新
    updateLineTitles(year, month);

    // 見出しに合計金額を表示
    updateCategoryTotals(income, expense, charge);

    // 各カテゴリの3グラフ（円・ドーナツ・折れ線）を描画
    renderCategoryCharts(incomePie,  incomeDoughnut,  incomeLine,  income,  month, year);
    renderCategoryCharts(expensePie, expenseDoughnut, expenseLine, expense, month, year);
    renderCategoryCharts(chargePie,  chargeDoughnut,  chargeLine,  charge,  month, year);

    // 収支グラフを描画（収入・支出どちらかにデータがあれば描画）
    const hasIncome  = income.lineData.some(d  => Number(d.amount)  > 0);
    const hasExpense = expense.lineData.some(d => Number(d.amount) > 0);

    if (hasIncome || hasExpense) {
      balancePie.render(income.lineData, expense.lineData);
      balanceLine.render(income.lineData, expense.lineData, month, year);
    } else {
      balancePie.destroyChart();
      balanceLine.destroyChart();
    }

    const hasCharge = charge.lineData.some(d => Number(d.amount) > 0);
    if (!hasIncome && !hasExpense && !hasCharge) {
      statusMsg.textContent   = "表示するデータがありません。";
      statusMsg.style.display = "block";
    }

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
 * 月次サマリーを1カテゴリ分のグラフ用データに変換する（年全体表示専用）。
 *
 * 返値の各配列フォーマット:
 *   pieItemData   : [{ itemName, amount, date }, ...]  ← PieChart(aggregateKey="itemName") 用
 *   pieMethodData : [{ methodName, amount, date }, ...]← PieChart(aggregateKey="methodName") 用
 *   lineData      : [{ date, amount }, ...]            ← LineChart / BalanceLine / BalancePie 用
 *                   ※ date = "YYYYMM" 形式 (12エントリ・ゼロ埋め済み)
 *
 * @param {Object} yearSummary  { "01": { "1": { items, methods, total }, ... }, ... }
 * @param {string} categoryId  "1" | "2" | "3"
 * @param {string} year        "2026"
 * @returns {{ pieItemData: Array, pieMethodData: Array, lineData: Array }}
 */
function summaryToCategoryData(yearSummary, categoryId, year) {
  const pieItemData   = [];
  const pieMethodData = [];
  const lineData      = [];

  for (let m = 1; m <= 12; m++) {
    const month   = String(m).padStart(2, "0");
    const catData = yearSummary[month]?.[categoryId];
    const dateKey = `${year}${month}`;

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
 * 折れ線グラフのタイトルを年月に応じて更新する
 */
function updateLineTitles(year, month) {
  const ids = [
    ["income-line-title",  "収入"],
    ["expense-line-title", "支出"],
    ["charge-line-title",  "チャージ"],
    ["balance-line-title", "収支"],
  ];

  ids.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (month) {
      const m = parseInt(month, 10);
      el.textContent = `${year}年${m}月 日別${label}の推移`;
    } else {
      el.textContent = `${year}年の月別${label}の推移`;
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

  // マウス
  wrapper.addEventListener("mousedown", e => {
    e.preventDefault();
    startDrag(e.clientX);
    wrapper.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", e => moveDrag(e.clientX));
  window.addEventListener("mouseup",   e => { endDrag(e.clientX); wrapper.style.cursor = ""; });

  // タッチ
  wrapper.addEventListener("touchstart", e => startDrag(e.touches[0].clientX),         { passive: true });
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
