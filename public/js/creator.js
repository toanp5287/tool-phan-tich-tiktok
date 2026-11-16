import {
  apiGet,
  BASE_OPTIONS,
  CHART_COLORS,
  dayLabel,
  destroyChart,
  formatCompact,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  growthClass,
  growthIcon,
  initials,
  lineDataset,
  mountApp,
  rangeKeyFromQuery,
  rangeParams,
  readQuery,
  setRangeInUrl,
} from "./shared.js";

const { computed, nextTick, onBeforeUnmount, onMounted, ref } = Vue;

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

function readId() {
  const parsed = Number.parseInt(readQuery("id"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

mountApp({
  setup() {
    const creatorId = readId();
    const detail = ref(null);
    const rangeKey = ref(rangeKeyFromQuery());
    const loading = ref(true);
    const error = ref("");

    const gmvCanvas = ref(null);
    const followerCanvas = ref(null);
    let gmvChart = null;
    let followerChart = null;

    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");

    async function load() {
      if (!creatorId) {
        loading.value = false;
        error.value = "Thiếu hoặc sai tham số ID nhà sáng tạo (?id=...)";
        return;
      }

      loading.value = true;
      error.value = "";

      try {
        const body = await apiGet(`/api/creators/${creatorId}`, rangeParams(rangeKey.value));
        detail.value = body.data;
        document.title = `${body.data.displayName} | TikTok E-Commerce Analytics`;
      } catch (err) {
        error.value = err.message ?? String(err);
        detail.value = null;
      } finally {
        loading.value = false;
      }

      await nextTick();
      renderCharts();
    }

    function renderCharts() {
      if (typeof Chart === "undefined" || !detail.value) return;
      destroyChart(gmvChart);
      destroyChart(followerChart);

      const timeline = detail.value.timeline ?? [];

      if (gmvCanvas.value) {
        gmvChart = new Chart(gmvCanvas.value, {
          type: "line",
          data: {
            labels: timeline.map((point) => dayLabel(point.date)),
            datasets: [
              lineDataset("GMV", timeline.map((point) => point.gmv), CHART_COLORS.accent, { fillOpacity: 0.42 }),
            ],
          },
          options: {
            ...BASE_OPTIONS,
            plugins: {
              ...BASE_OPTIONS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: { label: (ctx) => ` GMV: ${formatCurrency(ctx.parsed.y)}` },
              },
            },
          },
        });
      }

      if (followerCanvas.value) {
        followerChart = new Chart(followerCanvas.value, {
          type: "line",
          data: {
            labels: timeline.map((point) => dayLabel(point.date)),
            datasets: [
              lineDataset("Followers", timeline.map((point) => point.followers), CHART_COLORS.violet, { fillOpacity: 0.3 }),
              {
                ...lineDataset("Đã bán", timeline.map((point) => point.soldCount), CHART_COLORS.cyan, { fillOpacity: 0.16 }),
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
              y: { ...BASE_OPTIONS.scales.y },
              y1: { ...BASE_OPTIONS.scales.y, position: "right", grid: { display: false } },
            },
            plugins: {
              ...BASE_OPTIONS.plugins,
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (context) =>
                    context.dataset.yAxisID === "y1"
                      ? ` Đã bán: ${formatNumber(context.parsed.y)}`
                      : ` Followers: ${formatCompact(context.parsed.y)}`,
                },
              },
            },
          },
        });
      }
    }

    function setRange(nextKey) {
      rangeKey.value = nextKey;
      setRangeInUrl(nextKey);
      load();
    }

    onMounted(load);
    onBeforeUnmount(() => {
      destroyChart(gmvChart);
      destroyChart(followerChart);
    });

    return {
      detail,
      rangeKey,
      rangeLabel,
      loading,
      error,
      gmvCanvas,
      followerCanvas,
      setRange,
      formatCurrency,
      formatNumber,
      formatCompact,
      formatPercent,
      formatDate,
      growthClass,
      growthIcon,
      initials,
    };
  },
});
