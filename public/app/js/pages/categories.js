import { api } from "../api.js";
import { formatCurrency, formatNumber, formatPercent, primaryMetric, dayLabel } from "../format.js";
import { GrowthBadge, StatCard, SectionCard, ProductImage, StateBlock, DataKindBadge } from "../components.js";
import { CHART_COLORS, baseOptions, lineDataset, barDataset, destroyChart } from "../charts.js";

export const CategoriesPage = {
  name: "CategoriesPage",
  components: { GrowthBadge, StatCard, SectionCard, ProductImage, StateBlock, DataKindBadge },
  props: {
    range: { type: String, required: true },
  },
  emits: ["open-product", "update:range"],
  data() {
    return {
      loading: true,
      error: "",
      overview: null,
      categories: [],
      selected: null,
      detail: null,
      detailLoading: false,
      detailError: "",
      categoryChart: null,
      trendChart: null,
      tab: "overview",
    };
  },
  computed: {
    primaryGmv() {
      return primaryMetric(this.overview?.growth);
    },
    gmvKind() {
      return this.overview?.overview?.analytics?.gmv?.dataKind ?? "UNKNOWN";
    },
    timelineKind() {
      return this.detail?.analytics?.timeline?.dataKind ?? "UNKNOWN";
    },
    timelineState() {
      return this.detail?.analytics?.timeline?.state ?? "NO_TIMESTAMP";
    },
  },
  watch: {
    range: "loadAll",
  },
  async mounted() {
    await this.loadAll();
  },
  beforeUnmount() {
    destroyChart(this.categoryChart);
    destroyChart(this.trendChart);
  },
  methods: {
    formatCurrency,
    formatNumber,
    formatPercent,
    primaryMetric,
    dayLabel,
    async loadAll() {
      this.loading = true;
      this.error = "";
      try {
        const body = await api.categories(this.range);
        this.overview = body.data;
        this.categories = body.data.categories ?? [];
        if (this.categories.length > 0) {
          const stillExists = this.selected && this.categories.some((item) => item.name === this.selected);
          await this.selectCategory(stillExists ? this.selected : this.categories[0].name);
        }
        await this.$nextTick();
        this.renderCategoryChart();
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
        await this.$nextTick();
        this.renderCategoryChart();
        this.renderTrendChart();
      }
    },
    async selectCategory(name) {
      this.selected = name;
      this.detailLoading = true;
      this.detailError = "";
      try {
        const body = await api.category(name, this.range);
        this.detail = body.data;
        await this.$nextTick();
        this.renderTrendChart();
      } catch (error) {
        this.detailError = error.message;
      } finally {
        this.detailLoading = false;
        await this.$nextTick();
        this.renderTrendChart();
      }
    },
    renderCategoryChart() {
      const canvas = this.$refs.categoryChart;
      if (!canvas || !window.Chart || this.categories.length === 0) return;
      destroyChart(this.categoryChart);
      const top = [...this.categories].filter(item => item.totalGmv !== null).sort((a,b) => b.totalGmv-a.totalGmv).slice(0, 8);
      this.categoryChart = new window.Chart(canvas, {
        type: "bar",
        data: {
          labels: top.map((item) => item.name),
          datasets: [barDataset("GMV", top.map((item) => item.totalGmv), [CHART_COLORS.brand, CHART_COLORS.cyan, CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.pink])],
        },
        options: baseOptions({
          indexAxis: "y",
          plugins: {
            ...baseOptions().plugins,
            tooltip: {
              ...baseOptions().plugins.tooltip,
              callbacks: { label: (context) => ` ${formatCurrency(context.raw)}` },
            },
          },
          scales: {
            x: { ...baseOptions().scales.x, ticks: { ...baseOptions().scales.x.ticks, callback: (value) => formatNumber(value, true) } },
            y: { ...baseOptions().scales.y, grid: { display: false } },
          },
        }),
      });
    },
    renderTrendChart() {
      const canvas = this.$refs.trendChart;
      if (!canvas || !window.Chart || !this.detail) return;
      destroyChart(this.trendChart);
      const points = this.detail.timeline ?? [];
      this.trendChart = new window.Chart(canvas, {
        type: "line",
        data: {
          labels: points.map((point) => dayLabel(point.date)),
          datasets: [lineDataset(this.timelineKind === "SIMULATED" ? "GMV mô phỏng" : "GMV", points.map((point) => point.value), CHART_COLORS.brand)],
        },
        options: baseOptions({
          plugins: {
            ...baseOptions().plugins,
            tooltip: {
              ...baseOptions().plugins.tooltip,
              callbacks: { label: (context) => ` ${formatCurrency(context.raw)}` },
            },
          },
        }),
      });
    },
  },
  template: `
    <div>
      <div class="page-head">
        <div>
          <p class="page-eyebrow">Phân tích ngành hàng</p>
          <h1 class="page-title">Ngành hàng TikTok Shop</h1>
          <p class="page-desc">Tổng quan toàn bộ ngành hàng và bảng chi tiết doanh thu, tăng trưởng, top sản phẩm bán chạy.</p>
        </div>
        <div class="page-actions">
          <time-filter :model-value="range" :ranges="$root.timeRanges" @update:model-value="$emit('update:range', $event)" />
        </div>
      </div>

      <state-block :loading="loading" :error="error">
        <div class="tabs" style="margin-top:18px">
          <button class="tab" :class="{ 'is-active': tab === 'overview' }" @click="tab = 'overview'">Tổng quan</button>
          <button class="tab" :class="{ 'is-active': tab === 'detail' }" @click="tab = 'detail'">Danh sách & chi tiết</button>
        </div>
        <div v-show="tab === 'overview'">
          <div class="stat-grid">
            <stat-card label="Tổng GMV ước tính" :value="formatCurrency(overview.overview.totalGmv, true)" :metric="primaryGmv" :kind="gmvKind" hint="soldCount × giá quan sát mới nhất" icon="₫" />
            <stat-card label="Ngành hàng" :value="formatNumber(overview.overview.categoryCount)" icon="◫" />
            <stat-card label="Sản phẩm" :value="formatNumber(overview.overview.totalProducts)" icon="▦" />
            <stat-card label="Cửa hàng" :value="formatNumber(overview.overview.totalShops)" icon="⌂" />
          </div>

          <div class="grid-2">
              <section-card title="GMV ước tính theo ngành hàng" subtitle="Từ soldCount × giá quan sát mới nhất" kind="ESTIMATED">
              <div class="chart-box h-300"><canvas ref="categoryChart"></canvas></div>
            </section-card>

            <section-card title="Bảng tổng hợp" subtitle="Click để xem chi tiết ngành hàng">
              <div class="table-wrap table-scroll">
                <table class="data">
                  <thead><tr><th>Ngành hàng</th><th>GMV ước tính</th><th>Tỷ trọng</th><th>Tăng trưởng</th></tr></thead>
                  <tbody>
                    <tr v-for="category in categories" :key="category.name" style="cursor:pointer" @click="selectCategory(category.name); tab = 'detail'">
                      <td>
                        <div class="cell-strong">{{ category.name }}</div>
                        <div class="cell-muted">{{ category.productCount }} sản phẩm · {{ category.shopCount }} shop</div>
                      </td>
                      <td class="cell-strong">{{ formatCurrency(category.totalGmv, true) }}</td>
                      <td>{{ formatPercent(category.shareOfGmv) }}</td>
                      <td><growth-badge :metric="primaryMetric(category.growth)" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section-card>
          </div>
        </div>

        <div v-show="tab === 'detail'">
          <div class="chip-row" style="margin-bottom:14px">
            <button
              v-for="category in categories"
              :key="category.name"
              class="chip"
              :class="{ 'is-active': selected === category.name }"
              @click="selectCategory(category.name)"
            >{{ category.name }}</button>
          </div>

          <state-block :loading="detailLoading" :error="detailError">
            <div v-if="detail">
              <div class="stat-grid">
                <stat-card label="GMV ngành ước tính" :value="formatCurrency(detail.totalGmv, true)" :metric="primaryMetric(detail.growth)" :kind="detail.analytics?.gmv?.dataKind ?? 'UNKNOWN'" />
                <stat-card label="Số bán" :value="formatNumber(detail.totalSales, true)" />
                <stat-card label="Giá TB" :value="formatCurrency(detail.avgPrice)" />
                <stat-card label="Sản phẩm / Shop" :value="formatNumber(detail.productCount) + ' / ' + formatNumber(detail.shopCount)" />
              </div>

              <div class="grid-2 section-gap">
                   <section-card title="GMV theo ngày" subtitle="Chưa có timestamp thương mại để xác định lịch sử theo ngày" :kind="timelineKind" :state="timelineState">
                  <div v-if="!(detail.timeline || []).length" class="empty">Chưa có chuỗi GMV theo ngày.</div>
                  <div v-else class="chart-box h-260"><canvas ref="trendChart"></canvas></div>
                </section-card>

                <section-card title="Ngành con" subtitle="Doanh thu và tăng trưởng từng ngành con">
                  <div class="table-wrap table-scroll">
                    <table class="data">
                      <thead><tr><th>Ngành con</th><th>GMV</th><th>Tỷ trọng</th><th>Tăng trưởng</th></tr></thead>
                      <tbody>
                        <tr v-for="sub in detail.subCategories" :key="sub.name">
                          <td class="cell-strong">{{ sub.name }}</td>
                          <td>{{ formatCurrency(sub.totalGmv, true) }}</td>
                          <td>{{ formatPercent(sub.shareOfGmv) }}</td>
                          <td><growth-badge :metric="primaryMetric(sub.growth)" /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section-card>
              </div>

              <section-card class="section-gap" title="Top 10 sản phẩm bán chạy" subtitle="Trong ngành hàng đang chọn">
                <div v-if="detail.topProducts.length === 0" class="empty">Chưa có sản phẩm</div>
                <div v-else class="table-wrap">
                  <table class="data">
                    <thead><tr><th>#</th><th>Sản phẩm</th><th>Giá</th><th>Đã bán</th><th>GMV</th><th>Tăng trưởng</th></tr></thead>
                    <tbody>
                      <tr v-for="(product, index) in detail.topProducts" :key="product.id" style="cursor:pointer" @click="$emit('open-product', product.id)">
                        <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                        <td>
                          <div class="entity">
                            <product-image :src="product.imageUrl" :name="product.title" :alt="product.title" class-name="thumb" />
                            <div style="min-width:0">
                              <div class="entity-title">{{ product.title }}</div>
                              <div class="entity-sub">{{ product.shopName }}</div>
                            </div>
                          </div>
                        </td>
                        <td>{{ formatCurrency(product.price, true) }}</td>
                        <td>{{ formatNumber(product.soldCount, true) }}</td>
                        <td class="cell-strong">{{ formatCurrency(product.gmv, true) }}</td>
                        <td><growth-badge :metric="primaryMetric(product.growth)" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section-card>
            </div>
          </state-block>
        </div>
      </state-block>
    </div>
  `,
};
