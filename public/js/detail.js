import {
  apiGet,
  BASE_OPTIONS,
  CHART_COLORS,
  destroyChart,
  formatCompact,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  growthClass,
  growthIcon,
  initials,
  lineDataset,
  mountApp,
  rangeKeyFromQuery,
  rangeParams,
  setRangeInUrl,
} from "./shared.js";

const { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } = Vue;

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

const METRICS = [
  { key: "sales", label: "Đã bán", color: CHART_COLORS.accent, format: "number" },
  { key: "gmv", label: "GMV", color: CHART_COLORS.emerald, format: "currency" },
  { key: "views", label: "Lượt xem", color: CHART_COLORS.cyan, format: "compact" },
  { key: "likes", label: "Lượt thích", color: CHART_COLORS.violet, format: "compact" },
  { key: "price", label: "Giá", color: CHART_COLORS.amber, format: "currency" },
];

function readId() {
  const params = new URLSearchParams(window.location.search);
  const parsed = Number.parseInt(params.get("id") ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

mountApp({
  setup() {
    const productId = readId();
    const product = ref(null);
    const rangeKey = ref(rangeKeyFromQuery());
    const activeMetric = ref("sales");
    const loading = ref(true);
    const error = ref("");
    const aiLoading = ref(false);
    const aiError = ref("");
    const aiReport = ref(null);
    const aiHistory = ref([]);

    const mainCanvas = ref(null);
    const engagementCanvas = ref(null);
    const priceCanvas = ref(null);
    let mainChart = null;
    let engagementChart = null;
    let priceChart = null;

    const metrics = METRICS;
    const growthClassRef = growthClass;
    const growthIconRef = growthIcon;

    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");

    const series = computed(
      () => product.value?.historySeries ?? { sales: [], gmv: [], views: [], likes: [], price: [] },
    );

    function seriesFor(key) {
      return series.value[key] ?? [];
    }

    function firstValue(key) {
      return seriesFor(key)[0]?.value ?? null;
    }

    function lastValue(key) {
      const list = seriesFor(key);
      return list[list.length - 1]?.value ?? null;
    }

    const salesDelta = computed(() => product.value?.analytics?.salesTimeline?.dataKind === 'SIMULATED' || seriesFor("sales").length < 2 ? null : lastValue("sales") - firstValue("sales"));
    const gmvDelta = computed(() => product.value?.analytics?.timeline?.dataKind === 'SIMULATED' || seriesFor("gmv").length < 2 ? null : lastValue("gmv") - firstValue("gmv"));

    const conversionRate = computed(() => {
      if (!product.value || product.value.views === null || product.value.sales === null || product.value.views <= 0) return null;
      return (product.value.sales / product.value.views) * 100;
    });

    function formatMetric(value, type) {
      if (type === "currency") return formatCurrency(value);
      if (type === "compact") return formatCompact(value);
      return formatNumber(value);
    }

    async function loadProduct() {
      if (!productId) {
        loading.value = false;
        return;
      }

      loading.value = true;
      error.value = "";

      try {
        const body = await apiGet(`/api/products/${productId}`, rangeParams(rangeKey.value));
        product.value = body.data;
        document.title = `${body.data.title} | TikTok E-Commerce Analytics`;
      } catch (err) {
        error.value = err.message ?? String(err);
        product.value = null;
      } finally {
        loading.value = false;
      }

      await nextTick();
      renderCharts();
      await loadAiHistory();
    }

    async function loadAiHistory() {
      if (!productId) return;
      try {
        const [latest, history] = await Promise.all([
          apiGet(`/api/products/${productId}/ai-analysis/latest`),
          apiGet(`/api/products/${productId}/ai-analysis`),
        ]);
        aiReport.value = latest.data;
        aiHistory.value = history.data ?? [];
      } catch {
        aiReport.value = null;
        aiHistory.value = [];
      }
    }

    async function runAiAnalysis(force = false) {
      if (!productId || aiLoading.value) return;
      aiLoading.value = true;
      aiError.value = "";
      try {
        const body = await fetch(`/api/products/${productId}/ai-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ force, days: rangeKey.value === "90d" ? 90 : rangeKey.value === "7d" ? 7 : 30 }),
        }).then(async (response) => {
          const result = await response.json().catch(() => null);
          if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? `Yêu cầu thất bại (${response.status})`);
          return result;
        });
        aiReport.value = body.data;
        await loadAiHistory();
        window.location.href = `/ai-analysis.html?id=${body.data.id}&productId=${productId}`;
      } catch (err) {
        aiError.value = err.message ?? String(err);
      } finally {
        aiLoading.value = false;
      }
    }

    function setRange(nextKey) {
      rangeKey.value = nextKey;
      setRangeInUrl(nextKey);
      loadProduct();
    }

    function dateLabels(points) {
      return points.map((point) =>
        new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(point.date)),
      );
    }

function dateLabels(points) {
      return points.map((point) =>
        new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(point.date)),
      );
    }

    function mainChartOptions(metric) {
      return {
        ...BASE_OPTIONS,
        plugins: {
          ...BASE_OPTIONS.plugins,
          legend: { display: false },
          tooltip: {
            ...BASE_OPTIONS.plugins.tooltip,
            callbacks: {
              label: (context) => ` ${metric.label}: ${formatMetric(context.parsed.y, metric.format)}`,
            },
          },
        },
        scales: {
          ...BASE_OPTIONS.scales,
          y: {
            ...BASE_OPTIONS.scales.y,
            ticks: {
              ...BASE_OPTIONS.scales.y.ticks,
              callback: (value) => formatCompact(value),
            },
          },
        },
      };
    }

    function renderCharts() {
      if (typeof Chart === "undefined" || !product.value) return;

      destroyChart(mainChart);
      destroyChart(engagementChart);
      destroyChart(priceChart);

      const metric = METRICS.find((item) => item.key === activeMetric.value) ?? METRICS[0];
      const points = seriesFor(metric.key);

      if (mainCanvas.value) {
        mainChart = new Chart(mainCanvas.value, {
          type: "line",
          data: {
            labels: dateLabels(points),
            datasets: [lineDataset(metric.label, points.map((point) => point.value), metric.color, { fillOpacity: 0.4 })],
          },
          options: mainChartOptions(metric),
        });
      }

      if (engagementCanvas.value) {
        engagementChart = new Chart(engagementCanvas.value, {
          type: "line",
          data: {
            labels: dateLabels(seriesFor("views")),
            datasets: [
              lineDataset("Lượt xem", seriesFor("views").map((point) => point.value), CHART_COLORS.cyan, { fillOpacity: 0.3 }),
              lineDataset("Lượt thích", seriesFor("likes").map((point) => point.value), CHART_COLORS.accent, { fillOpacity: 0.2 }),
            ],
          },
          options: BASE_OPTIONS,
        });
      }

      if (priceCanvas.value) {
        priceChart = new Chart(priceCanvas.value, {
          type: "line",
          data: {
            labels: dateLabels(seriesFor("price")),
            datasets: [
              {
                ...lineDataset("Giá (₫)", seriesFor("price").map((point) => point.value), CHART_COLORS.amber, { fillOpacity: 0.24 }),
                stepped: true,
              },
            ],
          },
          options: {
            ...BASE_OPTIONS,
            plugins: {
              ...BASE_OPTIONS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: { label: (context) => ` Giá: ${formatCurrency(context.parsed.y)}` },
              },
            },
          },
        });
      }
    }

    function selectMetric(key) {
      activeMetric.value = key;
      renderCharts();
    }

    onMounted(() => {
      loadProduct();
    });

    onBeforeUnmount(() => {
      destroyChart(mainChart);
      destroyChart(engagementChart);
      destroyChart(priceChart);
    });

    return {
      product,
      rangeKey,
      rangeLabel,
      activeMetric,
      metrics,
      loading,
      error,
      mainCanvas,
      engagementCanvas,
      priceCanvas,
      salesDelta,
      gmvDelta,
      conversionRate,
      firstValue,
      lastValue,
      selectMetric,
      setRange,
      formatCurrency: (value, options = {}) => product.value?.currency ? formatCurrency(value, { ...options, currency: product.value.currency }) : "—",
      formatNumber,
      formatCompact,
      formatPercent,
      formatDate,
      formatRelative,
      growthClass: growthClassRef,
      growthIcon: growthIconRef,
      initials,
      aiLoading,
      aiError,
      aiReport,
      aiHistory,
      runAiAnalysis,
    };
  },
});
