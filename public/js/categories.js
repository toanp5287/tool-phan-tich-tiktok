import {
  apiGet,
  barDataset,
  BASE_OPTIONS,
  CHART_COLORS,
  categoryUrl,
  destroyChart,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  growthClass,
  growthIcon,
  hexToRgba,
  mountApp,
  knownSum,
  rangeKeyFromQuery,
  rangeParams,
  setRangeInUrl,
  shortLabel,
} from "./shared.js";

const { computed, nextTick, onBeforeUnmount, onMounted, ref } = Vue;

const PALETTE = [
  CHART_COLORS.accent,
  CHART_COLORS.violet,
  CHART_COLORS.cyan,
  CHART_COLORS.emerald,
  CHART_COLORS.amber,
  "#f472b6",
  "#60a5fa",
  "#a3e635",
  "#fb923c",
  "#94a3b8",
];

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

mountApp({
  setup() {
    const categories = ref([]);
    const overview = ref({ categoryCount: 0, totalGmv: null, totalSales: null, totalProducts: 0, totalShops: 0, growthRate: null });
    const rangeKey = ref(rangeKeyFromQuery());
    const loading = ref(false);
    const error = ref("");

    const shareCanvas = ref(null);
    const growthCanvas = ref(null);
    let shareChart = null;
    let growthChart = null;

    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");

    const totals = computed(() => ({
      gmv: overview.value.totalGmv,
      sales: overview.value.totalSales,
       views: knownSum(categories.value.map(item => item.totalViews)),
      products: overview.value.totalProducts,
      shops: overview.value.totalShops,
    }));

    const fastest = computed(() => categories.value.filter(item => typeof item.growthRate === 'number').sort((a, b) => b.growthRate - a.growthRate)[0] ?? null);

    async function load() {
      loading.value = true;
      error.value = "";
      try {
        const body = await apiGet("/api/categories", rangeParams(rangeKey.value));
        categories.value = body.data.categories ?? [];
        overview.value = body.data.overview ?? overview.value;
        renderCharts();
      } catch (err) {
        error.value = err.message ?? String(err);
        categories.value = [];
      } finally {
        loading.value = false;
        await nextTick();
        renderCharts();
      }
    }

    function renderCharts() {
      if (typeof Chart === "undefined") return;
      destroyChart(shareChart);
      destroyChart(growthChart);

      const items = categories.value.filter((item) => item.hasData !== false && item.totalGmv > 0);

      if (shareCanvas.value && items.length > 0) {
        shareChart = new Chart(shareCanvas.value, {
          type: "doughnut",
          data: {
            labels: items.map((item) => item.name),
            datasets: [
              {
                data: items.map((item) => item.totalGmv),
                backgroundColor: items.map((_, index) => hexToRgba(PALETTE[index % PALETTE.length], 0.8)),
                borderColor: "#ffffff",
                borderWidth: 2,
                hoverOffset: 8,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            onClick: (_event, elements) => {
              const target = elements[0] && items[elements[0].index];
              if (target) window.location.href = `${categoryUrl(target.name)}&range=${rangeKey.value}`;
            },
            plugins: {
              legend: { position: "right", labels: { ...BASE_OPTIONS.plugins.legend.labels } },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (context) =>
                    ` ${context.label}: ${formatCurrency(context.parsed, { compact: true })} (${formatPercent(items[context.dataIndex]?.shareOfGmv)})`,
                },
              },
            },
          },
        });
      }

      if (growthCanvas.value && items.length > 0) {
        const sorted = [...items].sort((a, b) => b.growthRate - a.growthRate);
        growthChart = new Chart(growthCanvas.value, {
          type: "bar",
          data: {
            labels: sorted.map((item) => shortLabel(item.name, 20)),
            datasets: [
              {
                ...barDataset("Tăng trưởng", sorted.map((item) => item.growthRate), [CHART_COLORS.emerald]),
                backgroundColor: sorted.map((item) =>
                  hexToRgba(item.growthRate >= 0 ? CHART_COLORS.emerald : CHART_COLORS.accent, 0.75),
                ),
                borderColor: sorted.map((item) => (item.growthRate >= 0 ? CHART_COLORS.emerald : CHART_COLORS.accent)),
              },
            ],
          },
          options: {
            ...BASE_OPTIONS,
            indexAxis: "y",
            onClick: (_event, elements) => {
              const target = elements[0] && sorted[elements[0].index];
              if (target) window.location.href = `${categoryUrl(target.name)}&range=${rangeKey.value}`;
            },
            plugins: {
              ...BASE_OPTIONS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: { label: (context) => ` ${formatPercent(context.parsed.x, { sign: true })}` },
              },
            },
            scales: {
              x: {
                ...BASE_OPTIONS.scales.y,
                beginAtZero: true,
                ticks: { ...BASE_OPTIONS.scales.y.ticks, callback: (value) => `${value}%` },
              },
              y: { ...BASE_OPTIONS.scales.x, ticks: { ...BASE_OPTIONS.scales.x.ticks, autoSkip: false, font: { size: 10.5 } } },
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
      destroyChart(shareChart);
      destroyChart(growthChart);
    });

    return {
      categories,
      overview,
      rangeKey,
      rangeLabel,
      loading,
      error,
      totals,
      fastest,
      shareCanvas,
      growthCanvas,
      load,
      setRange,
      categoryUrl,
      formatCurrency,
      formatNumber,
      formatCompact,
      formatPercent,
      growthClass,
      growthIcon,
    };
  },
});
