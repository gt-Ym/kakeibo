// currency.js
// 通貨変換モジュール（USD / JPY）
// 依存なし — 全画面から共通利用する

const CurrencyManager = (() => {
  const CACHE_PREFIX = "fxRate_";
  // api.frankfurter.app は api.frankfurter.dev/v1 へ 301 リダイレクトするため、
  // ブラウザの CORS チェックが失敗するケースを避けて新 URL を直接指定する
  const API_BASE     = "https://api.frankfurter.dev/v1";

  // ─────────────────────────────────────────
  // 為替レート取得（sessionStorage キャッシュ）
  // ─────────────────────────────────────────

  /**
   * 指定日付の USD→JPY 為替レートを取得する。
   * sessionStorage にキャッシュし、同セッション内の重複リクエストを防ぐ。
   * 週末・祝日は ECB が直近営業日のレートを返す。
   * @param {string} dateISO - YYYY-MM-DD 形式の日付
   * @returns {Promise<number>} 為替レート（例: 147.50）
   */
  async function fetchRate(dateISO) {
    const key    = `${CACHE_PREFIX}USD_JPY_${dateISO}`;
    const cached = sessionStorage.getItem(key);
    if (cached) return parseFloat(cached);

    const res = await fetch(`${API_BASE}/${dateISO}?from=USD&to=JPY`);
    if (!res.ok) throw new Error(`為替レート取得エラー: HTTP ${res.status}`);
    const data = await res.json();
    const rate = data.rates["JPY"];
    sessionStorage.setItem(key, String(rate));
    return rate;
  }

  // ─────────────────────────────────────────
  // 変換
  // ─────────────────────────────────────────

  /**
   * USD 金額を円に換算する。
   * @param {number} usdAmount - USD 金額
   * @param {string} dateISO   - YYYY-MM-DD 形式の日付
   * @returns {Promise<{ jpy: number, rate: number }>}
   */
  async function convertUsdToJpy(usdAmount, dateISO) {
    const rate = await fetchRate(dateISO);
    return { jpy: Math.round(usdAmount * rate), rate };
  }

  // ─────────────────────────────────────────
  // UI: 通貨トグルボタン（モーダル・フォーム共通）
  // ─────────────────────────────────────────

  /**
   * 円/ドル切替ボタングループをコンテナ要素に挿入する。
   * @param {HTMLElement} containerEl - トグルを挿入する要素
   * @param {function}    onChange    - 通貨変更時のコールバック ("JPY"|"USD") => void
   * @returns {{ getCurrency: () => "JPY"|"USD" }}
   */
  function createToggle(containerEl, onChange) {
    let current = "JPY";

    const wrapper = document.createElement("div");
    wrapper.className = "currency-toggle";

    const jpyBtn = document.createElement("button");
    jpyBtn.type        = "button";
    jpyBtn.className   = "currency-btn active";
    jpyBtn.textContent = "¥ 円";

    const usdBtn = document.createElement("button");
    usdBtn.type        = "button";
    usdBtn.className   = "currency-btn";
    usdBtn.textContent = "$ ドル";

    function activate(currency) {
      if (current === currency) return;
      current = currency;
      if (currency === "JPY") {
        jpyBtn.classList.add("active");
        usdBtn.classList.remove("active");
      } else {
        usdBtn.classList.add("active");
        jpyBtn.classList.remove("active");
      }
      onChange(currency);
    }

    jpyBtn.addEventListener("click", () => activate("JPY"));
    usdBtn.addEventListener("click", () => activate("USD"));

    wrapper.appendChild(jpyBtn);
    wrapper.appendChild(usdBtn);
    containerEl.appendChild(wrapper);

    return { getCurrency: () => current };
  }

  // ─────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────

  /**
   * 円金額を「¥1,234」形式にフォーマットする。
   * @param {number} jpy
   * @returns {string}
   */
  function formatJpy(jpy) {
    return `¥${jpy.toLocaleString("ja-JP")}`;
  }

  return { fetchRate, convertUsdToJpy, createToggle, formatJpy };
})();
