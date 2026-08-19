(function () {
  "use strict";

  const PERIOD_DAYS = { "1m": 30, "1y": 252, "5y": 1260, "10y": 2520 };

  const state = {
    holdings: [],
    holdingsByCode: new Map(),
    today: { updated_at: null, prices: {} },
    historyCache: new Map(), // code -> {dates, closes}
    chartInstances: new Map(), // code -> Chart
    selectedPeriod: new Map(), // code -> "1y" | "5y" | "10y"
    sortKey: "code", // "code" | "change" | "profit"
  };

  const rowList = document.getElementById("rowList");
  const rowTemplate = document.getElementById("rowTemplate");
  const searchBox = document.getElementById("searchBox");
  const updatedAtEl = document.getElementById("updatedAt");
  const sortButtons = document.querySelectorAll(".sort-buttons button");

  function formatMonths(m1, m2) {
    const parts = [m1, m2].filter(
      (v) => v !== null && v !== undefined && v !== "" && v !== "-"
    );
    return parts.length ? parts.map((v) => `${v}月`).join("・") : "-";
  }

  function formatUpdatedAt(iso) {
    if (!iso) return "当日データ: 未取得";
    const d = new Date(iso);
    const jst = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `当日 ${jst}時点`;
  }

  function formatYen(value) {
    if (value === null || value === undefined) return "-";
    return Math.round(value).toLocaleString("ja-JP");
  }

  function formatSignedPct(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }

  function signClass(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "";
    if (value > 0) return "up";
    if (value < 0) return "down";
    return "";
  }

  async function loadData() {
    const holdingsRes = await fetch("data/holdings.json");
    state.holdings = await holdingsRes.json();

    try {
      const todayRes = await fetch("data/today.json", { cache: "no-store" });
      if (todayRes.ok) {
        state.today = await todayRes.json();
      }
    } catch (e) {
      // today.json が無い場合は取得値のみで表示する
    }

    for (const h of state.holdings) {
      state.holdingsByCode.set(h.code, h);
      const todayEntry = state.today.prices && state.today.prices[h.code];
      h.current = todayEntry ? todayEntry.close : null;
      h.changePct = todayEntry ? todayEntry.change_pct : null;
      h.profitPct =
        h.current !== null && h.acquisition_price
          ? ((h.current - h.acquisition_price) / h.acquisition_price) * 100
          : null;
    }

    updatedAtEl.textContent = formatUpdatedAt(state.today.updated_at);
    refreshList();
  }

  function sortHoldings(list, sortKey) {
    if (sortKey !== "change" && sortKey !== "profit") return list;
    const field = sortKey === "change" ? "changePct" : "profitPct";
    const withValue = [];
    const withoutValue = [];
    for (const h of list) {
      (h[field] === null || h[field] === undefined ? withoutValue : withValue).push(h);
    }
    withValue.sort((a, b) => a[field] - b[field]);
    return withValue.concat(withoutValue);
  }

  function refreshList() {
    const filtered = filterHoldings(state.holdings, searchBox.value);
    renderRowList(sortHoldings(filtered, state.sortKey));
  }

  function filterHoldings(holdings, query) {
    const q = query.trim().toLowerCase();
    if (!q) return holdings;
    return holdings.filter((h) => {
      const name = (h.name || "").toLowerCase();
      const code = (h.code || "").toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }

  function renderRowList(holdings) {
    rowList.innerHTML = "";
    if (holdings.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "該当する銘柄がありません";
      rowList.appendChild(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const holding of holdings) {
      frag.appendChild(buildRow(holding));
    }
    rowList.appendChild(frag);
  }

  function buildRow(holding) {
    const node = rowTemplate.content.cloneNode(true);
    const row = node.querySelector(".row");
    row.dataset.code = holding.code;

    node.querySelector(".row-code").textContent = holding.code;
    node.querySelector(".row-name").textContent = holding.name || "";

    node.querySelector(".row-acq").textContent = formatYen(holding.acquisition_price);
    node.querySelector(".row-current").textContent = formatYen(holding.current);

    const changeEl = node.querySelector(".row-change");
    changeEl.textContent = formatSignedPct(holding.changePct);
    changeEl.classList.add(...[signClass(holding.changePct)].filter(Boolean));

    const profitEl = node.querySelector(".row-profit");
    profitEl.textContent = formatSignedPct(holding.profitPct);
    profitEl.classList.add(...[signClass(holding.profitPct)].filter(Boolean));

    node.querySelector(".detail-market").textContent = holding.market || "-";
    node.querySelector(".detail-div-month").textContent = formatMonths(
      holding.div_month1,
      holding.div_month2
    );
    node.querySelector(".detail-div-amount").textContent = holding.div_amount
      ? `${holding.div_amount}円`
      : "-";
    node.querySelector(".detail-yutai-month").textContent = formatMonths(
      holding.yutai_month1,
      holding.yutai_month2
    );
    node.querySelector(".detail-yutai-content").textContent =
      holding.yutai_content || "-";

    const summaryBtn = node.querySelector(".row-summary");
    summaryBtn.addEventListener("click", () => toggleRow(row));

    const periodButtons = node.querySelectorAll(".period-buttons button");
    periodButtons.forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setPeriod(row, btn.dataset.period);
      });
    });

    return node;
  }

  function closeRow(row) {
    row.classList.remove("open");
    row.querySelector(".row-detail").hidden = true;
  }

  function toggleRow(row) {
    const wasOpen = row.classList.contains("open");
    rowList.querySelectorAll(".row.open").forEach((r) => {
      if (r !== row) closeRow(r);
    });
    if (wasOpen) {
      closeRow(row);
      return;
    }
    row.classList.add("open");
    row.querySelector(".row-detail").hidden = false;
    openChart(row);
  }

  async function openChart(row) {
    const code = row.dataset.code;
    const statusEl = row.querySelector(".chart-status");
    if (!state.historyCache.has(code)) {
      statusEl.textContent = "読み込み中...";
      try {
        const res = await fetch(`data/history/${code}.json`);
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        state.historyCache.set(code, data);
      } catch (e) {
        statusEl.textContent = "株価履歴を取得できませんでした";
        return;
      }
    }
    statusEl.textContent = "";
    const period = state.selectedPeriod.get(code) || "1y";
    drawChart(row, period);
  }

  function setPeriod(row, period) {
    const code = row.dataset.code;
    state.selectedPeriod.set(code, period);
    row.querySelectorAll(".period-buttons button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.period === period);
    });
    if (state.historyCache.has(code)) {
      drawChart(row, period);
    }
  }

  function mergedSeries(code) {
    const base = state.historyCache.get(code) || { dates: [], closes: [] };
    const dates = base.dates.slice();
    const closes = base.closes.slice();
    const todayEntry = state.today.prices && state.today.prices[code];
    if (todayEntry && todayEntry.date && typeof todayEntry.close === "number") {
      const lastDate = dates[dates.length - 1];
      if (!lastDate || todayEntry.date > lastDate) {
        dates.push(todayEntry.date);
        closes.push(todayEntry.close);
      }
    }
    return { dates, closes };
  }

  function sliceByPeriod(dates, closes, period) {
    const n = PERIOD_DAYS[period] || PERIOD_DAYS["1y"];
    const start = Math.max(0, dates.length - n);
    return { dates: dates.slice(start), closes: closes.slice(start) };
  }

  function drawChart(row, period) {
    const code = row.dataset.code;
    const holding = state.holdingsByCode.get(code);
    const { dates, closes } = mergedSeries(code);
    const sliced = sliceByPeriod(dates, closes, period);
    const canvas = row.querySelector("canvas");

    const existing = state.chartInstances.get(code);
    if (existing) {
      existing.destroy();
      state.chartInstances.delete(code);
    }

    const buyDates = new Set(holding && holding.buy_dates ? holding.buy_dates : []);
    const buyPoints = sliced.dates.map((d, i) =>
      buyDates.has(d) ? sliced.closes[i] : null
    );

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--accent").trim();
    const up = styles.getPropertyValue("--up").trim();

    const chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: sliced.dates,
        datasets: [
          {
            label: "終値",
            data: sliced.closes,
            borderColor: accent || "#2563eb",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.15,
          },
          {
            label: "買い日",
            data: buyPoints,
            showLine: false,
            pointRadius: 4,
            pointBackgroundColor: up || "#d92626",
            pointBorderColor: up || "#d92626",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { maxTicksLimit: 6, autoSkip: true },
            grid: { display: false },
          },
          y: {
            ticks: { maxTicksLimit: 5 },
          },
        },
      },
    });
    state.chartInstances.set(code, chart);
  }

  searchBox.addEventListener("input", refreshList);

  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sortKey = btn.dataset.sort;
      sortButtons.forEach((b) => b.classList.toggle("active", b === btn));
      refreshList();
    });
  });

  loadData().catch((err) => {
    rowList.innerHTML = `<p class="empty">データの読み込みに失敗しました: ${err}</p>`;
  });
})();
