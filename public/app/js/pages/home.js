import { api } from "../api.js";
import { safeFixed } from "../formatters.js";
import {
  formatCurrency,
  formatNumber,
  formatCompact,
  formatDate,
  growthMeta,
  primaryMetric,
  dayLabel,
} from "../format.js";
import { GrowthBadge, StatCard, SectionCard, Avatar, ProductImage, StateBlock, DataKindBadge } from "../components.js";
import { CHART_COLORS, baseOptions, lineDataset, destroyChart } from "../charts.js";

/** Trang chủ: Top 100 sản phẩm + mini card mũi tên + drawer chi tiết. */
export const HomePage = {
  name: "HomePage",
  components: { GrowthBadge, StatCard, SectionCard, Avatar, ProductImage, StateBlock, DataKindBadge },
  props: {
    range: { type: String, required: true },
  },
  emits: ["open-product", "open-shop", "open-creator", "open-category", "update:range"],
  data() {
    return {
      loading: true,
      error: "",
      data: null,
      chart: null,
      search: "",
      sortBy: "gmv",
    };
  },
  computed: {
    primaryGmv() {
      return primaryMetric(this.data?.growth);
    },
    totals() {
      return this.data?.totals ?? {};
    },
    gmvAnalytics() {
      return this.data?.analytics?.gmv ?? null;
    },
    timelineAnalytics() {
      return this.data?.analytics?.timeline ?? null;
    },
    gmvKind() {
      return this.gmvAnalytics?.dataKind ?? "UNKNOWN";
    },
    timelineKind() {
      return this.timelineAnalytics?.dataKind ?? "UNKNOWN";
    },
    timelineState() {
      return this.timelineAnalytics?.state ?? "NO_TIMESTAMP";
    },
    products() {
      const list = [...(this.data?.topProducts ?? [])];
      const keyword = this.search.trim().toLowerCase();
      const filtered = keyword ? list.filter((item) => item.title.toLowerCase().includes(keyword)) : list;
      const direction = this.sortBy === "sales" ? (a, b) => (b.soldCount ?? -1) - (a.soldCount ?? -1) : (a, b) => (b.gmv ?? -1) - (a.gmv ?? -1);
      return filtered.sort(direction).slice(0, 100);
    },
    trendVideos() {
      return (this.data?.topTrendVideos ?? []).slice(0, 6);
    },
    hasTrendVideos() {
      return this.trendVideos.some((item) => item.kind === "video");
    },
  },
  watch: {
    range: "load",
  },
  async mounted() {
    await this.load();
  },
  beforeUnmount() {
    destroyChart(this.chart);
  },
  methods: {
    formatCurrency,
    formatNumber,
    formatCompact,
    formatDate,
    safeFixed,
    dayLabel,
    growthMeta,
    primaryMetric,
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const body = await api.overview(this.range);
        this.data = body.data;
        await this.$nextTick();
        this.renderChart();
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
        await this.$nextTick();
        this.renderChart();
      }
    },
    renderChart() {
      const canvas = this.$refs.revenueChart;
      if (!canvas || !window.Chart || !this.data) return;
      destroyChart(this.chart);

      const points = this.data.revenueTimeline ?? [];
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
          <p class="page-eyebrow">TikTok Shop (đa thị trường)</p>
          <h1 class="page-title">Tổng quan thương mại điện tử</h1>
          <p class="page-desc">
            Toàn bộ dữ liệu sản phẩm, cửa hàng, nhà sáng tạo và video xu hướng thuộc
            TikTok Shop nhiều thị trường. Mũi tên xanh/đỏ thể hiện tăng trưởng so với kỳ trước.
          </p>
        </div>
        <div class="page-actions">
          <time-filter :model-value="range" :ranges="$root.timeRanges" @update:model-value="$emit('update:range', $event)" />
        </div>
      </div>

      <state-block :loading="loading" :error="error">
        <div class="stat-grid">
          <stat-card label="Tổng GMV ước tính" :value="formatCurrency(totals.totalGmv, true)" :metric="primaryGmv" :kind="gmvKind" :state="gmvAnalytics?.state" hint="soldCount × giá quan sát mới nhất" icon="₫" />
          <stat-card label="Sản phẩm" :value="formatNumber(totals.products)" :metric="data.growth.primary.orders" icon="◫" />
          <stat-card label="Số bán" :value="formatNumber(totals.totalSales, true)" :metric="data.growth.primary.sales" icon="↗" />
          <stat-card label="Giá trị / sản phẩm bán" :value="formatCurrency(totals.avgOrderValue)" kind="ESTIMATED" hint="Ước tính; không phải giá trị đơn hàng" icon="⌀" />
          <stat-card label="Cửa hàng" :value="formatNumber(totals.shops)" hint="Shop VN đang theo dõi" icon="⌂" />
          <stat-card label="Nhà sáng tạo" :value="formatNumber(totals.creators)" hint="Creator & affiliate" icon="☺" />
        </div>

        <div class="grid-2 section-gap">
          <section-card
            title="GMV theo ngày"
            :subtitle="timelineKind === 'SIMULATED' ? 'Chuỗi mô phỏng minh họa; không dùng cho KPI.' : 'Chưa có timestamp thương mại; không suy diễn lịch sử từ tổng lũy kế.'"
            :kind="timelineKind"
            :state="timelineState"
          >
            <div v-if="!(data.revenueTimeline || []).length" class="empty">Chưa có chuỗi GMV theo ngày. Không thay dữ liệu thiếu bằng 0.</div>
            <div v-else class="chart-box h-260">
              <canvas ref="revenueChart"></canvas>
            </div>
          </section-card>

          <section-card title="Top ngành hàng" subtitle="Tỷ trọng GMV ước tính; tăng trưởng chỉ hiển thị khi đủ baseline">
            <div v-if="(data.topCategories || []).length === 0" class="empty">Chưa có dữ liệu ngành hàng</div>
            <div v-else class="channel-list">
              <div
                v-for="category in data.topCategories"
                :key="category.name"
                class="channel-row channel-row-clickable"
                title="Xem tất cả sản phẩm cùng ngành hàng"
                @click="$emit('open-category', category.name)"
              >
                <span class="channel-name" :title="category.name">{{ category.name }}</span>
                <div class="bar"><span :style="{ width: Math.max(4, category.shareOfGmv ?? 0) + '%' }"></span></div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="channel-value">{{ formatCurrency(category.totalGmv, true) }}</span>
                  <data-kind-badge :kind="category.analytics?.gmv?.dataKind ?? 'UNKNOWN'" />
                  <growth-badge v-if="category.growth" :metric="primaryMetric(category.growth)" />
                </div>
              </div>
            </div>
          </section-card>
        </div>

        <section-card
          class="section-gap"
          title="Top 100 sản phẩm TikTok Shop"
          subtitle="GMV là ước tính soldCount × giá quan sát mới nhất; click để xem chi tiết"
        >
          <template #actions>
            <div style="display:flex;gap:8px;align-items:center">
              <input v-model="search" class="search-input" style="width:200px" placeholder="Tìm sản phẩm..." />
              <div class="segmented">
                <button :class="{ 'is-active': sortBy === 'gmv' }" @click="sortBy = 'gmv'">GMV</button>
                <button :class="{ 'is-active': sortBy === 'sales' }" @click="sortBy = 'sales'">Số bán</button>
              </div>
            </div>
          </template>

          <div v-if="products.length === 0" class="empty">Chưa có sản phẩm TikTok Shop. Hãy chạy <code>npm run scrape</code>.</div>
          <div v-else class="mini-grid">
            <article
              v-for="(product, index) in products"
              :key="product.id"
              class="mini-card"
              @click="$emit('open-product', product.id)"
            >
              <div class="mini-head">
                <span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span>
                <product-image :src="product.imageUrl" :name="product.title" :alt="product.title" class-name="thumb" />
                <div style="min-width:0;flex:1">
                  <div class="mini-title" :title="product.title">{{ product.title }}</div>
                  <div class="entity-sub">{{ product.shopName }}</div>
                </div>
              </div>
              <div class="mini-metrics">
                <div class="mini-metric">
                  <div class="mini-metric-label">GMV ước tính <data-kind-badge :kind="product.analytics?.gmv?.dataKind ?? 'UNKNOWN'" /></div>
                  <div class="mini-metric-value">{{ formatCurrency(product.gmv, true, product.currency) }}</div>
                </div>
                <div class="mini-metric">
                  <div class="mini-metric-label">Đã bán</div>
                  <div class="mini-metric-value">{{ formatNumber(product.soldCount, true) }}</div>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
                <span class="cell-muted">{{ formatCurrency(product.minPrice ?? product.price) }}<template v-if="product.maxPrice && product.maxPrice > product.minPrice"> – {{ formatCurrency(product.maxPrice) }}</template></span>
                <growth-badge :metric="primaryMetric(product.growth)" />
              </div>
            </article>
          </div>
        </section-card>

        <div class="grid-2 section-gap">
          <section-card title="Top cửa hàng" subtitle="Xếp theo GMV catalog của sản phẩm đã liên kết; không phải GMV riêng Shop">
            <div v-if="(data.topShops || []).length === 0" class="empty">Chưa có cửa hàng</div>
            <div v-else class="table-wrap">
              <table class="data">
                <thead>
                  <tr><th>#</th><th>Cửa hàng</th><th>GMV</th><th>Tăng trưởng</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(shop, index) in data.topShops" :key="shop.id" style="cursor:pointer" @click="$emit('open-shop', shop.id)">
                    <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                    <td>
                      <div class="entity">
                        <avatar :src="shop.avatarUrl" :name="shop.name" />
                        <div style="min-width:0">
                          <div class="entity-title">{{ shop.name }}</div>
                          <div class="entity-sub">{{ shop.productCount }} sản phẩm · {{ formatNumber(shop.followerCount, true) }} followers</div>
                        </div>
                      </div>
                    </td>
                    <td class="cell-strong">{{ formatCurrency(shop.linkedProductGmvEstimate, true) }} <data-kind-badge :kind="shop.analytics?.linkedProductGmvEstimate?.dataKind ?? 'UNKNOWN'" /></td>
                    <td><growth-badge :metric="primaryMetric(shop.growth)" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section-card>

          <section-card title="Top nhà sáng tạo" subtitle="GMV chưa có nguồn liên kết sản phẩm — giữ UNKNOWN, không suy diễn">
            <div v-if="(data.topCreators || []).length === 0" class="empty">Chưa có nhà sáng tạo</div>
            <div v-else class="table-wrap">
              <table class="data">
                <thead>
                  <tr><th>#</th><th>Nhà sáng tạo</th><th>Followers</th><th>GMV</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(creator, index) in data.topCreators" :key="creator.id" style="cursor:pointer" @click="$emit('open-creator', creator.id)">
                    <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                    <td>
                      <div class="entity">
                        <avatar :src="creator.avatarUrl" :name="creator.displayName" />
                        <div style="min-width:0">
                          <div class="entity-title">{{ creator.displayName }}</div>
                          <div class="entity-sub">@{{ creator.username || "—" }} · {{ creator.engagementRate === null ? "—" : safeFixed(creator.engagementRate, 2) + "% tương tác" }}</div>
                        </div>
                      </div>
                    </td>
                    <td>{{ formatNumber(creator.followerCount, true) }}</td>
                    <td class="cell-strong">{{ formatCurrency(creator.gmv, true) }} <data-kind-badge :kind="creator.analytics?.gmv?.dataKind ?? 'UNKNOWN'" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section-card>
        </div>

        <section-card
          class="section-gap"
          :title="hasTrendVideos ? 'Top Trend Video thương mại' : 'Top sản phẩm bán chạy (thay thế Trend Video)'"
          :subtitle="hasTrendVideos ? 'Video gắn với sản phẩm TikTok Shop' : 'Bảng TrendVideo chưa có bản ghi — hiển thị sản phẩm bán chạy thực tế từ cơ sở dữ liệu'"
        >
          <div v-if="trendVideos.length === 0" class="empty">Hệ thống đang tích hợp dữ liệu cào đa tầng thực tế. Chưa có dữ liệu video cho đợt quét này.</div>
          <div v-else class="grid-3">
            <article v-for="item in trendVideos" :key="item.kind + '-' + item.id" class="mini-card" :style="item.kind === 'product' ? 'cursor:pointer' : 'cursor:default'" @click="item.kind === 'product' && $emit('open-product', item.productId)">
              <a v-if="item.kind === 'video' && item.videoUrl" :href="item.videoUrl" target="_blank" rel="noopener" class="video-cover-wrap">
                <product-image :src="item.coverUrl" :name="item.content" :alt="item.content" class-name="video-cover" />
                <span class="video-cover-badge">{{ formatCompact(item.viewsCount ?? item.playCount) }} views</span>
              </a>
              <div v-else class="video-cover-wrap">
                <product-image :src="item.imageUrl || item.coverUrl" :name="item.content" :alt="item.content" class-name="video-cover" />
                <span v-if="item.kind === 'product'" class="video-cover-badge">{{ formatCompact(item.soldCount) }} đã bán</span>
                <span v-else class="video-cover-badge">{{ formatCompact(item.viewsCount ?? item.playCount) }} views</span>
              </div>
              <div class="mini-title" style="min-height:auto">{{ item.content }}</div>
              <div class="entity-sub">@{{ item.author || "—" }}</div>
              <div class="mini-metrics">
                <div class="mini-metric">
                  <div class="mini-metric-label">{{ item.kind === 'product' ? 'Đã bán' : 'Lượt xem' }}</div>
                  <div class="mini-metric-value">{{ formatCompact(item.kind === 'product' ? item.soldCount : (item.viewsCount ?? item.playCount)) }}</div>
                </div>
                <div class="mini-metric">
                  <div class="mini-metric-label">{{ item.kind === 'product' ? 'Giá' : 'Tương tác' }}</div>
                  <div class="mini-metric-value">{{ item.kind === 'product' ? formatCurrency(item.price, true) : safeFixed(item.engagementRate, 2) + '%' }}</div>
                </div>
              </div>
              <a v-if="item.kind === 'video' && item.videoUrl" :href="item.videoUrl" target="_blank" rel="noopener" class="link" style="font-size:12px">Xem video →</a>
            </article>
          </div>
        </section-card>
      </state-block>
    </div>
  `,
};
