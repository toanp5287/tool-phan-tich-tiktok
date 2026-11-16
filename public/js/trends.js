import {
  apiGet,
  barDataset,
  BASE_OPTIONS,
  CHART_COLORS,
  destroyChart,
  formatCompact,
  formatNumber,
  formatPercent,
  formatRelative,
  mountApp,
  rangeKeyFromQuery,
  rangeParams,
  setRangeInUrl,
} from "./shared.js";

const { computed, onBeforeUnmount, onMounted, reactive, ref } = Vue;

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

mountApp({
  setup() {
    const summary = reactive({ totalCurrent: null, totalPrevious: null, growthRate: null, trend: "unknown", label: "—" });
    const keywords = ref([]);
    const trends = ref([]);
    const totalTrends = ref(0);
    const page = ref(1);
    const pageSize = 10;
    const rangeKey = ref(rangeKeyFromQuery());

    const error = ref("");
    const loadingTrends = ref(false);
    const keywordCanvas = ref(null);
    let keywordChart = null;

    const totalPages = computed(() => Math.max(1, Math.ceil(totalTrends.value / pageSize)));
    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");

    function clampFont(count) {
      const counts = keywords.value.map((item) => item.count);
      const max = Math.max(...counts, 1);
      const ratio = count / max;
      return Math.round(11 + ratio * 6);
    }

    async function loadSummary() {
      try {
        const body = await apiGet("/api/analytics/trends", rangeParams(rangeKey.value));
        Object.assign(summary, body.data);
      } catch (err) {
        error.value = err.message ?? String(err);
      }
    }

    async function loadKeywords() {
      try {
        const body = await apiGet("/api/trends/keywords", { ...rangeParams(rangeKey.value), limit: 24 });
        keywords.value = body.data;
        renderKeywordChart();
      } catch (err) {
        error.value = err.message ?? String(err);
      }
    }

    async function loadTrends() {
      loadingTrends.value = true;
      try {
        const body = await apiGet("/api/trends", { page: page.value, pageSize, ...rangeParams(rangeKey.value) });
        trends.value = body.data;
        totalTrends.value = body.pagination?.total ?? body.data.length;
      } catch (err) {
        error.value = err.message ?? String(err);
        trends.value = [];
      } finally {
        loadingTrends.value = false;
      }
    }

    function renderKeywordChart() {
      if (typeof Chart === "undefined" || !keywordCanvas.value) return;
      destroyChart(keywordChart);

      const top = keywords.value.slice(0, 8);
      keywordChart = new Chart(keywordCanvas.value, {
        type: "bar",
        data: {
          labels: top.map((item) => `#${item.keyword}`),
          datasets: [
            barDataset(
              "Số lần xuất hiện",
              top.map((item) => item.count),
              [CHART_COLORS.accent, CHART_COLORS.violet, CHART_COLORS.cyan],
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
              callbacks: { label: (context) => ` ${formatNumber(context.parsed.x)} lần` },
            },
          },
          scales: {
            x: { ...BASE_OPTIONS.scales.y },
            y: { ...BASE_OPTIONS.scales.x, ticks: { ...BASE_OPTIONS.scales.x.ticks, autoSkip: false, font: { size: 10 } } },
          },
        },
      });
    }

    function setRange(nextKey) {
      rangeKey.value = nextKey;
      setRangeInUrl(nextKey);
      page.value = 1;
      Promise.all([loadSummary(), loadKeywords(), loadTrends()]).catch((err) => {
        error.value = err.message ?? String(err);
      });
    }

    function changePage(next) {
      page.value = Math.min(Math.max(1, next), totalPages.value);
      loadTrends();
    }

    onMounted(async () => {
      await Promise.all([loadSummary(), loadKeywords(), loadTrends()]);
    });

    onBeforeUnmount(() => destroyChart(keywordChart));

    return {
      summary,
      keywords,
      trends,
      totalTrends,
      page,
      pageSize,
      rangeKey,
      rangeLabel,
      totalPages,
      error,
      loadingTrends,
      keywordCanvas,
      clampFont,
      setRange,
      changePage,
      formatNumber,
      formatCompact,
      formatPercent,
      formatRelative,
    };
  },
});
