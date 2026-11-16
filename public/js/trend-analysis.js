import {
  apiGet,
  BASE_OPTIONS,
  CHART_COLORS,
  destroyChart,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  lineDataset,
} from "./shared.js";
import { injectShell } from "./shell.js";

const { createApp, computed, onBeforeUnmount, onMounted, reactive, ref } = Vue;

const EMPTY_METRIC = () => ({ current: null, previous: null, diff: null, changePercent: null, direction: "unknown" });
const EMPTY_TOTALS = () => ({
  sales: EMPTY_METRIC(),
  gmv: EMPTY_METRIC(),
  views: EMPTY_METRIC(),
  products: EMPTY_METRIC(),
  shops: EMPTY_METRIC(),
});

createApp({
  setup() {
    const rows = ref([]);
    const detail = ref(null);
    const totals = reactive(EMPTY_TOTALS());
    const periodsMeta = ref([]);
    const days = ref(30);
    const periods = ref(2);
    const loading = ref(false);
    const error = ref("");

    const rangeOptions = [7, 30, 90];
    const periodOptions = [2, 3, 4];

    const timelineCanvas = ref(null);
    let timelineChart = null;

    const selectedCategory = computed(() => detail.value?.category ?? "");

    const upCount = computed(() => rows.value.filter((row) => row.metrics.gmv.direction === "up").length);
    const downCount = computed(() => rows.value.filter((row) => row.metrics.gmv.direction === "down").length);
    const flatCount = computed(() => rows.value.filter((row) => row.metrics.gmv.direction === "flat").length);

    const detailCards = computed(() => [
      { key: "gmv", label: "GMV", format: (value) => formatCurrency(value, { compact: true }) },
      { key: "sales", label: "Sản lượng bán", format: (value) => formatNumber(value) },
      { key: "views", label: "Lượt xem", format: (value) => formatCompact(value) },
      { key: "likes", label: "Lượt thích", format: (value) => formatCompact(value) },
      { key: "comments", label: "Bình luận", format: (value) => formatCompact(value) },
      { key: "shares", label: "Chia sẻ", format: (value) => formatCompact(value) },
      { key: "avgPrice", label: "Giá trung bình", format: (value) => formatCurrency(value, { compact: true }) },
      { key: "products", label: "Sản phẩm", format: (value) => formatNumber(value) },
      { key: "shops", label: "Shop", format: (value) => formatNumber(value) },
      { key: "videos", label: "Video", format: (value) => formatNumber(value) },
    ]);

    function arrowIcon(direction) {
      if (direction === "up") return "▲";
      if (direction === "down") return "▼";
      return direction === "flat" ? "→" : "—";
    }

    function arrowClass(direction) {
      return direction === "up" ? "trend-arrow is-up" : direction === "down" ? "trend-arrow is-down" : "trend-arrow is-flat";
    }

    function directionLabel(direction) {
      if (direction === "up") return "Đang lên";
      if (direction === "down") return "Đang tụt";
      return direction === "flat" ? "Đi ngang" : "Chưa đủ lịch sử";
    }

    function formatSigned(value) {
      if (value === null || value === undefined) return "—";
      const amount = Number(value);
      if (!Number.isFinite(amount)) return "—";
      const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
      return `${sign}${formatCompact(Math.abs(amount))}`;
    }

    function resetTotals() {
      Object.assign(totals, EMPTY_TOTALS());
    }

    async function loadComparison() {
      loading.value = true;
      error.value = "";
      try {
        const body = await apiGet("/api/trend-analysis/comparison", {
          anchor: "latest",
          days: days.value,
          periods: periods.value,
        });
        rows.value = body.data?.rows ?? [];
        periodsMeta.value = body.data?.periods ?? [];
        Object.assign(totals, body.data?.totals ?? EMPTY_TOTALS());
      } catch (err) {
        error.value = err.message ?? String(err);
        rows.value = [];
        periodsMeta.value = [];
        resetTotals();
      } finally {
        loading.value = false;
      }
    }

    async function loadDetail(category) {
      if (!category) {
        detail.value = null;
        return;
      }

      try {
        const body = await apiGet(`/api/trend-analysis/category/${encodeURIComponent(category)}`, {
          anchor: "latest",
          days: days.value,
          periods: periods.value,
        });
        detail.value = body.data ?? null;
        await nextTickRender();
      } catch (err) {
        error.value = err.message ?? String(err);
        detail.value = null;
      }
    }

    function nextTickRender() {
      return new Promise((resolve) => {
        setTimeout(() => {
          renderTimeline();
          resolve();
        }, 0);
      });
    }

    function renderTimeline() {
      if (typeof Chart === "undefined" || !timelineCanvas.value || !detail.value) return;
      destroyChart(timelineChart);

      const points = detail.value.timeline ?? [];
      timelineChart = new Chart(timelineCanvas.value, {
        type: "line",
        data: {
          labels: points.map((point) => point.date.slice(5)),
          datasets: [
            lineDataset("Lượt xem tích luỹ của mẫu bài đăng", points.map((point) => point.views), CHART_COLORS.accent, { fill: true }),
          ],
        },
        options: {
          ...BASE_OPTIONS,
          interaction: { mode: "index", intersect: false },
          plugins: {
            ...BASE_OPTIONS.plugins,
            legend: { display: false },
            tooltip: {
              ...BASE_OPTIONS.plugins.tooltip,
              callbacks: {
                  label: (context) => ` Lượt xem tích luỹ: ${formatNumber(context.parsed.y)}`,
              },
            },
          },
        },
      });
    }

    async function openCategory(category) {
      if (selectedCategory.value === category) return;
      await loadDetail(category);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    async function reload() {
      await loadComparison();
      await loadDetail(selectedCategory.value);
    }

    async function setDays(value) {
      days.value = value;
      await reload();
    }

    async function setPeriods(value) {
      periods.value = value;
      await reload();
    }

    onMounted(async () => {
      await loadComparison();
      const first = rows.value[0]?.category;
      if (first) await loadDetail(first);
    });

    onBeforeUnmount(() => destroyChart(timelineChart));

    return {
      rows,
      detail,
      totals,
      periodsMeta,
      days,
      periods,
      loading,
      error,
      rangeOptions,
      periodOptions,
      selectedCategory,
      upCount,
      downCount,
      flatCount,
      detailCards,
      timelineCanvas,
      arrowIcon,
      arrowClass,
      directionLabel,
      formatSigned,
      openCategory,
      reload,
      setDays,
      setPeriods,
      formatNumber,
      formatCompact,
      formatCurrency,
      formatPercent,
    };
  },
}).mount("#app");

const root = document.getElementById("app");
if (root) injectShell(root);
