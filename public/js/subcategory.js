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
  categoryUrl,
} from "./shared.js";

const { computed, nextTick, onBeforeUnmount, onMounted, ref } = Vue;

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

mountApp({
  setup() {
    const category = readQuery("category");
    const subCategory = readQuery("name");
    const detail = ref(null);
    const rangeKey = ref(rangeKeyFromQuery());
    const loading = ref(false);
    const error = ref("");

    const shopCanvas = ref(null);
    const timelineCanvas = ref(null);
    let shopChart = null;
    let timelineChart = null;

    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");

    const top3Share = computed(() => {
      if (!detail.value || !(detail.value.totalGmv > 0)) return null;
      const total = detail.value.totalGmv;
      const top3 = [...detail.value.shops]
        .sort((a, b) => b.totalGmv - a.totalGmv)
        .slice(0, 3)
        .reduce((sum, shop) => sum + shop.totalGmv, 0);
      return (top3 / total) * 100;
    });

    function shareOf(gmv) {
      if (!detail.value || gmv === null || !(detail.value.totalGmv > 0)) return null;
      return (gmv / detail.value.totalGmv) * 100;
    }

    async function load() {
      if (!category || !subCategory) {
        error.value = "Thiếu tham số ngành hàng hoặc ngành con.";
        return;
      }

      loading.value = true;
      error.value = "";
      try {
        const path = `/api/categories/${encodeURIComponent(category)}/subcategories/${encodeURIComponent(subCategory)}`;
        const body = await apiGet(path, rangeParams(rangeKey.value));
        detail.value = body.data;
        document.title = `${subCategory} | TikTok E-Commerce Analytics`;
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
      destroyChart(shopChart);
      destroyChart(timelineChart);

      const shops = [...detail.value.shops].slice(0, 10);

      if (shopCanvas.value) {
        shopChart = new Chart(shopCanvas.value, {
          type: "bar",
          data: {
            labels: shops.map((shop) => shortLabel(shop.name, 18)),
            datasets: [barDataset("GMV", shops.map((shop) => shop.totalGmv), [CHART_COLORS.violet])],
          },
          options: {
            ...BASE_OPTIONS,
            indexAxis: "y",
            onClick: (_event, elements) => {
              const target = elements[0] && shops[elements[0].index];
              if (target) {
                window.location.href = `${shopUrl(target.id, { category, subCategory })}&range=${rangeKey.value}`;
              }
            },
            plugins: {
              ...BASE_OPTIONS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: { label: (context) => ` GMV: ${formatCurrency(context.parsed.x, { compact: true })}` },
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

      const timeline = detail.value.timeline;
      if (timelineCanvas.value) {
        timelineChart = new Chart(timelineCanvas.value, {
          type: "line",
          data: {
            labels: timeline.map((point) => dayLabel(point.date)),
            datasets: [lineDataset("GMV", timeline.map((point) => point.value), CHART_COLORS.accent, { fillOpacity: 0.4 })],
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
    }

    function setRange(nextKey) {
      rangeKey.value = nextKey;
      setRangeInUrl(nextKey);
      load();
    }

    onMounted(load);
    onBeforeUnmount(() => {
      destroyChart(shopChart);
      destroyChart(timelineChart);
    });

    return {
      category,
      subCategory,
      detail,
      rangeKey,
      rangeLabel,
      loading,
      error,
      shopCanvas,
      timelineCanvas,
      top3Share,
      shareOf,
      setRange,
      shopUrl,
      categoryUrl,
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
