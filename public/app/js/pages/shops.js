import { api } from "../api.js";
import { safeFixed } from "../formatters.js";
import { formatCurrency, formatNumber, formatPercent, primaryMetric, dayLabel } from "../format.js";
import { GrowthBadge, StatCard, SectionCard, Avatar, ProductImage, ShopBanner, StateBlock, DataKindBadge } from "../components.js";
import { CHART_COLORS, baseOptions, lineDataset, destroyChart } from "../charts.js";

export const ShopsPage = {
  name: "ShopsPage",
  components: { GrowthBadge, StatCard, SectionCard, Avatar, ProductImage, ShopBanner, StateBlock, DataKindBadge },
  props: { range: { type: String, required: true }, selectedShop: {type: Number, default: null} },
  emits: ["open-shop", "open-product", "open-creator", "update:range"],
  data() {
    return {
      loading: true,
      error: "",
      shops: [],
      selected: null,
      detail: null,
      detailLoading: false,
      detailError: "",
      tab: "revenue",
      chart: null,
    };
  },
  watch: { range: "load", selectedShop(id) { if(id) this.selectShop(id); } },
  async mounted() {
    await this.load();
  },
  beforeUnmount() {
    destroyChart(this.chart);
  },
  computed: {
    channels() {
      const sources = this.detail?.revenueSources?.summary ?? this.detail?.revenueSources ?? {};
      return [
        { label: "Video", value: sources.video ?? null, share: sources.videoShare ?? null, color: CHART_COLORS.brand },
        { label: "Live", value: sources.live ?? null, share: sources.liveShare ?? null, color: CHART_COLORS.pink },
        { label: "Giỏ hàng", value: sources.cart ?? null, share: sources.cartShare ?? null, color: CHART_COLORS.cyan },
        { label: "Product card", value: sources.productCard ?? null, share: sources.productCardShare ?? null, color: CHART_COLORS.amber },
      ];
    },
    gmvKind() {
      return this.detail?.analytics?.gmv?.dataKind ?? "UNKNOWN";
    },
    timelineKind() {
      return this.detail?.analytics?.timeline?.dataKind ?? "UNKNOWN";
    },
    timelineState() {
      return this.detail?.analytics?.timeline?.state ?? "NO_TIMESTAMP";
    },
    revenueKind() {
      return this.detail?.revenueSources?.analytics?.dataKind ?? "UNKNOWN";
    },
    gmvTimeline() {
      return this.detail?.gmvTimeline ?? [];
    },
  },
  methods: {
    formatCurrency,
    formatNumber,
    formatPercent,
    primaryMetric,
    dayLabel,
    safeFixed,
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const body = await api.shops({ range: this.range, pageSize: 10, sortBy: "gmv" });
        this.shops = body.data ?? [];
        if (this.shops.length > 0) {
          const exists = this.selected && this.shops.some((shop) => shop.id === this.selected);
          await this.selectShop(this.selectedShop || (exists ? this.selected : this.shops[0].id));
        } else {
          this.selected = null; this.detail = null; destroyChart(this.chart);
        }
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
        await this.$nextTick();
        this.renderChart();
      }
    },
    async selectShop(id) {
      this.selected = id;
      this.detailLoading = true;
      this.detailError = "";
      try {
        const body = await api.shop(id, this.range);
        this.detail = body.data;
        await this.$nextTick();
        this.renderChart();
      } catch (error) {
        this.detailError = error.message;
      } finally {
        this.detailLoading = false;
        await this.$nextTick();
        this.renderChart();
      }
    },
    renderChart() {
      const canvas = this.$refs.gmvChart;
      if (!canvas || !window.Chart || !this.detail) return;
      destroyChart(this.chart);
      const points = this.gmvTimeline;
      this.chart = new window.Chart(canvas, {
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
              callbacks: { label: (context) => ` GMV: ${formatCurrency(context.raw)}` },
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
          <p class="page-eyebrow">Cửa hàng &amp; nhà bán</p>
           <h1 class="page-title">Top 10 cửa hàng TikTok Shop</h1>
           <p class="page-desc">Sản phẩm liên kết, metric catalog có provenance và quan hệ affiliate khi nguồn có evidence canonical.</p>
        </div>
        <div class="page-actions">
          <time-filter :model-value="range" :ranges="$root.timeRanges" @update:model-value="$emit('update:range', $event)" />
        </div>
      </div>

      <state-block :loading="loading" :error="error" :empty="shops.length === 0" empty-text="Chưa có cửa hàng TikTok Shop. Hãy chạy npm run scrape.">
        <section-card title="Bảng xếp hạng cửa hàng" subtitle="Chọn một cửa hàng để xem chi tiết">
          <div class="table-wrap">
            <table class="data">
               <thead><tr><th>#</th><th>Cửa hàng</th><th>GMV catalog</th><th>Đã bán</th><th>Giá TB</th><th>Tăng trưởng</th></tr></thead>
              <tbody>
                <tr v-for="(shop, index) in shops" :key="shop.id" style="cursor:pointer" :style="selected === shop.id ? 'background:var(--brand-soft)' : ''" @click="selectShop(shop.id)">
                  <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                  <td>
                    <div class="entity">
                      <avatar :src="shop.avatarUrl" :name="shop.name" />
                      <div style="min-width:0">
                        <div class="entity-title">{{ shop.name }}</div>
                        <div class="entity-sub">@{{ shop.username || "—" }} · {{ shop.productCount }} sản phẩm</div>
                      </div>
                    </div>
                  </td>
                   <td class="cell-strong">{{ formatCurrency(shop.linkedProductGmvEstimate, true) }} <data-kind-badge :kind="shop.analytics?.linkedProductGmvEstimate?.dataKind ?? 'UNKNOWN'" /></td>
                   <td>{{ formatNumber(shop.linkedProductSales, true) }}</td>
                   <td>{{ formatCurrency(shop.avgPrice, true) }}</td>
                  <td><growth-badge :metric="primaryMetric(shop.growth)" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section-card>

        <state-block :loading="detailLoading" :error="detailError">
          <div v-if="detail" class="section-gap">
            <div class="shop-hero">
              <shop-banner :src="detail.bannerUrl" :name="detail.name" />
              <div class="shop-hero-body">
                <avatar :src="detail.avatarUrl" :name="detail.name" />
                <div style="min-width:0">
                  <div class="card-title" style="font-size:16px">{{ detail.name }}</div>
                  <div class="entity-sub">@{{ detail.username || "—" }} · ID {{ detail.platformShopId }}</div>
                </div>
                <a v-if="detail.shopUrl" :href="detail.shopUrl" target="_blank" rel="noopener" class="btn btn-sm" style="margin-left:auto">Mở shop ↗</a>
              </div>
            </div>

            <div class="stat-grid">
               <stat-card label="GMV Shop" :value="formatCurrency(detail.totalGmv, true)" :metric="primaryMetric(detail.growth)" :kind="gmvKind" :state="detail.analytics?.gmv?.state" hint="Chưa có seller-offer hoặc GMV trực tiếp" />
               <stat-card label="GMV catalog liên kết" :value="formatCurrency(detail.linkedProductGmvEstimate, true)" kind="ESTIMATED" hint="Product-global; không phân bổ là doanh thu riêng Shop" icon="⌀" />
              <stat-card label="Followers" :value="formatNumber(detail.followerCount, true)" icon="☺" />
              <stat-card label="Đánh giá" :value="safeFixed(detail.ratingScore, 1) + ' / 5'" :hint="formatNumber(detail.ratingCount) + ' lượt'" />
            </div>

            <div class="tabs" style="margin-top:18px">
              <button class="tab" :class="{ 'is-active': tab === 'revenue' }" @click="tab = 'revenue'">Nguồn doanh thu</button>
              <button class="tab" :class="{ 'is-active': tab === 'products' }" @click="tab = 'products'">Sản phẩm bán chạy</button>
              <button class="tab" :class="{ 'is-active': tab === 'new' }" @click="tab = 'new'">Mới trong 2 tuần</button>
              <button class="tab" :class="{ 'is-active': tab === 'affiliates' }" @click="tab = 'affiliates'">Top Affiliates</button>
            </div>

            <div v-show="tab === 'revenue'" class="grid-2">
               <section-card title="GMV Shop theo ngày" subtitle="Chưa có seller-offer timestamp; không suy diễn từ Product-global" :kind="timelineKind" :state="timelineState">
                <div v-if="gmvTimeline.length === 0" class="empty">Chưa có chuỗi GMV theo ngày.</div>
                <div v-else class="chart-box h-260"><canvas ref="gmvChart"></canvas></div>
              </section-card>

              <section-card title="Bóc tách nguồn tiền" subtitle="Video vs Live vs Giỏ hàng vs Product card">
                <div class="channel-list">
                  <div v-for="channel in channels" :key="channel.label" class="channel-row">
                    <span class="channel-name"><span class="dot" :style="{ background: channel.color }"></span>{{ channel.label }}</span>
                    <div class="bar"><span :style="{ width: (channel.share ?? 0) + '%', background: channel.color }"></span></div>
                    <span class="channel-value">{{ formatCurrency(channel.value, true) }}</span>
                  </div>
                </div>
                <p class="cell-muted" style="margin-top:12px">
                  {{ revenueKind === 'UNKNOWN' ? "Chưa có dữ liệu bóc tách nguồn doanh thu; giữ UNKNOWN, không tự phân bổ." : "Nguồn doanh thu được ghi nhãn theo metadata." }}
                </p>
              </section-card>
            </div>

            <section-card v-show="tab === 'products'" title="Sản phẩm bán chạy" subtitle="Top sản phẩm của cửa hàng">
              <div v-if="(detail.topProducts || []).length === 0" class="empty">Chưa có sản phẩm</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead><tr><th>#</th><th>Sản phẩm</th><th>Giá</th><th>Đã bán</th><th>GMV</th><th>Tăng trưởng</th></tr></thead>
                  <tbody>
                    <tr v-for="(product, index) in detail.topProducts" :key="product.id" style="cursor:pointer" @click="$emit('open-product', product.id)">
                      <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                      <td>
                        <div class="entity">
                          <product-image :src="product.imageUrl" :name="product.title" :alt="product.title" class-name="thumb" />
                          <div style="min-width:0"><div class="entity-title">{{ product.title }}</div><div class="entity-sub">{{ product.category }}</div></div>
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

            <section-card v-show="tab === 'new'" title="Sản phẩm mới trong 2 tuần" subtitle="Lần đầu được ghi nhận trong 14 ngày gần nhất">
              <div v-if="(detail.newProducts || []).length === 0" class="empty">Chưa có sản phẩm mới</div>
              <div v-else class="mini-grid">
                <article v-for="product in detail.newProducts" :key="product.id" class="mini-card" @click="$emit('open-product', product.id)">
                  <div class="mini-head">
                    <product-image :src="product.imageUrl" :name="product.title" :alt="product.title" class-name="thumb" />
                    <div style="min-width:0"><div class="mini-title">{{ product.title }}</div><div class="entity-sub">{{ product.category }}</div></div>
                  </div>
                  <div class="mini-metrics">
                    <div class="mini-metric"><div class="mini-metric-label">Giá</div><div class="mini-metric-value">{{ formatCurrency(product.price, true) }}</div></div>
                    <div class="mini-metric"><div class="mini-metric-label">Đã bán</div><div class="mini-metric-value">{{ formatNumber(product.soldCount, true) }}</div></div>
                  </div>
                </article>
              </div>
            </section-card>

            <section-card v-show="tab === 'affiliates'" title="Top 10 Affiliates" subtitle="Nhà sáng tạo đóng góp doanh số cho shop">
              <div v-if="(detail.topAffiliates || []).length === 0" class="empty">Hệ thống đang tích hợp dữ liệu cào đa tầng thực tế. Chưa có dữ liệu creator/video cho đợt quét này</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead><tr><th>#</th><th>Nhà sáng tạo</th><th>Followers</th><th>Tương tác</th><th>GMV</th></tr></thead>
                  <tbody>
                    <tr v-for="(creator, index) in detail.topAffiliates" :key="creator.id" style="cursor:pointer" @click="$emit('open-creator', creator.id)">
                      <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                      <td>
                        <div class="entity">
                          <avatar :src="creator.avatarUrl" :name="creator.displayName" />
                          <div><div class="entity-title">{{ creator.displayName }}</div><div class="entity-sub">@{{ creator.username || "—" }}</div></div>
                        </div>
                      </td>
                      <td>{{ formatNumber(creator.followerCount, true) }}</td>
                      <td>{{ creator.engagementRate === null ? "—" : safeFixed(creator.engagementRate, 2) + "%" }}</td>
                      <td class="cell-strong">{{ formatCurrency(creator.gmv, true) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section-card>
          </div>
        </state-block>
      </state-block>
    </div>
  `,
};
