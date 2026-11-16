import {
  apiGet,
  debounce,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelative,
  growthClass,
  growthIcon,
  initials,
  mountApp,
  knownSum,
  rangeKeyFromQuery,
  rangeParams,
  setRangeInUrl,
} from "./shared.js";

const { computed, onMounted, ref, watch } = Vue;

const RANGE_LABELS = { today: "Hôm nay", yesterday: "Hôm qua", "7d": "7 ngày qua", "30d": "30 ngày qua", "90d": "90 ngày qua" };

mountApp({
  setup() {
    const shops = ref([]);
    const total = ref(0);
    const page = ref(1);
    const pageSize = 10;
    const search = ref("");
    const sortBy = ref("gmv");
    const rangeKey = ref(rangeKeyFromQuery());
    const loading = ref(false);
    const error = ref("");

    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");
    const pageGmv = computed(() => knownSum(shops.value.map(shop => shop.totalGmv)));
    const pageProducts = computed(() => shops.value.reduce((sum, shop) => sum + shop.productCount, 0));
    const fastestCount = computed(() => shops.value.filter((shop) => shop.growthRate > 10).length);

    async function loadShops() {
      loading.value = true;
      error.value = "";
      try {
        const body = await apiGet("/api/shops", {
          page: page.value,
          pageSize,
          search: search.value || undefined,
          sortBy: sortBy.value,
          sortDir: "desc",
          ...rangeParams(rangeKey.value),
        });
        shops.value = body.data;
        total.value = body.pagination?.total ?? body.data.length;
      } catch (err) {
        error.value = err.message ?? String(err);
        shops.value = [];
        total.value = 0;
      } finally {
        loading.value = false;
      }
    }

    function changePage(next) {
      page.value = Math.min(Math.max(1, next), totalPages.value);
      loadShops();
    }

    function setRange(nextKey) {
      rangeKey.value = nextKey;
      setRangeInUrl(nextKey);
      page.value = 1;
      loadShops();
    }

    const debounced = debounce(() => {
      page.value = 1;
      loadShops();
    }, 350);

    watch(search, debounced);
    watch(sortBy, () => {
      page.value = 1;
      loadShops();
    });

    onMounted(loadShops);

    return {
      shops,
      total,
      page,
      pageSize,
      search,
      sortBy,
      rangeKey,
      rangeLabel,
      loading,
      error,
      totalPages,
      pageGmv,
      pageProducts,
      fastestCount,
      loadShops,
      changePage,
      setRange,
      formatCurrency,
      formatNumber,
      formatCompact,
      formatPercent,
      formatRelative,
      growthClass,
      growthIcon,
      initials,
    };
  },
});
