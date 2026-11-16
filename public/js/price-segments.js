import {
  apiGet,
  barDataset,
  BASE_OPTIONS,
  CHART_COLORS,
  destroyChart,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  hexToRgba,
} from "./shared.js";
import { injectShell } from "./shell.js";

const { createApp, computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } = Vue;

const SEGMENT_LABELS = {
  "under-100k": "Dưới 100k",
  "100k-300k": "100k – 300k",
  "300k-500k": "300k – 500k",
  "over-500k": "Trên 500k",
};

const SEGMENT_COLORS = [
  CHART_COLORS.cyan,
  CHART_COLORS.emerald,
  CHART_COLORS.amber,
  CHART_COLORS.accent,
];

createApp({
  setup() {
    const overview = reactive({
      totalProducts: 0,
      multiVariantProducts: 0,
      totalGmv: null,
      totalSales: null,
      totalViews: null,
      segments: [],
      categoryBreakdown: [],
    });

    const products = ref([]);
    const totalProducts = ref(0);
    const page = ref(1);
    const pageSize = 15;

    const selectedSegments = ref([]);
    const selectedCategory = ref("");
    const searchQuery = ref("");
    const customMinPrice = ref(null);
    const customMaxPrice = ref(null);
    const onlyMultiVariant = ref(false);
    const sortBy = ref("gmv");

    const loading = ref(false);
    const error = ref("");
    const activeProduct = ref(null);

    const gmvCanvas = ref(null);
    const countCanvas = ref(null);
    let gmvChart = null;
    let countChart = null;

    const totalPages = computed(() =>
      Math.max(1, Math.ceil(totalProducts.value / pageSize)),
    );

    const maxCatalogPrice = computed(() => {
      const prices = products.value.map((item) => item.maxPrice || item.price || 0);
      return Math.max(1_000_000, ...prices);
    });

    function segmentShortLabel(code) {
      return SEGMENT_LABELS[code] ?? code;
    }

    function isSegmentSelected(code) {
      return selectedSegments.value.includes(code);
    }

    function toggleSegment(code) {
      const idx = selectedSegments.value.indexOf(code);
      if (idx >= 0) {
        selectedSegments.value.splice(idx, 1);
      } else {
        selectedSegments.value.push(code);
      }
      page.value = 1;
      loadProducts();
    }

    function priceBarStyle(item) {
      const cap = maxCatalogPrice.value;
      const low = Math.min(100, Math.max(0, ((item.minPrice || 0) / cap) * 100));
      const high = Math.min(100, Math.max(low + 6, ((item.maxPrice || item.price || 0) / cap) * 100));
      return {
        left: `${low.toFixed(1)}%`,
        width: `${Math.max(6, high - low).toFixed(1)}%`,
      };
    }

    async function loadOverview() {
      try {
        const body = await apiGet("/api/price-segments/overview", filterParams());
        Object.assign(overview, body.data);
        await nextTick();
        renderCharts();
      } catch (err) {
        error.value = err.message ?? String(err);
      }
    }

    function filterParams() {
      return {category:selectedCategory.value || undefined,search:searchQuery.value || undefined,segments:selectedSegments.value.join(',') || undefined,minPrice:customMinPrice.value ?? undefined,maxPrice:customMaxPrice.value ?? undefined,onlyMultiVariant:onlyMultiVariant.value ? 'true' : undefined};
    }

    async function loadProducts() {
      loading.value = true;
      error.value = "";
      try {
        const sortDir = sortBy.value === "minPrice" ? "asc" : "desc";
        const body = await apiGet("/api/price-segments/products", {
          segments:
            selectedSegments.value.length > 0
              ? selectedSegments.value.join(",")
              : undefined,
          category: selectedCategory.value || undefined,
          search: searchQuery.value || undefined,
          minPrice:
            Number.isFinite(customMinPrice.value) && customMinPrice.value > 0
              ? customMinPrice.value
              : undefined,
          maxPrice:
            Number.isFinite(customMaxPrice.value) && customMaxPrice.value > 0
              ? customMaxPrice.value
              : undefined,
          onlyMultiVariant: onlyMultiVariant.value ? "true" : undefined,
          sortBy: sortBy.value,
          sortDir,
          page: page.value,
          pageSize,
        });

        products.value = body.data ?? [];
        totalProducts.value = body.pagination?.total ?? products.value.length;
      } catch (err) {
        error.value = err.message ?? String(err);
        products.value = [];
        totalProducts.value = 0;
      } finally {
        loading.value = false;
      }
    }

    function renderCharts() {
      if (typeof Chart === "undefined") return;
      destroyChart(gmvChart);
      destroyChart(countChart);

      const segs = overview.segments ?? [];
      if (segs.length === 0) return;

      if (gmvCanvas.value) {
        gmvChart = new Chart(gmvCanvas.value, {
          type: "doughnut",
          data: {
            labels: segs.map((s) => s.shortLabel),
            datasets: [
              {
                data: segs.map((s) => s.totalGmv),
                backgroundColor: segs.map((_, i) =>
                  hexToRgba(SEGMENT_COLORS[i % SEGMENT_COLORS.length], 0.82),
                ),
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
              const target = elements[0] && segs[elements[0].index];
              if (target) toggleSegment(target.code);
            },
            plugins: {
              legend: {
                position: "right",
                labels: { ...BASE_OPTIONS.plugins.legend.labels },
              },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (context) =>
                    ` ${context.label}: ${formatCurrency(context.parsed, { compact: true })} (${formatPercent(segs[context.dataIndex]?.shareOfGmv)})`,
                },
              },
            },
          },
        });
      }

      if (countCanvas.value) {
        countChart = new Chart(countCanvas.value, {
          type: "bar",
          data: {
            labels: segs.map((s) => s.shortLabel),
            datasets: [
              barDataset(
                "Số sản phẩm",
                segs.map((s) => s.productCount),
                SEGMENT_COLORS,
              ),
            ],
          },
          options: {
            ...BASE_OPTIONS,
            onClick: (_event, elements) => {
              const target = elements[0] && segs[elements[0].index];
              if (target) toggleSegment(target.code);
            },
            plugins: {
              ...BASE_OPTIONS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTIONS.plugins.tooltip,
                callbacks: {
                  label: (context) =>
                    ` ${formatNumber(context.parsed.y)} sản phẩm (${formatPercent(segs[context.dataIndex]?.shareOfProducts ?? 0)})`,
                },
              },
            },
          },
        });
      }
    }

    async function applyFilters() {
      page.value = 1;
      await Promise.all([loadOverview(), loadProducts()]);
    }

    async function onCategoryChange() {
      page.value = 1;
      await Promise.all([loadOverview(), loadProducts()]);
    }

    async function resetFilters() {
      selectedSegments.value = [];
      selectedCategory.value = "";
      searchQuery.value = "";
      customMinPrice.value = null;
      customMaxPrice.value = null;
      onlyMultiVariant.value = false;
      sortBy.value = "gmv";
      page.value = 1;
      await Promise.all([loadOverview(), loadProducts()]);
    }

    function changePage(next) {
      page.value = Math.min(Math.max(1, next), totalPages.value);
      Promise.all([loadOverview(), loadProducts()]);
    }

    async function openVariantModal(item) {
      try {
        const body = await apiGet(`/api/price-segments/products/${item.id}/variants`);
        activeProduct.value = body.data;
      } catch {
        activeProduct.value = item;
      }
    }

    function closeVariantModal() {
      activeProduct.value = null;
    }

    async function reloadAll() {
      await Promise.all([loadOverview(), loadProducts()]);
    }

    onMounted(reloadAll);
    onBeforeUnmount(() => {
      destroyChart(gmvChart);
      destroyChart(countChart);
    });

    return {
      overview,
      products,
      totalProducts,
      page,
      totalPages,
      selectedSegments,
      selectedCategory,
      searchQuery,
      customMinPrice,
      customMaxPrice,
      onlyMultiVariant,
      sortBy,
      loading,
      error,
      activeProduct,
      gmvCanvas,
      countCanvas,
      segmentShortLabel,
      isSegmentSelected,
      toggleSegment,
      priceBarStyle,
      applyFilters,
      onCategoryChange,
      resetFilters,
      changePage,
      openVariantModal,
      closeVariantModal,
      reloadAll,
      formatNumber,
      formatCompact,
      formatCurrency,
      formatPercent,
    };
  },
}).mount("#app");

const root = document.getElementById("app");
if (root) injectShell(root);
