import { TIME_RANGES, DEFAULT_RANGE } from "./format.js";
import { TimeFilter } from "./components.js";
import { HomePage } from "./pages/home.js";
import { ProductsPage } from "./pages/products.js";
import { CategoriesPage } from "./pages/categories.js";
import { ShopsPage } from "./pages/shops.js";
import { CreatorsPage } from "./pages/creators.js";
import { TrendsPage } from "./pages/trends.js";
import { MarketGapPage } from "./pages/marketGap.js";
import { WinningPage } from "./pages/winning.js";
import { MarketOpportunitiesPage } from "./pages/marketOpportunities.js";
import { AiReportPage } from "./pages/aiReport.js";
import { ProductDrawer } from "./productDrawer.js?v=ai-product-analysis";
import { icon } from "../../js/icons.js";

const ROUTES = [
  { key: "home", path: "overview", label: "Tổng quan", icon: "dashboard" },
  { key: "products", path: "products", label: "Sản phẩm", icon: "box" },
  { key: "shops", path: "shops", label: "Cửa hàng", icon: "store" },
  { key: "categories", path: "markets", label: "Thị trường", icon: "tag" },
  { key: "trends", path: "trends", label: "Xu hướng", icon: "chartLine" },
  { key: "creators", path: "creators", label: "Creators", icon: "users" },
  { key: "market-gap", path: "market-gap", label: "Market Gap", icon: "target" },
  { key: "winning", path: "winning", label: "Winning Products", icon: "chartLine" },
  { key: "opportunities", path: "opportunities", label: "Cơ hội ngách", icon: "chartLine" },
];

const PAGE_COMPONENTS = {
  home: "HomePage",
  products: "ProductsPage",
  shops: "ShopsPage",
  categories: "CategoriesPage",
  trends: "TrendsPage",
  creators: "CreatorsPage",
  "market-gap": "MarketGapPage",
  "winning": "WinningPage",
  "opportunities": "MarketOpportunitiesPage",
  "ai-report": "AiReportPage",
  "not-found": "NotFoundPage",
};

function readQuery() {
  return new URLSearchParams(window.location.search);
}

function readRoute() {
  const segments = window.location.pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean);
  const segment = (segments[0] || "").toLowerCase();
  if (segment === "ai-reports" && /^[1-9]\d*$/.test(segments[1] || "")) return "ai-report";
  const pathRoute = ROUTES.find((route) => route.path === segment);
  if (pathRoute) return pathRoute.key;
  if (segment) return "not-found";
  const view = (readQuery().get("view") || "home").toLowerCase();
  return ROUTES.some((route) => route.key === view) ? view : "home";
}

function readReportId() {
  const segments = window.location.pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean);
  return segments[0] === "ai-reports" && /^[1-9]\d*$/.test(segments[1] || "") ? segments[1] : "";
}

const NotFoundPage = {
  name: "NotFoundPage",
  emits: ["go-home"],
  template: `<section class="not-found-state"><span class="not-found-code">404</span><h1>Không tìm thấy màn hình này</h1><p>Đường dẫn không thuộc TikTok Shop Intelligence hoặc đã được thay đổi.</p><button class="btn btn-primary" type="button" @click="$emit('go-home')">Về tổng quan</button></section>`,
};

function readRange() {
  const range = (readQuery().get("range") || "").toLowerCase();
  return TIME_RANGES.some((option) => option.key === range) ? range : DEFAULT_RANGE;
}

function readFilters() {
  const query = readQuery();
  const shopId = Number.parseInt(query.get("shopId") || "", 10);
  return {
    category: query.get("category") || "",
    shopId: Number.isFinite(shopId) && shopId > 0 ? shopId : null,
    search: query.get("search") || "",
  };
}

const App = {
  name: "App",
  components: {
    TimeFilter,
    HomePage,
    ProductsPage,
    CategoriesPage,
    ShopsPage,
    CreatorsPage,
    TrendsPage,
    ProductDrawer,
    MarketGapPage,
    WinningPage,
    MarketOpportunitiesPage,
    AiReportPage,
    NotFoundPage,
  },
  data() {
    const filters = readFilters();
    return {
      view: readRoute(),
      range: readRange(),
      timeRanges: TIME_RANGES,
      productId: null,
      reportId: readReportId(),
      selectedShop: Number(readQuery().get('shop')) || null,
      selectedCreator: Number(readQuery().get('creator')) || null,
      filterCategory: filters.category,
      filterShopId: filters.shopId,
      filterSearch: filters.search,
      commandOpen: false,
      commandQuery: "",
      moreOpen: false,
      refreshKey: 0,
    };
  },
  computed: {
    routes() {
      return ROUTES;
    },
    rangeLabel() {
      return TIME_RANGES.find((option) => option.key === this.range)?.label ?? "";
    },
    currentComponent() {
      return PAGE_COMPONENTS[this.view] ?? "HomePage";
    },
    currentLabel() {
      return ROUTES.find((route) => route.key === this.view)?.label ?? (this.view === "ai-report" ? "Báo cáo AI" : this.view === "not-found" ? "Không tìm thấy" : "Tổng quan");
    },
    commandResults() {
      const query = this.commandQuery.trim().toLowerCase();
      return this.routes.filter((route) => !query || route.label.toLowerCase().includes(query));
    },
  },
  mounted() {
    window.addEventListener("popstate", this.syncFromUrl);
    window.addEventListener("keydown", this.handleShortcut);
    this.syncFromUrl();
  },
  beforeUnmount() {
    window.removeEventListener("popstate", this.syncFromUrl);
    window.removeEventListener("keydown", this.handleShortcut);
  },
  methods: {
    icon,
    navigate(view, options = {}) {
      this.view = view;
      this.productId = null;
      // Vào tab Sản phẩm từ menu = xoá bộ lọc cũ.
      if (view === "products") {
        this.filterCategory = "";
        this.filterShopId = null;
        this.filterSearch = "";
      }
      this.writeUrl(options.replace === true);
    },
    setRange(range) {
      this.range = range;
      this.writeUrl();
    },
    writeUrl(replace = false) {
      const url = new URL(window.location.href);
      const route = ROUTES.find((item) => item.key === this.view);
      url.pathname = `/app/${route?.path ?? "overview"}`;
      url.searchParams.delete("view");
      url.searchParams.set("range", this.range);
      this.setOrDelete(url, "category", this.filterCategory);
      this.setOrDelete(url, "shopId", this.filterShopId ? String(this.filterShopId) : "");
      this.setOrDelete(url, "search", this.filterSearch);
      this.setOrDelete(url, 'shop', this.selectedShop);
      this.setOrDelete(url, 'creator', this.selectedCreator);
      window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    },
    setOrDelete(url, key, value) {
      if (value === undefined || value === null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    },
    syncFromUrl() {
      this.view = readRoute();
      this.range = readRange();
      const filters = readFilters();
      this.filterCategory = filters.category;
      this.filterShopId = filters.shopId;
      this.filterSearch = filters.search;
      this.selectedShop = Number(readQuery().get('shop')) || null;
      this.selectedCreator = Number(readQuery().get('creator')) || null;
      this.reportId = readReportId();
    },
    openProduct(id) {
      this.productId = Number(id) || null;
    },
    closeProduct() {
      this.productId = null;
    },
    openCategory(category) {
      if (!category) return;
      this.view = "products";
      this.filterCategory = category;
      this.filterShopId = null;
      this.filterSearch = "";
      this.productId = null;
      this.writeUrl();
    },
    openShopProducts(shopId, shopName) {
      const id = Number(shopId);
      if (!Number.isFinite(id) || id <= 0) return;
      this.view = "products";
      this.filterShopId = id;
      this.filterCategory = "";
      this.filterSearch = "";
      this.productId = null;
      if (shopName) this.filterSearch = "";
      this.writeUrl();
    },
    openShop(id) {
      this.selectedShop = Number(id) || null;
      const url = new URL(window.location.href);
      url.pathname = "/app/shops";
      url.searchParams.set("shop", String(id));
      url.searchParams.delete("category");
      url.searchParams.delete("shopId");
      url.searchParams.delete("search");
      window.history.pushState({}, "", url);
      this.view = "shops";
      this.filterCategory = "";
      this.filterShopId = null;
      this.filterSearch = "";
      this.productId = null;
    },
    openCreator(id) {
      this.selectedCreator = Number(id) || null;
      const url = new URL(window.location.href);
      url.pathname = "/app/creators";
      url.searchParams.set("creator", String(id));
      window.history.pushState({}, "", url);
      this.view = "creators";
      this.productId = null;
    },
    openAiReport(id) {
      const reportId = String(id || "");
      if (!/^[1-9]\d*$/.test(reportId)) return;
      this.productId = null;
      this.reportId = reportId;
      this.view = "ai-report";
      const url = new URL(window.location.href);
      url.pathname = `/app/ai-reports/${reportId}`;
      window.history.pushState({}, "", url);
    },
    clearFilter(payload) {
      if (payload && payload.all) {
        this.filterCategory = "";
        this.filterShopId = null;
        this.filterSearch = "";
      } else if (payload && typeof payload.search === "string") {
        this.filterSearch = payload.search;
      }
      this.writeUrl();
    },
    refresh() {
      this.refreshKey += 1;
    },
    openCommand() {
      this.commandOpen = true;
      this.commandQuery = "";
      this.$nextTick(() => this.$refs.commandInput?.focus());
    },
    selectCommand(route) {
      this.commandOpen = false;
      this.navigate(route.key);
    },
    searchProducts() {
      const search = this.commandQuery.trim();
      if (!search) return;
      this.commandOpen = false;
      this.view = "products";
      this.filterCategory = "";
      this.filterShopId = null;
      this.filterSearch = search;
      this.productId = null;
      this.writeUrl();
    },
    handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.openCommand();
      }
      if (event.key === "Escape") {
        this.commandOpen = false;
        this.moreOpen = false;
      }
    },
  },
  template: `
    <div class="app-layout">
      <header class="app-header">
        <div class="app-header-inner">
          <a class="app-brand" href="/app/overview" @click.prevent="navigate('home')" aria-label="TikTok Shop Intelligence, Tổng quan">
            <span class="brand-mark">TS</span><span class="brand-name">Shop Intelligence</span>
          </a>
          <nav class="top-navigation" aria-label="Điều hướng chính">
            <a v-for="route in routes" :key="route.key" :href="'/app/' + route.path" class="top-nav-item" :class="{ 'is-active': view === route.key }" @click.prevent="navigate(route.key)">
              <span aria-hidden="true" v-html="icon(route.icon)"></span><span>{{ route.label }}</span>
            </a>
          </nav>
          <div class="header-actions">
            <button class="header-search" type="button" aria-label="Tìm kiếm hoặc mở điều hướng" title="Tìm kiếm (Ctrl+K)" @click="openCommand"><span aria-hidden="true" v-html="icon('search')"></span><span>Tìm kiếm</span><kbd>Ctrl K</kbd></button>
            <button class="icon-btn" type="button" aria-label="Làm mới dữ liệu màn hình" title="Làm mới" @click="refresh"><span aria-hidden="true" v-html="icon('refresh')"></span></button>
            <div class="header-menu-wrap">
              <button class="icon-btn" type="button" aria-label="Thêm công cụ" title="Thêm công cụ" @click="moreOpen = !moreOpen"><span aria-hidden="true" v-html="icon('more')"></span></button>
              <div v-if="moreOpen" class="header-popover" @mouseleave="moreOpen = false"><a href="/app/market-gap" @click.prevent="moreOpen = false; navigate('market-gap')"><span aria-hidden="true" v-html="icon('target')"></span>Market Gap Finder</a></div>
            </div>
            <span class="live-pill"><span class="live-dot"></span>VN · {{ rangeLabel }}</span>
          </div>
        </div>
      </header>

      <main class="shell" :key="refreshKey">
        <div class="workspace-bar"><span>Workspace</span><span aria-hidden="true">/</span><strong>{{ currentLabel }}</strong></div>
          <component
            :is="currentComponent"
            :range="range"
            :category="filterCategory"
            :shop-id="filterShopId"
            :search="filterSearch"
            :selected-shop="selectedShop"
            :selected-creator="selectedCreator"
            :report-id="reportId"
            @update:range="setRange"
            @open-product="openProduct"
            @open-shop="openShop"
            @open-shop-products="openShopProducts"
            @open-category="openCategory"
            @open-creator="openCreator"
            @clear-filter="clearFilter"
            @go-home="navigate('home')"
            @go-products="navigate('products')"
          />
      </main>

      <product-drawer
        :product-id="productId"
        :range="range"
        @close="closeProduct"
        @open-category="openCategory"
        @open-shop-products="openShopProducts"
        @open-creator="openCreator"
        @open-ai-report="openAiReport"
      />

      <teleport to="body">
        <div v-if="commandOpen" class="command-backdrop" @click.self="commandOpen = false">
          <section class="command-menu" role="dialog" aria-modal="true" aria-label="Tìm kiếm và điều hướng">
            <div class="command-input-wrap"><span aria-hidden="true" v-html="icon('search')"></span><input ref="commandInput" v-model="commandQuery" type="search" placeholder="Tìm màn hình hoặc sản phẩm..." @keyup.enter="searchProducts" /><button class="icon-btn" type="button" aria-label="Đóng tìm kiếm" title="Đóng" @click="commandOpen = false"><span aria-hidden="true" v-html="icon('close')"></span></button></div>
            <div class="command-section-label">Điều hướng</div>
            <button v-for="route in commandResults" :key="route.key" type="button" class="command-item" @click="selectCommand(route)"><span aria-hidden="true" v-html="icon(route.icon)"></span><span>{{ route.label }}</span></button>
            <button v-if="commandQuery.trim()" type="button" class="command-item command-search-result" @click="searchProducts"><span aria-hidden="true" v-html="icon('search')"></span><span>Tìm sản phẩm: “{{ commandQuery.trim() }}”</span></button>
          </section>
        </div>
      </teleport>
    </div>
  `,
};

Vue.createApp(App).component("time-filter", TimeFilter).mount("#app");
