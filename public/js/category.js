import {
  apiGet,
  barDataset,
  BASE_OPTIONS,
  CHART_COLORS,
  dayLabel,
  destroyChart,
  formatCompact,
  formatCurrency,
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
  shopUrl,
  shortLabel,
  subCategoryUrl,
} from "./shared.js";

const { computed, nextTick, onBeforeUnmount, onMounted, ref } = Vue;

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

mountApp({
  setup() {
    const categoryName = readQuery("name");
    const detail = ref(null);
    const rangeKey = ref(rangeKeyFromQuery());
    const loading = ref(false);
    const error = ref("");

    const timelineCanvas = ref(null);
    const subCanvas = ref(null);
    let timelineChart = null;
    let subChart = null;

    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");

    if (categoryName) document.title = `${categoryName} | TikTok E-Commerce Analytics`;

    async function load() {
      if (!categoryName) {
        error.value = "Thiếu tham số ngành hàng (?name=...)";
        return;
      }

      loading.value = true;
      error.value = "";
      try {
        const body = await apiGet(`/api/categories/${encodeURIComponent(categoryName)}`, rangeParams(rangeKey.value));
        detail.value = body.data;
        await nextTick();
        renderCharts();
      } catch (err) {
        error.value = err.message ?? String(err);
        detail.value = null;
      } finally {
        loading.value = false;
        await nextTick();
        renderCharts();
      }
    }

    function renderCharts() {
      if (typeof Chart === "undefined" || !detail.value) return;
      destroyChart(timelineChart);
      destroyChart(subChart);

      const timeline = detail.value.timeline;
      if (timelineCanvas.value) {
        timelineChart = new Chart(timelineCanvas.value, {
          type: "line",
          data: {
            labels: timeline.map((point) => dayLabel(point.date)),
            datasets: [lineDataset("GMV", timeline.map((point) => point.value), CHART_COLORS.accent, { fillOpacity: 0.42 })],
          },
          options: {
            ...BASE_OPTIONS,
            plugins: {
              ...BASE_OPTIONS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: { label: (context) => ` GMV: ${formatCurrency(context.parsed.y)}` },
              },
            },
          },
        });
      }

      const subs = detail.value.subCategories;
      if (subCanvas.value) {
        subChart = new Chart(subCanvas.value, {
          type: "bar",
          data: {
            labels: subs.map((sub) => shortLabel(sub.name, 16)),
            datasets: [
              barDataset("GMV", subs.map((sub) => sub.totalGmv), [CHART_COLORS.violet]),
              {
                ...barDataset("Đã bán", subs.map((sub) => sub.totalSales), [CHART_COLORS.cyan]),
                yAxisID: "y1",
              },
            ],
          },
          options: {
            ...BASE_OPTIONS,
            onClick: (_event, elements) => {
              const target = elements[0] && subs[elements[0].index];
              if (target) {
                window.location.href = `${subCategoryUrl(detail.value.category, target.name)}&range=${rangeKey.value}`;
              }
            },
            plugins: {
              ...BASE_OPTIONS.plugins,
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (context) =>
                    context.dataset.yAxisID === "y1"
                      ? ` Đã bán: ${formatNumber(context.parsed.y)}`
                      : ` GMV: ${formatCurrency(context.parsed.y, { compact: true })}`,
                },
              },
            },
            scales: {
              x: { ...BASE_OPTIONS.scales.x, ticks: { ...BASE_OPTIONS.scales.x.ticks, autoSkip: false } },
              y: { ...BASE_OPTIONS.scales.y },
              y1: { ...BASE_OPTIONS.scales.y, position: "right", grid: { display: false } },
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
      destroyChart(timelineChart);
      destroyChart(subChart);
    });

    return {
      categoryName,
      detail,
      rangeKey,
      rangeLabel,
      loading,
      error,
      timelineCanvas,
      subCanvas,
      setRange,
      subCategoryUrl,
      shopUrl,
      formatCurrency,
      formatNumber,
      formatCompact,
      formatPercent,
      growthClass,
      growthIcon,
      initials,
    };
  },
});
