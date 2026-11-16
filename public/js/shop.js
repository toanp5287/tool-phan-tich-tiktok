import {
  apiGet,
  barDataset,
  BASE_OPTIONS,
  CHART_COLORS,
  destroyChart,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  growthClass,
  growthIcon,
  initials,
  lineDataset,
  mountApp,
  rangeKeyFromQuery,
  rangeParams,
  setRangeInUrl,
} from "./shared.js";

const { reactive, ref, computed, onBeforeUnmount, onMounted } = Vue;

mountApp({
  setup() {
    const overview = reactive({
      totals: { products: 0, shops: 0, snapshots: 0, trackings: 0, creators: 0 },
      revenue: { totalGmv: null, totalSales: null, totalViews: null, avgOrderValue: null },
      trend: { totalCurrent: null, totalPrevious: null, growthRate: null, trend: "unknown", label: "Chưa đủ lịch sử" },
      lastJob: null,
      topProducts: [],
      topShops: [],
      topCreators: [],
      categoryBreakdown: [],
      revenueTimeline: [],
      salesTimeline: [],
      dataQuality: { hasProductMetrics: true, hasGmvRanking: true, categoryCatalogOnly: false },
    });

    const rangeKey = ref(rangeKeyFromQuery());
    const search = ref("");
    const loading = ref(false);
    const error = ref("");
    const scraping = ref(false);
    const externalActionsEnabled = ref(false);
    const lastRefreshed = ref(null);

    const revenueCanvas = ref(null);
    const shopCanvas = ref(null);
    let revenueChart = null;
    let shopChart = null;
    let pollTimer = null;

    const rangeLabel = computed(() => {
      const map = { yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };
      return map[rangeKey.value] ?? "30 ngày qua";
    });

    const topProducts = computed(() =>
      (overview.topProducts ?? []).slice(0, 100),
    );

    const filteredProducts = computed(() => {
      const keyword = search.value.trim().toLowerCase();
      if (!keyword) return topProducts.value;
      return topProducts.value.filter(
        (product) =>
          product.title?.toLowerCase().includes(keyword) ||
          product.shopName?.toLowerCase().includes(keyword) ||
          product.category?.toLowerCase().includes(keyword),
      );
    });

    const lastRefreshedLabel = computed(() =>
      lastRefreshed.value ? formatDate(lastRefreshed.value, "long") : "—",
    );

    function categoryPercent(gmv) {
      const values = overview.categoryBreakdown.map((item) => item.gmv);
      const max = Math.max(...values, 1);
      return Math.max(2, Math.round((gmv / max) * 100));
    }

    function jobStatusClass(status) {
      if (status === "COMPLETED") return "pill-positive";
      if (status === "PARTIAL") return "pill-accent";
      if (status === "FAILED") return "pill-negative";
      return "pill-live";
    }

    async function loadOverview() {
      const body = await apiGet("/api/overview", rangeParams(rangeKey.value));
      Object.assign(overview, body.data);
    }

    async function loadScrapeConfig() {
      try {
        const body = await apiGet("/api/scrape/status");
        scraping.value = Boolean(body.data.running);
        externalActionsEnabled.value = body.data.config?.externalActionsEnabled === true;
      } catch {
        /* không bắt buộc */
      }
    }

    async function loadAll() {
      loading.value = true;
      error.value = "";

      try {
        await Promise.all([loadOverview(), loadScrapeConfig()]);
        lastRefreshed.value = new Date();
        renderCharts();
      } catch (err) {
        error.value = err.message ?? String(err);
      } finally {
        loading.value = false;
      }
    }

    async function triggerScrape() {
      scraping.value = true;
      try {
        const response = await fetch("/api/scrape", { method: "POST" });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body?.error?.message ?? "Không thể khởi chạy phiên cào");
        pollScrape();
      } catch (err) {
        error.value = err.message ?? String(err);
        scraping.value = false;
      }
    }

    function pollScrape() {
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const body = await apiGet("/api/scrape/status");
          scraping.value = Boolean(body.data.running);
          if (!body.data.running) {
            clearInterval(pollTimer);
            pollTimer = null;
            await loadAll();
          }
        } catch {
          clearInterval(pollTimer);
          pollTimer = null;
          scraping.value = false;
        }
      }, 4000);
    }

    function renderCharts() {
      if (typeof Chart === "undefined") return;

      destroyChart(revenueChart);
      destroyChart(shopChart);

      const labels = overview.revenueTimeline.map((point) =>
        new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(point.date)),
      );

      if (revenueCanvas.value) {
        revenueChart = new Chart(revenueCanvas.value, {
          type: "line",
          data: {
            labels,
            datasets: [
              lineDataset("GMV (₫)", overview.revenueTimeline.map((point) => point.value), CHART_COLORS.accent, {
                fillOpacity: 0.42,
              }),
              {
                ...lineDataset("Đơn hàng", overview.salesTimeline.map((point) => point.value), CHART_COLORS.cyan, {
                  fillOpacity: 0.18,
                }),
                yAxisID: "y1",
                borderDash: [5, 5],
                borderWidth: 1.8,
              },
            ],
          },
          options: {
            ...BASE_OPTIONS,
            scales: {
              ...BASE_OPTIONS.scales,
              y: { ...BASE_OPTIONS.scales.y, position: "left" },
              y1: {
                ...BASE_OPTIONS.scales.y,
                position: "right",
                grid: { display: false },
                beginAtZero: true,
                ticks: { ...BASE_OPTIONS.scales.y.ticks, callback: (value) => formatCompact(value) },
              },
            },
            plugins: {
              ...BASE_OPTIONS.plugins,
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (context) =>
                    context.dataset.yAxisID === "y1"
                      ? ` ${context.dataset.label}: ${formatNumber(context.parsed.y)} đơn`
                      : ` ${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
                },
              },
            },
          },
        });
      }

      const shops = (overview.topShops ?? []).slice(0, 10);
      if (shopCanvas.value) {
        shopChart = new Chart(shopCanvas.value, {
          type: "bar",
          data: {
            labels: shops.map((shop) => (shop.name.length > 18 ? `${shop.name.slice(0, 17)}…` : shop.name)),
            datasets: [
              barDataset(
                "GMV",
                shops.map((shop) => shop.gmv),
                [CHART_COLORS.violet, CHART_COLORS.accent, CHART_COLORS.cyan, CHART_COLORS.emerald, CHART_COLORS.amber],
              ),
            ],
          },
          options: {
            ...BASE_OPTIONS,
            indexAxis: "y",
            plugins: {
              ...BASE_OPTIONS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (context) => ` GMV: ${formatCurrency(context.parsed.x)}`,
                  afterLabel: (context) => ` Số bán lũy kế: ${formatNumber(shops[context.dataIndex]?.sales)}`,
                },
              },
            },
            scales: {
              x: {
                ...BASE_OPTIONS.scales.y,
                ticks: { ...BASE_OPTIONS.scales.y.ticks, callback: (value) => formatCompact(value) },
              },
              y: { ...BASE_OPTIONS.scales.x, ticks: { ...BASE_OPTIONS.scales.x.ticks, autoSkip: false } },
            },
          },
        });
      }
    }

    function setRange(nextKey) {
      rangeKey.value = nextKey;
      setRangeInUrl(nextKey);
      loadAll();
    }

    onMounted(() => {
      if (window.Chart) loadAll();
      else window.addEventListener("load", loadAll, { once: true });
    });

    onBeforeUnmount(() => {
      clearInterval(pollTimer);
      destroyChart(revenueChart);
      destroyChart(shopChart);
    });

    return {
      overview,
      rangeKey,
      rangeLabel,
      search,
      loading,
      error,
      scraping,
      externalActionsEnabled,
      lastRefreshedLabel,
      revenueCanvas,
      shopCanvas,
      topProducts,
      filteredProducts,
      loadAll,
      triggerScrape,
      setRange,
      categoryPercent,
      jobStatusClass,
      formatCurrency,
      formatNumber,
      formatCompact,
      formatPercent,
      formatDate,
      formatDuration,
      growthClass,
      growthIcon,
      initials,
    };
  },
});
