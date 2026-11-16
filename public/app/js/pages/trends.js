import { trendApi } from "../api.js";
import { formatCurrency, formatNumber, formatCompact, formatPercent, dayLabel, daysForRange } from "../format.js";
import { StatCard, SectionCard, StateBlock, ProductImage, DataKindBadge } from "../components.js";
import { CHART_COLORS, baseOptions, lineDataset, destroyChart } from "../charts.js";

/**
 * Trang Xu hướng (Trend Analytics).
 *
 * Toàn bộ chỉ số được tính từ các mốc snapshot lịch sử (`bucketDate`) đã tích luỹ
 * sau mỗi lần cào — so sánh kỳ hiện tại với kỳ liền trước để suy ra mũi tên
 * tăng/giảm. Không dùng bất kỳ dữ liệu giả nào.
 */
export const TrendsPage = {
  name: "TrendsPage",
  components: { StatCard, SectionCard, StateBlock, ProductImage, DataKindBadge },
  props: { range: { type: String, required: true } },
  emits: ["open-product", "open-category", "update:range"],
  data() {
    return {
      loading: true,
      error: "",
      periods: 2,
      overview: null,
      detail: null,
      selectedCategory: "",
      detailLoading: false,
      detailError: "",
      chart: null,
      notice:
        "Hệ thống đang tích hợp dữ liệu cào đa tầng thực tế. Chưa có dữ liệu creator/video cho đợt quét này",
    };
  },
  computed: {
    days() {
      return daysForRange(this.range);
    },
    categories() {
      return this.overview?.categories ?? [];
    },
    totals() {
      return this.overview?.totals ?? null;
    },
    upCount() {
      return this.categories.filter((row) => row.metrics.gmv.direction === "up").length;
    },
    downCount() {
      return this.categories.filter((row) => row.metrics.gmv.direction === "down").length;
    },
    detailMetrics() {
      return this.detail?.metrics ?? null;
    },
    detailCards() {
      const m = this.detailMetrics;
      if (!m) return [];
      return [
        { key: "gmv", label: "GMV", metric: m.gmv, format: (v) => formatCurrency(v, true) },
        { key: "sales", label: "Sản lượng bán", metric: m.sales, format: (v) => formatNumber(v, true) },
        { key: "views", label: "Lượt xem", metric: m.views, format: (v) => formatCompact(v) },
        { key: "likes", label: "Lượt thích", metric: m.likes, format: (v) => formatCompact(v) },
        { key: "shares", label: "Chia sẻ", metric: m.shares, format: (v) => formatCompact(v) },
        { key: "comments", label: "Bình luận", metric: m.comments, format: (v) => formatCompact(v) },
        { key: "avgPrice", label: "Giá trung bình", metric: m.avgPrice, format: (v) => formatCurrency(v, true) },
        { key: "products", label: "Sản phẩm", metric: m.products, format: (v) => formatNumber(v) },
        { key: "shops", label: "Cửa hàng", metric: m.shops, format: (v) => formatNumber(v) },
        { key: "videos", label: "Video", metric: m.videos, format: (v) => formatNumber(v) },
      ];
    },
  },
  watch: {
    range: "reload",
    periods: "reload",
  },
  async mounted() {
    await this.reload();
  },
  beforeUnmount() {
    destroyChart(this.chart);
  },
  methods: {
    formatCurrency,
    formatNumber,
    formatCompact,
    formatPercent,
    dayLabel,
    arrow(direction) {
      return direction === "up" ? "▲" : direction === "down" ? "▼" : direction === "flat" ? "→" : "—";
    },
    arrowClass(direction) {
      return direction === "up" ? "is-up" : direction === "down" ? "is-down" : "is-flat";
    },
    directionLabel(direction) {
      return direction === "up" ? "Đang lên" : direction === "down" ? "Đang tụt" : direction === "flat" ? "Đi ngang" : "Chưa đủ lịch sử";
    },
    metricPercent(metric) {
      return formatPercent(metric?.changePercent, true);
    },
    async reload() {
      this.loading = true;
      this.error = "";
      try {
        const body = await trendApi.overview(this.days, this.periods, this.range);
        this.overview = body.data;
        const first = this.selectedCategory || this.categories[0]?.category || "";
        if (first) await this.selectCategory(first);
      } catch (error) {
        this.error = error.message;
        this.overview = null;
      } finally {
        this.loading = false;
        await this.$nextTick();
        this.renderChart();
      }
    },
    async selectCategory(category) {
      if (!category) return;
      this.selectedCategory = category;
      this.detailLoading = true;
      this.detailError = "";
      try {
        const body = await trendApi.category(category, this.days, this.periods, this.range);
        this.detail = body.data;
        await this.$nextTick();
        this.renderChart();
      } catch (error) {
        this.detailError = error.message;
        this.detail = null;
      } finally {
        this.detailLoading = false;
        await this.$nextTick();
        this.renderChart();
      }
    },
    renderChart() {
      const canvas = this.$refs.timelineChart;
      if (!canvas || !window.Chart || !this.detail) return;
      destroyChart(this.chart);

      const points = this.detail.timeline ?? [];
      this.chart = new window.Chart(canvas, {
        type: "line",
        data: {
          labels: points.map((point) => dayLabel(point.date)),
           datasets: [lineDataset("Lượt xem tích luỹ của mẫu bài đăng", points.map((point) => point.views), CHART_COLORS.brand)],
        },
        options: baseOptions({
          plugins: {
            ...baseOptions().plugins,
            tooltip: {
              ...baseOptions().plugins.tooltip,
               callbacks: { label: (context) => ` Lượt xem tích luỹ: ${formatNumber(context.raw)}` },
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
          <p class="page-eyebrow">Xu hướng thị trường</p>
          <h1 class="page-title">Phân tích xu hướng theo mốc lịch sử</h1>
          <p class="page-desc">
            Lịch sử tương tác từ dataset, neo tại lần đo cuối cùng được ghi nhận.
            Số đo tích luỹ của bài đăng không phải doanh số hoặc lượt xem phát sinh trong kỳ.
          </p>
        </div>
        <div class="page-actions">
          <div class="segmented" role="group" aria-label="Số kỳ so sánh">
            <button :class="{ 'is-active': periods === 2 }" @click="periods = 2">2 kỳ</button>
            <button :class="{ 'is-active': periods === 3 }" @click="periods = 3">3 kỳ</button>
            <button :class="{ 'is-active': periods === 4 }" @click="periods = 4">4 kỳ</button>
          </div>
          <time-filter :model-value="range" :ranges="$root.timeRanges" @update:model-value="$emit('update:range', $event)" />
        </div>
      </div>

      <state-block :loading="loading" :error="error">
        <div class="stat-grid">
          <stat-card label="GMV kỳ này" :value="formatCurrency(totals?.gmv?.current, true)" kind="UNKNOWN" hint="Chưa có nguồn GMV thương mại" icon="₫" />
          <stat-card label="Sản lượng bán" :value="formatNumber(totals?.sales?.current, true)" icon="↗" />
          <stat-card label="Lượt xem" :value="formatCompact(totals?.views?.current)" icon="◎" />
          <stat-card label="Ngành hàng" :value="formatNumber(categories.length)" icon="◫" />
        </div>

        <div class="trend-summary section-gap">
          <span class="trend-chip is-up">▲ {{ upCount }} ngành đang lên</span>
          <span class="trend-chip is-down">▼ {{ downCount }} ngành đang tụt</span>
            <span class="cell-muted" v-if="overview?.periods?.[0]">Kỳ dataset: {{ overview.periods[0].start }} → {{ overview.periods[0].end }} · Nguồn học thuật chưa xác minh độc lập; GMV UNKNOWN</span>
        </div>

        <section-card class="section-gap" title="Bảng so sánh ngành hàng" subtitle="Mũi tên xanh/đỏ thể hiện tăng/giảm so với kỳ trước">
          <div v-if="categories.length === 0" class="empty">Chưa có dữ liệu xu hướng. Hãy chạy <code>npm run scrape</code> để tích luỹ snapshot.</div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>#</th><th>Ngành hàng</th><th>GMV</th><th>Xu hướng GMV</th>
                  <th>Sản lượng</th><th>Lượt xem</th><th>Tỷ trọng</th><th>Ngành con nổi bật</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in categories"
                  :key="row.category"
                  style="cursor:pointer"
                  :style="selectedCategory === row.category ? 'background:var(--brand-soft)' : ''"
                  @click="selectCategory(row.category)"
                >
                  <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                  <td class="cell-strong">{{ row.category }}</td>
                  <td class="cell-strong">{{ formatCurrency(row.metrics.gmv.current, true) }}</td>
                  <td>
                    <span class="trend-arrow" :class="arrowClass(row.metrics.gmv.direction)" :title="directionLabel(row.metrics.gmv.direction)">
                      {{ arrow(row.metrics.gmv.direction) }} {{ metricPercent(row.metrics.gmv) }}
                    </span>
                  </td>
                  <td>{{ formatNumber(row.metrics.sales.current, true) }}</td>
                  <td>{{ formatCompact(row.metrics.views.current) }}</td>
                  <td>{{ formatPercent(row.shareOfGmv) }}</td>
                  <td class="cell-muted">{{ row.topSubCategory || "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section-card>

        <state-block :loading="detailLoading" :error="detailError">
          <div v-if="detail" class="section-gap">
            <div class="page-head" style="margin-bottom:12px">
              <div>
                <p class="page-eyebrow">Chi tiết ngành hàng</p>
                <h2 class="card-title" style="font-size:20px">{{ detail.category }}</h2>
              </div>
              <div class="page-actions">
                <button class="btn btn-sm" @click="$emit('open-category', detail.category)">Xem sản phẩm ngành này →</button>
              </div>
            </div>

            <div class="stat-grid">
              <div v-for="card in detailCards" :key="card.key" class="stat" style="padding:13px 15px">
                <div class="stat-label">{{ card.label }}</div>
                <div class="stat-value" style="font-size:19px">{{ card.format(card.metric.current) }}</div>
                <div class="stat-foot">
                  <span class="trend-arrow" :class="arrowClass(card.metric.direction)">
                    {{ arrow(card.metric.direction) }} {{ metricPercent(card.metric) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="grid-2 section-gap">
              <section-card title="Lượt xem tích luỹ theo ngày đo" subtitle="Mỗi bài một số đo cuối ngày; tập bài có thể thay đổi theo ngày">
                <div class="chart-box h-260"><canvas ref="timelineChart"></canvas></div>
              </section-card>

              <section-card title="Ngành con theo tỷ trọng GMV ước tính" subtitle="Ước tính lũy kế, không phải GMV trong kỳ" kind="ESTIMATED">
                <div v-if="(detail.subCategories || []).length === 0" class="empty">Chưa có ngành con</div>
                <div v-else class="channel-list">
                  <div
                    v-for="sub in detail.subCategories"
                    :key="sub.name"
                    class="channel-row"
                  >
                    <span class="channel-name" :title="sub.name">{{ sub.name }}</span>
                    <div class="bar"><span :style="{ width: Math.max(4, sub.shareOfGmv) + '%' }"></span></div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <span class="channel-value">{{ formatCurrency(sub.metrics.gmv.current, true) }}</span>
                      <span class="trend-arrow" :class="arrowClass(sub.metrics.gmv.direction)">{{ arrow(sub.metrics.gmv.direction) }}</span>
                    </div>
                  </div>
                </div>
              </section-card>
            </div>

            <section-card class="section-gap" title="Sản phẩm cùng ngành hàng" subtitle="Xếp theo GMV ước tính lũy kế; không chứng minh đóng góp vào xu hướng" kind="ESTIMATED">
              <div v-if="(detail.topProducts || []).length === 0" class="empty">Chưa có sản phẩm</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead><tr><th>#</th><th>Sản phẩm</th><th>Giá</th><th>Đã bán</th><th>GMV</th><th>Xu hướng</th></tr></thead>
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
                      <td>{{ formatNumber(product.sales, true) }}</td>
                      <td class="cell-strong">{{ formatCurrency(product.gmv, true) }}</td>
                      <td>
                        <span class="trend-arrow" :class="arrowClass(product.gmvTrend.direction)">
                          {{ arrow(product.gmvTrend.direction) }} {{ metricPercent(product.gmvTrend) }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section-card>

            <div class="grid-2 section-gap">
              <section-card title="Hashtag đang lên" subtitle="Theo từ khoá gắn với sản phẩm">
                <div v-if="(detail.hashtags || []).length === 0" class="empty">{{ notice }}</div>
                <div v-else class="channel-list">
                  <div v-for="tag in detail.hashtags" :key="tag.hashtag" class="channel-row">
                    <span class="channel-name">#{{ tag.hashtag }}</span>
                    <div class="bar"><span :style="{ width: Math.max(4, tag.count * 100 / (detail.hashtags[0].count || 1)) + '%' }"></span></div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <span class="channel-value">{{ formatCompact(tag.views) }} views</span>
                      <span class="trend-arrow" :class="arrowClass(tag.trend.direction)">{{ arrow(tag.trend.direction) }}</span>
                    </div>
                  </div>
                </div>
              </section-card>

              <section-card title="Âm thanh đang lên" subtitle="Nhạc nền video bán hàng">
                <div v-if="(detail.sounds || []).length === 0" class="empty">{{ notice }}</div>
                <div v-else class="channel-list">
                  <div v-for="sound in detail.sounds" :key="sound.name" class="channel-row">
                    <span class="channel-name" :title="sound.name">{{ sound.name }}</span>
                    <div class="bar"><span :style="{ width: Math.max(4, sound.count * 100 / (detail.sounds[0].count || 1)) + '%' }"></span></div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <span class="channel-value">{{ formatCompact(sound.views) }} views</span>
                      <span class="trend-arrow" :class="arrowClass(sound.trend.direction)">{{ arrow(sound.trend.direction) }}</span>
                    </div>
                  </div>
                </div>
              </section-card>
            </div>
          </div>
        </state-block>
      </state-block>
    </div>
  `,
};
