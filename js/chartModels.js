/**
 * グラフ作成の基底（親）クラス
 */
class BaseChart {
  constructor({ canvasId, valueKey = 'amount' }) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) throw new Error(`Canvas element #${canvasId} not found.`);

    this.ctx = canvas.getContext('2d');
    this.valueKey = valueKey;
    this.chart = null;

    this.defaultColors = [
      '#FF6384', '#36A2EB', '#FFCE56',
      '#4BC0C0', '#9966FF', '#FF9F40',
      '#FF6384', '#36A2EB', '#FFCE56',
      '#4BC0C0', '#9966FF', '#FF9F40'
    ];
  }

  /** 共通の集計ロジック */
  aggregate(data, keyName) {
    return data.reduce((acc, curr) => {
      const label = curr[keyName] || '未分類';
      const val = Number(curr[this.valueKey]) || 0;
      acc[label] = (acc[label] || 0) + val;
      return acc;
    }, {});
  }

  /** 既存グラフの破棄 */
  destroyChart() {
    if (this.chart) this.chart.destroy();
  }

  /** Chart.js の生成を共通化 */
  createChart(type, labels, datasets, options = {}, plugins = []) {
    this.destroyChart();
    this.chart = new Chart(this.ctx, {
      type,
      data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: true, ...options },
      plugins: plugins
    });
  }
}

/**
 * 1. 棒グラフ（時系列推移）
 */
export class TimeBarChart extends BaseChart {
  constructor(config) {
    super(config);
    this.mode = config.mode || 'month'; // 'year' or 'month'
    this.dateKey = config.dateKey || 'date';
  }

  render(data, filterKey = null, filterValue = null) {
    const targetData =
      filterKey && filterValue
        ? data.filter(item => String(item[filterKey]) === String(filterValue))
        : data;

    const summary = targetData.reduce((acc, curr) => {
      const dateStr = String(curr[this.dateKey]);
      const period =
        this.mode === 'year'
          ? dateStr.substring(0, 4)
          : dateStr.substring(0, 6);

      acc[period] = (acc[period] || 0) + (Number(curr[this.valueKey]) || 0);
      return acc;
    }, {});

    const labels = Object.keys(summary).sort();
    const values = labels.map(l => summary[l]);

    this.createChart('bar', labels, [
      {
        label: filterValue || '合計',
        data: values,
        backgroundColor: 'rgba(54, 162, 235, 0.6)'
      }
    ]);
  }
}

/**
 * 2. 円グラフ（構成比）
 */
export class PieChart extends BaseChart {
  constructor(config) {
    super(config);
    this.aggregateKey = config.aggregateKey;
    this.limit = config.limit || 5;
    this.type = config.type || 'doughnut';
  }

  render(data) {
    const summary = this.aggregate(data, this.aggregateKey);

    const sorted = Object.entries(summary)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    let finalData = sorted.slice(0, this.limit);

    // 全体の合計を計算
    const totalSum = sorted.reduce((sum, item) => sum + item.total, 0);

    if (sorted.length > this.limit) {
      const others = sorted
        .slice(this.limit)
        .reduce((sum, item) => sum + item.total, 0);
      finalData.push({ name: 'その他', total: others });
    }

    const labels = finalData.map(d => d.name);
    const values = finalData.map(d => d.total);

    this.createChart(
      this.type,
      labels,
      [
        {
          data: values,
          backgroundColor: this.defaultColors,
        },
      ],
      {
        plugins: {
          datalabels: {
            color: '#000000',
            display: (context) => {
              const value = context.dataset.data[context.dataIndex];
              return (value / totalSum * 100) >= 7.5;
            },
            formatter: (value, context) => {
              const rawLabel = context.chart.data.labels[context.dataIndex];
              const label = rawLabel.length > 6
                ? rawLabel.slice(0, Math.ceil(rawLabel.length / 2)) + '\n' + rawLabel.slice(Math.ceil(rawLabel.length / 2))
                : rawLabel;
              const percentage = (value / totalSum * 100).toFixed(1);
              return `${label}\n${percentage}%`;
            },
            font: {
              weight: 'bold',
              size: 14,
            },
            // ドーナツチャートの場合、内側に表示するために調整
            // anchor: 'center',
            // align: 'center',
            textAlign: 'center',
          },
        },
      },
      [ChartDataLabels] // plugins array for Chart.js 3+
    );
  }
}

/**
 * 3. 折れ線グラフ（推移）
 */
export class LineChart extends BaseChart {
  constructor(config) {
    super(config);
    this.dateKey = config.dateKey || 'date';
    this.color = config.color || '#4BC0C0';
  }

  render(data, monthFilter = "", year = null) {
    const isMonthlyAggregation = monthFilter === "";

    const summary = data.reduce((acc, curr) => {
      const dateStr = String(curr[this.dateKey]);
      let period;

      if (isMonthlyAggregation) {
        // 月別集計: "202301"
        period = dateStr.substring(0, 6);
      } else {
        // 日別集計: "20230115"
        period = dateStr.substring(0, 8);
      }

      acc[period] = (acc[period] || 0) + (Number(curr[this.valueKey]) || 0);
      return acc;
    }, {});

    // 月別表示の場合: 1月〜12月を0で埋めて横軸を揃える
    if (isMonthlyAggregation && year) {
      for (let m = 1; m <= 12; m++) {
        const key = `${year}${String(m).padStart(2, '0')}`;
        if (!(key in summary)) summary[key] = 0;
      }
    }

    // 日別表示の場合: 月の全日付を0で埋めて横軸を揃える
    if (!isMonthlyAggregation && year && monthFilter) {
      const daysInMonth = new Date(parseInt(year), parseInt(monthFilter), 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}${monthFilter}${String(d).padStart(2, '0')}`;
        if (!(key in summary)) summary[key] = 0;
      }
    }

    const sortedLabels = Object.keys(summary).sort();
    
    const formattedLabels = sortedLabels.map(label => {
      if (isMonthlyAggregation) {
        // "202301" -> "2023/01"
        return `${label.substring(0, 4)}/${label.substring(4, 6)}`;
      } else {
        // "20230115" -> "01/15"
        return `${label.substring(4, 6)}/${label.substring(6, 8)}`;
      }
    });

    const values = sortedLabels.map(l => summary[l]);

    this.createChart('line', formattedLabels, [
      {
        label: isMonthlyAggregation ? '月別合計' : '日別合計',
        data: values,
        borderColor: this.color,
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        fill: true,
        tension: 0.3
      }
    ], {
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 45,
          }
        },
        y: {
          beginAtZero: true
        }
      }
    });
  }
}

/**
 * 4. 収支比較円グラフ（収入 vs 支出の構成比）
 */
export class BalancePieChart extends BaseChart {
  constructor(config) {
    super(config);
    this.type = config.type || 'doughnut';
  }

  render(incomeData, expenseData) {
    const totalIncome  = incomeData.reduce((sum, d)  => sum + (Number(d.amount) || 0), 0);
    const totalExpense = expenseData.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const totalSum     = totalIncome + totalExpense;

    this.createChart(
      this.type,
      ['収入', '支出'],
      [{
        data: [totalIncome, totalExpense],
        backgroundColor: ['#4ade80', '#f87171'],
      }],
      {
        plugins: {
          datalabels: {
            color: '#000000',
            formatter: (value, context) => {
              const label = context.chart.data.labels[context.dataIndex];
              if (totalSum === 0) return `${label}\n0%`;
              return `${label}\n${(value / totalSum * 100).toFixed(1)}%`;
            },
            font: { weight: 'bold', size: 14 },
            textAlign: 'center',
          },
        },
      },
      [ChartDataLabels]
    );
  }
}

/**
 * 5. 収支推移折れ線グラフ（収入 − 支出）
 */
export class BalanceLineChart extends BaseChart {
  constructor(config) {
    super(config);
    this.dateKey = config.dateKey || 'date';
    this.color   = config.color   || '#8b5cf6';
  }

  render(incomeData, expenseData, monthFilter = "", year = null) {
    const isMonthlyAggregation = monthFilter === "";

    const incomeByPeriod  = this._aggregate(incomeData,  isMonthlyAggregation);
    const expenseByPeriod = this._aggregate(expenseData, isMonthlyAggregation);

    // 全期間のキーを収集し、空白期間を0で埋める
    const allPeriods = new Set([
      ...Object.keys(incomeByPeriod),
      ...Object.keys(expenseByPeriod),
    ]);

    if (isMonthlyAggregation && year) {
      for (let m = 1; m <= 12; m++) {
        allPeriods.add(`${year}${String(m).padStart(2, '0')}`);
      }
    } else if (!isMonthlyAggregation && year && monthFilter) {
      const daysInMonth = new Date(parseInt(year), parseInt(monthFilter), 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        allPeriods.add(`${year}${monthFilter}${String(d).padStart(2, '0')}`);
      }
    }

    const sortedLabels  = [...allPeriods].sort();
    const balanceValues = sortedLabels.map(
      p => (incomeByPeriod[p] || 0) - (expenseByPeriod[p] || 0)
    );
    const formattedLabels = sortedLabels.map(label =>
      isMonthlyAggregation
        ? `${label.substring(0, 4)}/${label.substring(4, 6)}`
        : `${label.substring(4, 6)}/${label.substring(6, 8)}`
    );

    this.createChart('line', formattedLabels, [{
      label: isMonthlyAggregation ? '月別収支' : '日別収支',
      data: balanceValues,
      borderColor: this.color,
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      fill: true,
      tension: 0.3,
    }], {
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45 } },
        y: { beginAtZero: false },
      },
    });
  }

  _aggregate(data, isMonthlyAggregation) {
    return data.reduce((acc, curr) => {
      const dateStr = String(curr[this.dateKey]);
      const period  = isMonthlyAggregation
        ? dateStr.substring(0, 6)
        : dateStr.substring(0, 8);
      acc[period] = (acc[period] || 0) + (Number(curr[this.valueKey]) || 0);
      return acc;
    }, {});
  }
}