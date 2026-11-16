import { api } from "../api.js";
import { formatCurrency, formatNumber, primaryMetric } from "../format.js";
import { GrowthBadge, ProductImage, SectionCard, StateBlock, DataKindBadge } from "../components.js";

/**
 * Trang danh sách sản phẩm có bộ lọc động.
 * Dùng cho drill-down: click danh mục hoặc shop ở nơi khác sẽ mở trang này
 * với `category` hoặc `shopId` tương ứng để lọc ra toàn bộ sản phẩm cùng loại.
 */
export const ProductsPage = {
  name: "ProductsPage",
  components: { GrowthBadge, ProductImage, SectionCard, StateBlock, DataKindBadge },
  props: {
    range: { type: String, required: true },
    category: { type: String, default: "" },
    shopId: { type: [Number, String], default: null },
    search: { type: String, default: "" },
  },
  emits: ["open-product", "clear-filter", "update:range"],
  data() {
    return {
      loading: true,
      error: "",
      items: [],
      total: 0,
      page: 1,
      pageSize: 24,
      sortBy: "gmv",
      searchInput: this.search,
    };
  },
  computed: {
    totalPages() {
      return Math.max(1, Math.ceil(this.total / this.pageSize));
    },
    displayTitle() {
      if (this.category) return `Ngành hàng: ${this.category}`;
      if (this.shopId) return `Sản phẩm của shop #${this.shopId}`;
      if (this.search) return `Kết quả cho "${this.search}"`;
      return "Tất cả sản phẩm TikTok Shop";
    },
    activeFilter() {
      if (this.category) return { kind: "category", label: "Ngành hàng", value: this.category };
      if (this.shopId) return { kind: "shop", label: "Cửa hàng", value: `#${this.shopId}` };
      if (this.search) return { kind: "search", label: "Từ khoá", value: this.search };
      return null;
    },
  },
  watch: {
    search(value) { this.searchInput = value; this.reload(); },
    range: "reload",
    category: "reload",
    shopId: "reload",
    sortBy: "reload",
    page: "load",
  },
  async mounted() {
    await this.load();
  },
  methods: {
    formatCurrency,
    formatNumber,
    primaryMetric,
    async reload() {
      this.page = 1;
      await this.load();
    },
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const body = await api.products({
          range: this.range,
          category: this.category || undefined,
          shopId: this.shopId || undefined,
          search: this.search || undefined,
          sortBy: this.sortBy,
          page: this.page,
          pageSize: this.pageSize,
        });
        this.items = body.data ?? [];
        this.total = body.pagination?.total ?? this.items.length;
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    },
    applySearch() {
      this.$emit("clear-filter", { search: this.searchInput.trim() });
    },
    goToPage(page) {
      if (page < 1 || page > this.totalPages) return;
      this.page = page;
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  },
  template: `
    <div>
      <div class="page-head">
        <div>
          <p class="page-eyebrow">Danh sách sản phẩm</p>
          <h1 class="page-title">{{ displayTitle }}</h1>
          <p class="page-desc">
            {{ formatNumber(total) }} sản phẩm TikTok Shop (đa thị trường)
            <template v-if="activeFilter"> · Đang lọc theo {{ activeFilter.label.toLowerCase() }} <strong>{{ activeFilter.value }}</strong></template>
            · GMV là ước tính soldCount × giá quan sát mới nhất, không phải GMV đã xác minh.
          </p>
          <div v-if="activeFilter" class="chip-row" style="margin-top:10px">
            <button class="chip is-active" @click="$emit('clear-filter', { all: true })">
              {{ activeFilter.label }}: {{ activeFilter.value }}
            </button>
          </div>
        </div>
        <div class="page-actions">
          <input
            v-model="searchInput"
            class="search-input"
            style="width:220px"
            placeholder="Tìm sản phẩm..."
            @keyup.enter="applySearch"
          />
          <div class="segmented">
            <button :class="{ 'is-active': sortBy === 'gmv' }" @click="sortBy = 'gmv'">GMV</button>
            <button :class="{ 'is-active': sortBy === 'sales' }" @click="sortBy = 'sales'">Số bán</button>
            <button :class="{ 'is-active': sortBy === 'price' }" @click="sortBy = 'price'">Giá</button>
          </div>
          <time-filter :model-value="range" :ranges="$root.timeRanges" @update:model-value="$emit('update:range', $event)" />
        </div>
      </div>

      <state-block :loading="loading" :error="error" :empty="items.length === 0" empty-text="Không có sản phẩm phù hợp bộ lọc.">
        <section-card :title="displayTitle" :subtitle="'Trang ' + page + ' / ' + totalPages">
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr><th>#</th><th>Sản phẩm</th><th>Danh mục</th><th>Giá</th><th>Đã bán</th><th>GMV</th><th>Tăng trưởng</th></tr>
              </thead>
              <tbody>
                <tr v-for="(product, index) in items" :key="product.id" style="cursor:pointer" @click="$emit('open-product', product.id)">
                  <td><span class="rank" :class="{ top: (page - 1) * pageSize + index < 3 }">{{ (page - 1) * pageSize + index + 1 }}</span></td>
                  <td>
                    <div class="entity">
                      <product-image :src="product.imageUrl" :name="product.title" :alt="product.title" class-name="thumb" />
                      <div style="min-width:0">
                        <div class="entity-title">{{ product.title }}</div>
                        <div class="entity-sub">{{ product.shopName }}</div>
                      </div>
                    </div>
                  </td>
                  <td class="cell-muted">{{ product.category || "—" }}</td>
                  <td>{{ formatCurrency(product.price, true) }}</td>
                  <td>{{ formatNumber(product.soldCount, true) }}</td>
                  <td class="cell-strong">{{ formatCurrency(product.gmv, true, product.currency) }} <data-kind-badge :kind="product.analytics?.gmv?.dataKind ?? 'UNKNOWN'" /></td>
                  <td><growth-badge :metric="primaryMetric(product.growth)" /></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px">
            <button class="btn btn-sm" :disabled="page <= 1" @click="goToPage(page - 1)">← Trước</button>
            <span class="cell-muted">{{ page }} / {{ totalPages }}</span>
            <button class="btn btn-sm" :disabled="page >= totalPages" @click="goToPage(page + 1)">Sau →</button>
          </div>
        </section-card>
      </state-block>
    </div>
  `,
};
