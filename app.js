(function () {
  "use strict";

  const PERIOD_DAYS = { "1y": 252, "5y": 1260, "10y": 2520 };

  const state = {
    holdings: [],
    today: { updated_at: null, prices: {} },
    historyCache: new Map(), // code -> {dates, closes}
    chartInstances: new Map(), // code -> Chart
    selectedPeriod: new Map(), // code -> "1y" | "5y" | "10y"
  };

  const cardList = document.getElementById("cardList");
  const cardTemplate = document.getElementById("cardTemplate");
  const searchBox = document.getElementById("searchBox");
  const updatedAtEl = document.getElementById("updatedAt");

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
    return `当日データ更新: ${jst} JST時点`;
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
      // today.json が無い場合は前日分のみで表示する
    }

    updatedAtEl.textContent = formatUpdatedAt(state.today.updated_at);
    renderCardList(state.holdings);
  }

  function renderCardList(holdings) {
    cardList.innerHTML = "";
    if (holdings.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "該当する銘柄がありません";
      cardList.appendChild(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const holding of holdings) {
      frag.appendChild(buildCard(holding));
    }
    cardList.appendChild(frag);
  }

  function buildCard(holding) {
    const node = cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".card");
    card.dataset.code = holding.code;

    node.querySelector(".card-code").textContent = holding.code;
    node.querySelector(".card-name").textContent = holding.name || "";
    node.querySelector(".card-market").textContent = holding.market || "";
    node.querySelector(".card-div-month").textContent = formatMonths(
      holding.div_month1,
      holding.div_month2
    );
    node.querySelector(".card-div-amount").textContent = holding.div_amount
      ? `${holding.div_amount}円`
      : "-";
    node.querySelector(".card-yutai-month").textContent = formatMonths(
      holding.yutai_month1,
      holding.yutai_month2
    );
    node.querySelector(".card-yutai-content").textContent =
      holding.yutai_content || "-";

    const summaryBtn = node.querySelector(".card-summary");
    summaryBtn.addEventListener("click", () => toggleCard(card));

    const periodButtons = node.querySelectorAll(".period-buttons button");
    periodButtons.forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setPeriod(card, btn.dataset.period);
      });
    });

    return node;
  }

  function toggleCard(card) {
    const chartArea = card.querySelector(".card-chart");
    const isOpen = card.classList.toggle("open");
    chartArea.hidden = !isOpen;
    if (isOpen) {
      openChart(card);
    }
  }

  async function openChart(card) {
    const code = card.dataset.code;
    const statusEl = card.querySelector(".chart-status");
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
    drawChart(card, period);
  }

  function setPeriod(card, period) {
    const code = card.dataset.code;
    state.selectedPeriod.set(code, period);
    card.querySelectorAll(".period-buttons button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.period === period);
    });
    if (state.historyCache.has(code)) {
      drawChart(card, period);
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

  function drawChart(card, period) {
    const code = card.dataset.code;
    const { dates, closes } = mergedSeries(code);
    const sliced = sliceByPeriod(dates, closes, period);
    const canvas = card.querySelector("canvas");

    const existing = state.chartInstances.get(code);
    if (existing) {
      existing.data.labels = sliced.dates;
      existing.data.datasets[0].data = sliced.closes;
      existing.update();
      return;
    }

    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();

    const chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: sliced.dates,
        datasets: [
          {
            data: sliced.closes,
            borderColor: accent || "#2563eb",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.15,
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

  function applySearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      renderCardList(state.holdings);
      return;
    }
    const filtered = state.holdings.filter((h) => {
      const name = (h.name || "").toLowerCase();
      const code = (h.code || "").toLowerCase();
      return name.includes(q) || code.includes(q);
    });
    renderCardList(filtered);
  }

  searchBox.addEventListener("input", (ev) => applySearch(ev.target.value));

  loadData().catch((err) => {
    cardList.innerHTML = `<p class="empty">データの読み込みに失敗しました: ${err}</p>`;
  });
})();
