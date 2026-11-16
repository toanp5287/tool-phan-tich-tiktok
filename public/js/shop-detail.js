import {
  apiGet,
  barDataset,
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
  shortLabel,
  subCategoryUrl,
  categoryUrl,
} from "./shared.js";

const { computed, nextTick, onBeforeUnmount, onMounted, ref } = Vue;

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

function readId() {
  const parsed = Number.parseInt(readQuery("id"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

mountApp({
  setup() {
    const shopId = readId();
    const context = { category: readQuery("category"), subCategory: readQuery("sub") };

    const detail = ref(null);
    const videos = ref([]);
    const videoSort = ref("playCount");
    const rangeKey = ref(rangeKeyFromQuery());
    const loading = ref(true);
    const videosLoading = ref(false);
    const error = ref("");

    const salesCanvas = ref(null);
    const revenueCanvas = ref(null);
    let salesChart = null;
    let revenueChart = null;

    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");

    const avgGmvPerProduct = computed(() => {
      if (!detail.value || detail.value.shop.totalGmv === null || detail.value.shop.productCount === 0) return null;
      return detail.value.shop.totalGmv / detail.value.shop.productCount;
    });

    const sortedVideos = computed(() => {
      const score = (video) =>
        videoSort.value === "engagement"
          ? video.diggCount + video.commentCount * 2 + video.shareCount * 3
          : video[videoSort.value];
      return [...videos.value].sort((a, b) => score(b) - score(a));
    });

    async function loadShop() {
      if (!shopId) {
        loading.value = false;
        error.value = "Thiếu hoặc sai tham số ID shop (?id=...)";
        return;
      }

      loading.value = true;
      error.value = "";

      try {
        const body = await apiGet(`/api/shops/${shopId}`, rangeParams(rangeKey.value));
        detail.value = body.data;
        document.title = `${body.data.shop.name} | TikTok E-Commerce Analytics`;
      } catch (err) {
        error.value = err.message ?? String(err);
        detail.value = null;
      } finally {
        loading.value = false;
      }

      await nextTick();
      renderCharts();
    }

    async function loadVideos() {
      if (!shopId) return;
      videosLoading.value = true;
      try {
        const body = await apiGet(`/api/shops/${shopId}/videos`, { limit: 24 });
        videos.value = body.data;
      } catch {
        videos.value = [];
      } finally {
        videosLoading.value = false;
      }
    }

    function renderCharts() {
      if (typeof Chart === "undefined" || !detail.value) return;

      destroyChart(salesChart);
      destroyChart(revenueChart);

      // Biểu đồ Doanh thu GMV theo ngày: price × ΔsoldCount từ snapshot (bucketDate).
      const timeline = detail.value.gmvTimeline ?? [];
      if (salesCanvas.value) {
        salesChart = new Chart(salesCanvas.value, {
          type: "line",
          data: {
            labels: timeline.map((point) => dayLabel(point.date)),
            datasets: [lineDataset("Doanh thu GMV", timeline.map((point) => point.value), CHART_COLORS.accent)],
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

      const sources = detail.value.revenueSources?.series ?? [];
      if (revenueCanvas.value) {
        revenueChart = new Chart(revenueCanvas.value, {
          type: "bar",
          data: {
            labels: sources.map((point) => dayLabel(point.date)),
            datasets: [
              barDataset("Video", sources.map((point) => point.video), [CHART_COLORS.accent]),
              barDataset("Live", sources.map((point) => point.live), [CHART_COLORS.cyan]),
              barDataset("Giỏ hàng", sources.map((point) => point.cart), [CHART_COLORS.emerald]),
              barDataset("Product card", sources.map((point) => point.productCard), [CHART_COLORS.violet]),
            ],
          },
          options: {
            ...BASE_OPTIONS,
            scales: {
              x: { ...BASE_OPTIONS.scales.x, stacked: true },
              y: {
                ...BASE_OPTIONS.scales.y,
                stacked: true,
                ticks: { ...BASE_OPTIONS.scales.y.ticks, callback: (value) => formatCompact(value) },
              },
            },
            plugins: {
              ...BASE_OPTIONS.plugins,
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, { compact: true })}`,
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
      loadShop();
    }

    onMounted(() => {
      loadShop();
      loadVideos();
    });
    onBeforeUnmount(() => {
      destroyChart(salesChart);
      destroyChart(revenueChart);
    });

    return {
      context,
      detail,
      videos,
      sortedVideos,
      videoSort,
      rangeKey,
      rangeLabel,
      loading,
      videosLoading,
      error,
      salesCanvas,
      revenueCanvas,
      avgGmvPerProduct,
      shortLabel,
      categoryUrl,
      subCategoryUrl,
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
