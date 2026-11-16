import {
  apiGet,
  debounce,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
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
    const creators = ref([]);
    const total = ref(0);
    const page = ref(1);
    const pageSize = 12;
    const search = ref("");
    const role = ref("");
    const sortBy = ref("gmv");
    const rangeKey = ref(rangeKeyFromQuery());
    const loading = ref(false);
    const error = ref("");

    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
    const rangeLabel = computed(() => RANGE_LABELS[rangeKey.value] ?? "30 ngày qua");
    const top10 = computed(() => creators.value.slice(0, 10));
    const top10Gmv = computed(() => knownSum(top10.value.map(creator => creator.gmv)));
    const top10Followers = computed(() => knownSum(top10.value.map(creator => creator.followerCount)));
    const avgEngagement = computed(() => {
      const valid = top10.value.map(creator => creator.engagementRate).filter(value => typeof value === 'number' && Number.isFinite(value));
      return valid.length ? knownSum(valid) / valid.length : null;
    });

    async function load() {
      loading.value = true;
      error.value = "";
      try {
        const body = await apiGet("/api/creators", {
          page: page.value,
          pageSize,
          search: search.value || undefined,
          role: role.value || undefined,
          sortBy: sortBy.value,
          sortDir: "desc",
          ...rangeParams(rangeKey.value),
        });
        creators.value = body.data;
        total.value = body.pagination?.total ?? body.data.length;
      } catch (err) {
        error.value = err.message ?? String(err);
        creators.value = [];
        total.value = 0;
      } finally {
        loading.value = false;
      }
    }

    function changePage(next) {
      page.value = Math.min(Math.max(1, next), totalPages.value);
      load();
    }

    function setRange(nextKey) {
      rangeKey.value = nextKey;
      setRangeInUrl(nextKey);
      page.value = 1;
      load();
    }

    const debounced = debounce(() => {
      page.value = 1;
      load();
    }, 350);

    watch(search, debounced);
    watch([role, sortBy], () => {
      page.value = 1;
      load();
    });

    onMounted(load);

    return {
      creators,
      total,
      page,
      pageSize,
      search,
      role,
      sortBy,
      rangeKey,
      rangeLabel,
      loading,
      error,
      totalPages,
      top10Gmv,
      top10Followers,
      avgEngagement,
      load,
      changePage,
      setRange,
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
