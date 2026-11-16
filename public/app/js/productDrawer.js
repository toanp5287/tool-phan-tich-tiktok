import { api } from "./api.js";
import { safeFixed } from "./formatters.js";
import { formatCurrency, formatNumber, formatDate, formatCompact, dayLabel, primaryMetric } from "./format.js";
import { GrowthBadge, Avatar, ProductImage, ShopBanner, StateBlock, DataKindBadge, SectionCard } from "./components.js";
import { CHART_COLORS, baseOptions, lineDataset, destroyChart } from "./charts.js";

const DATA_INTEGRATION_NOTICE =
  "Chưa có liên kết canonical đã xác minh trong nguồn dữ liệu hiện tại. Hệ thống không suy diễn từ caption, tên hoặc lượt xem.";

/** Drawer chi tiết sản phẩm: biểu đồ biến động + Top Trend Video + Top 10 Creators. */
export const ProductDrawer = {
  name: "ProductDrawer",
  components: { GrowthBadge, Avatar, ProductImage, ShopBanner, StateBlock, DataKindBadge, SectionCard },
  props: {
    productId: { type: Number, default: null },
    range: { type: String, required: true },
  },
  emits: ["close", "open-category", "open-shop-products", "open-creator", "open-ai-report"],
  data() {
    return {
      loading: false,
      error: "",
      detail: null,
      chart: null,
      tab: "overview",
      notice: DATA_INTEGRATION_NOTICE,
      aiLoading: false,
      aiError: "",
      aiHistory: [],
      aiHistoryLoading: false,
      aiMode: "simulation",
      followUpQuestion: "",
      followUpAnswer: "",
      followUpLoading: false,
      followUpHistory: [],
    };
  },
  computed: {
    gmvMetric() {
      return primaryMetric(this.detail?.growth);
    },
    gmvKind() {
      return this.detail?.analytics?.gmv?.dataKind ?? "UNKNOWN";
    },
    chartModeLabel() {
      return this.timelineKind === "SIMULATED" ? "mô phỏng" : "";
    },
    timelineKind() {
      return this.detail?.analytics?.timeline?.dataKind ?? "UNKNOWN";
    },
    timelineState() {
      return this.detail?.analytics?.timeline?.state ?? "NO_TIMESTAMP";
    },
    channels() {
      const sources = this.detail?.revenueSources ?? {};
      return [
        { key: "video", label: "Video", value: sources.video, share: sources.videoShare, color: CHART_COLORS.brand },
        { key: "live", label: "Live", value: sources.live, share: sources.liveShare, color: CHART_COLORS.pink },
        { key: "cart", label: "Giỏ hàng", value: sources.cart, share: sources.cartShare, color: CHART_COLORS.cyan },
        { key: "card", label: "Product card", value: sources.productCard, share: sources.productCardShare, color: CHART_COLORS.amber },
      ];
    },
  },
  watch: {
    productId: "load",
    range: "load",
    aiMode: "load",
  },
  async mounted() {
    await this.load();
  },
  beforeUnmount() {
    destroyChart(this.chart);
  },
  methods: {
    formatCurrency(value, compact = false, currency = this.detail?.currency) { return formatCurrency(value, compact, currency); },
    formatNumber,
    formatCompact,
    formatDate,
    dayLabel,
    primaryMetric,
    safeFixed,
    async analyzeWithAi() {
      if (!this.detail || this.aiLoading) return;
      const productId = this.productId;
      this.aiLoading = true;
      this.aiError = "";
      try {
        const response = await fetch(`/api/products/${productId}/deep-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ mode: this.aiMode, days: Number.parseInt(this.range, 10) || 30 }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) throw new Error(body?.error?.message || `Yêu cầu thất bại (${response.status})`);
        this.followUpAnswer = body.data.report || "";
        this.followUpHistory = [];
        this.aiHistory = [];
        this.loadAiHistory();
      } catch (error) {
        this.aiError = error.message || String(error);
      } finally {
        this.aiLoading = false;
      }
    },
    async askFollowUp() {
      const q = (this.followUpQuestion || "").trim();
      if (!q || this.followUpLoading) return;
      this.followUpLoading = true;
      this.aiError = "";
      try {
        const response = await fetch(`/api/products/${this.productId}/deep-analysis/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ question: q, mode: this.aiMode, history: this.followUpHistory }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) throw new Error(body?.error?.message || `Yêu cầu thất bại (${response.status})`);
        this.followUpHistory.push({ role: "user", content: q });
        this.followUpHistory.push({ role: "assistant", content: body.data.answer });
        this.followUpAnswer = body.data.answer;
        this.followUpQuestion = "";
      } catch (error) {
        this.aiError = error.message || String(error);
      } finally {
        this.followUpLoading = false;
      }
    },
    openProductDetail() {
      window.location.href = `/detail.html?id=${this.productId}`;
    },
    async load() {
      if (!this.productId) return;
      this.detail = null;
      this.aiError = "";
      this.aiHistory = [];
      this.loading = true;
      this.error = "";
      try {
        const body = await api.product(this.productId, this.range, this.aiMode);
        this.detail = body.data;
        this.loadAiHistory();
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
    async loadAiHistory() {
      if (!this.productId) return;
      this.aiHistoryLoading = true;
      try {
        const response = await fetch(`/api/products/${this.productId}/ai-analysis`, { headers: { Accept: "application/json" } });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) throw new Error(body?.error?.message || `Yêu cầu thất bại (${response.status})`);
        this.aiHistory = body.data || [];
      } catch (error) {
        this.aiError = error.message || String(error);
      } finally {
        this.aiHistoryLoading = false;
      }
    },
    renderChart() {
      const canvas = this.$refs.historyChart;
      if (!canvas || !window.Chart || !this.detail) return;
      destroyChart(this.chart);
      const points = this.detail.timeline ?? [];

      this.chart = new window.Chart(canvas, {
        type: "line",
        data: {
          labels: points.map((point) => dayLabel(point.date)),
          datasets: [
            lineDataset(this.chartModeLabel ? `GMV ${this.chartModeLabel}` : "GMV", points.map((point) => point.gmv), CHART_COLORS.brand),
            lineDataset(this.chartModeLabel ? `Số bán ${this.chartModeLabel}` : "Số bán", points.map((point) => point.sales), CHART_COLORS.cyan, { fill: false }),
          ],
        },
        options: baseOptions({
          plugins: {
            ...baseOptions().plugins,
            legend: { ...baseOptions().plugins.legend, display: true },
            tooltip: {
              ...baseOptions().plugins.tooltip,
              callbacks: {
                label: (context) =>
                  context.datasetIndex === 0
                    ? ` GMV: ${formatCurrency(context.raw)}`
                    : ` Đã bán: ${formatNumber(context.raw)}`,
              },
            },
          },
        }),
      });
    },
  },
  template: `
    <teleport to="body">
      <div v-if="productId" class="drawer-backdrop" @click.self="$emit('close')">
        <aside class="drawer" role="dialog" aria-modal="true" aria-label="Chi tiết sản phẩm">
          <header class="drawer-head">
            <product-image
              :src="detail?.imageUrl"
              :name="detail?.title || 'Sản phẩm'"
              :alt="detail?.title"
              class-name="thumb thumb-lg"
            />
            <div style="flex:1;min-width:0">
              <h2 class="card-title" style="font-size:16px">{{ detail?.title || "Đang tải..." }}</h2>
              <div class="chip-row" style="margin-top:6px">
                <button
                  v-if="detail?.shopName"
                  class="chip chip-link"
                  title="Xem tất cả sản phẩm của shop này"
                  @click="$emit('open-shop-products', detail.shopId, detail.shopName)"
                ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9 4 3h16l1 6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 11v8h14v-8"/></svg>{{ detail.shopName }}</button>
                <button
                  v-if="detail?.category"
                  class="chip chip-link"
                  title="Xem tất cả sản phẩm cùng ngành hàng"
                  @click="$emit('open-category', detail.category)"
                ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.29-8.29a1 1 0 0 0 0-1.42Z"/><path d="M7 7h.01"/></svg>{{ detail.category }}</button>
                <span v-if="detail?.subCategory" class="chip">{{ detail.subCategory }}</span>
                <span
                  v-if="detail?.classification?.tier"
                  class="chip"
                  :title="detail.classification.reason || ''"
                  :class="{ 'chip-warn': detail.classification.tier !== 'CONFIRMED' }"
                >{{ detail.classification.tier }}{{ detail.classification.confidence != null ? ' · ' + detail.classification.confidence + '%' : '' }}</span>
              </div>
              <div style="display:flex;gap:7px;margin-top:9px;flex-wrap:wrap">
                <span v-if="detail" class="pill pill-brand">{{ detail.variantCount }} SKU</span>
                <span v-if="detail" class="pill">Tồn kho: {{ formatNumber(detail.stockTotal) }}</span>
                <span v-if="detail" class="pill">Người bán: {{ detail.sellerCount }}</span>
                <growth-badge v-if="detail" :metric="gmvMetric" mode="delta" />
              </div>
            </div>
            <button class="icon-btn" aria-label="Đóng" @click="$emit('close')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </header>

          <div v-if="detail" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 16px 12px">
            <div class="segmented" role="group" aria-label="Chế độ phân tích AI">
              <button type="button" :class="{ 'is-active': aiMode === 'simulation' }" @click="aiMode = 'simulation'">Mô phỏng</button>
              <button type="button" :class="{ 'is-active': aiMode === 'real_data' }" @click="aiMode = 'real_data'">Dữ liệu thật</button>
            </div>
            <button class="btn btn-primary" :disabled="aiLoading" @click="analyzeWithAi">{{ aiLoading ? "Đang phân tích AI..." : "Phân tích AI" }}</button>
            <button class="btn btn-sm" type="button" @click="openProductDetail">Mở trang chi tiết</button>
            <span v-if="aiError" class="cell-muted" role="alert">{{ aiError }}</span>
          </div>

          <div v-if="followUpAnswer" style="margin:0 16px 12px;display:grid;gap:8px">
            <div class="card card-pad">
              <div class="card-title" style="font-size:14px;margin-bottom:6px">Báo cáo phân tích</div>
              <div class="report-plain" style="max-height:200px;overflow:auto;white-space:pre-wrap">{{ followUpAnswer }}</div>
            </div>
            <div style="display:flex;gap:8px">
              <input v-model="followUpQuestion" class="search-input" style="flex:1" placeholder="Hỏi tiếp: vì sao sản phẩm tăng trưởng?" @keyup.enter="askFollowUp" />
              <button class="btn btn-sm" :disabled="followUpLoading" @click="askFollowUp">{{ followUpLoading ? "..." : "Hỏi" }}</button>
            </div>
          </div>

          <div class="drawer-body">
            <state-block :loading="loading" :error="error">
              <div v-if="detail?.shop" class="shop-hero" style="margin-bottom:16px">
                <shop-banner :src="detail.shop.bannerUrl" :name="detail.shop.name" />
                <div class="shop-hero-body">
                  <avatar :src="detail.shop.avatarUrl" :name="detail.shop.name" />
                  <div style="min-width:0">
                    <div class="entity-title">{{ detail.shop.name }}</div>
                    <div class="entity-sub">Cửa hàng TikTok Shop · {{ detail.shopName }}</div>
                  </div>
                  <button
                    class="btn btn-sm"
                    style="margin-left:auto"
                    @click="$emit('open-shop-products', detail.shop.id, detail.shop.name)"
                  >Xem sản phẩm</button>
                </div>
              </div>

              <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
                <div class="stat" style="padding:13px 15px">
                  <div class="stat-label">GMV <data-kind-badge :kind="gmvKind" :state="detail.analytics?.gmv?.state" /></div>
                    <div class="stat-value" style="font-size:19px">{{ formatCurrency(detail.gmv, true) }}</div>
                  <div class="stat-foot"><growth-badge :metric="gmvMetric" /></div>
                </div>
                <div class="stat" style="padding:13px 15px">
                  <div class="stat-label">Đã bán</div>
                  <div class="stat-value" style="font-size:19px">{{ formatNumber(detail.soldCount) }}</div>
                </div>
                <div class="stat" style="padding:13px 15px">
                  <div class="stat-label">Giá bán</div>
                  <div class="stat-value" style="font-size:19px">{{ formatCurrency(detail.price, true) }}</div>
                  <div class="stat-foot"><span class="stat-hint">{{ formatCurrency(detail.minPrice) }} – {{ formatCurrency(detail.maxPrice) }}</span></div>
                </div>
                <div class="stat" style="padding:13px 15px">
                  <div class="stat-label">Đánh giá</div>
                  <div class="stat-value" style="font-size:19px">{{ safeFixed(detail.ratingScore, 1) }}<span style="font-size:13px;color:var(--text-muted)"> /5</span></div>
                  <div class="stat-foot"><span class="stat-hint">{{ formatNumber(detail.ratingCount) }} lượt</span></div>
                </div>
              </div>

              <div class="tabs" style="margin-top:18px">
                <button class="tab" :class="{ 'is-active': tab === 'overview' }" @click="tab = 'overview'">Biến động</button>
                <button class="tab" :class="{ 'is-active': tab === 'skus' }" @click="tab = 'skus'">SKU ({{ (detail.variants || []).length }})</button>
                <button class="tab" :class="{ 'is-active': tab === 'videos' }" @click="tab = 'videos'">Trend Video</button>
                 <button class="tab" :class="{ 'is-active': tab === 'shops' }" @click="tab = 'shops'">Shop ({{ (detail.shops || []).length }})</button>
                 <button class="tab" :class="{ 'is-active': tab === 'creators' }" @click="tab = 'creators'">Creators</button>
              </div>

               <div v-show="tab === 'overview'">
                <section v-if="aiHistoryLoading || aiHistory.length" class="section-gap">
                  <h3 class="card-title" style="margin:0 0 10px">Lịch sử báo cáo AI</h3>
                  <div v-if="aiHistoryLoading" class="cell-muted">Đang tải lịch sử báo cáo…</div>
                  <div v-else class="chip-row">
                    <button v-for="report in aiHistory" :key="report.id" type="button" class="chip chip-link" @click="$emit('open-ai-report', report.id)">
                      {{ report.status }} · {{ report.model || 'AI report' }} · {{ formatDate(report.createdAt) }}
                    </button>
                  </div>
                </section>
                <section-card title="GMV / số bán theo ngày" subtitle="Chỉ hiển thị khi source có ít nhất hai observation commerce cùng định nghĩa." :kind="timelineKind" :state="timelineState">
                  <div v-if="!(detail.timeline || []).length" class="empty">Chưa có chuỗi theo ngày.</div>
                  <div v-else class="chart-box h-260"><canvas ref="historyChart"></canvas></div>
                </section-card>
                <h3 class="card-title" style="margin:18px 0 10px">Bóc tách nguồn doanh thu</h3>
                <div class="channel-list">
                  <div v-for="channel in channels" :key="channel.key" class="channel-row">
                    <span class="channel-name">
                      <span class="dot" :style="{ background: channel.color }"></span>{{ channel.label }}
                    </span>
                    <div class="bar"><span :style="{ width: (channel.share ?? 0) + '%', background: channel.color }"></span></div>
                    <span class="channel-value">{{ formatCurrency(channel.value, true) }}</span>
                  </div>
                </div>
                <p class="cell-muted" style="margin-top:10px">
                  {{ detail.revenueSources?.analytics?.dataKind === 'UNKNOWN' || !detail.revenueSources?.analytics ? "Chưa có dữ liệu bóc tách nguồn doanh thu; giữ UNKNOWN, không tự phân bổ." : "Nguồn doanh thu được ghi nhãn theo metadata." }}
                </p>

                <h3 class="card-title" style="margin:18px 0 10px">Delta GMV theo mốc</h3>
                <div class="table-wrap">
                  <table class="data">
                    <thead><tr><th>Mốc</th><th>Δ GMV</th><th>Δ Số bán</th><th>Xu hướng</th></tr></thead>
                    <tbody>
                      <tr v-for="period in detail.growth.periods" :key="period.days">
                        <td class="cell-strong">{{ period.days === 1 ? "Hôm qua" : period.days + " ngày" }}</td>
                        <td>{{ formatCurrency(period.gmv.delta, true) }}</td>
                        <td>{{ formatNumber(period.sales.delta) }}</td>
                        <td><growth-badge :metric="period.gmv" /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div v-show="tab === 'skus'">
                <div v-if="(detail.variants || []).length === 0" class="empty">Sản phẩm không có biến thể</div>
                <div v-else class="table-wrap table-scroll">
                  <table class="data">
                    <thead><tr><th>SKU</th><th>Giá</th><th>Giá niêm yết</th><th>Tồn kho</th><th>Đã bán</th></tr></thead>
                    <tbody>
                      <tr v-for="variant in detail.variants" :key="variant.id">
                        <td>
                          <div class="cell-strong">{{ variant.name || variant.platformSkuId }}</div>
                          <div class="cell-muted" v-if="variant.attributes">
                            {{ Object.entries(variant.attributes).map(([k, v]) => k + ': ' + v).join(' · ') }}
                          </div>
                        </td>
                        <td class="cell-strong">{{ formatCurrency(variant.price, false, variant.currency) }}</td>
                        <td class="cell-muted">{{ formatCurrency(variant.originalPrice, false, variant.currency) }}</td>
                        <td>{{ variant.stock === null ? "—" : formatNumber(variant.stock) }}</td>
                        <td>{{ variant.soldCount === null ? "—" : formatNumber(variant.soldCount) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div v-show="tab === 'videos'">
                 <div v-if="(detail.topTrendVideos || []).length === 0" class="empty">{{ detail.relations?.videos?.reason || notice }}</div>
                <div v-else style="display:grid;gap:10px">
                  <article v-for="video in detail.topTrendVideos" :key="video.id" class="mini-card" style="cursor:default">
                    <a v-if="video.videoUrl" :href="video.videoUrl" target="_blank" rel="noopener" class="video-cover-wrap">
                      <product-image :src="video.coverUrl" :name="video.content" :alt="video.content" class-name="video-cover" />
                      <span class="video-cover-badge">{{ formatCompact(video.viewsCount ?? video.playCount) }} views</span>
                    </a>
                    <div v-else class="video-cover-wrap">
                      <product-image :src="video.coverUrl" :name="video.content" :alt="video.content" class-name="video-cover" />
                      <span class="video-cover-badge">{{ formatCompact(video.viewsCount ?? video.playCount) }} views</span>
                    </div>
                    <div class="mini-title" style="min-height:auto">{{ video.content }}</div>
                  <div class="entity-sub">@{{ video.author || "—" }} · {{ formatCompact(video.viewsCount ?? video.playCount) }} lượt xem · {{ safeFixed(video.engagementRate, 2) }}%</div>
                    <a v-if="video.videoUrl" :href="video.videoUrl" target="_blank" rel="noopener" class="link" style="font-size:12px">Xem video →</a>
                  </article>
                </div>
              </div>

               <div v-show="tab === 'creators'">
                 <div v-if="(detail.topCreators || []).length === 0" class="empty">{{ detail.relations?.creators?.reason || notice }}</div>
                 <div v-else class="table-wrap">
                   <table class="data">
                     <thead><tr><th>#</th><th>Nhà sáng tạo</th><th>Followers</th><th>GMV</th></tr></thead>
                     <tbody>
                       <tr v-for="(creator, index) in detail.topCreators" :key="creator.id">
                         <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                         <td>
                           <div class="entity">
                             <avatar :src="creator.avatarUrl" :name="creator.displayName" />
                             <div>
                               <div class="entity-title">{{ creator.displayName }}</div>
                               <div class="entity-sub">@{{ creator.username || "—" }}</div>
                             </div>
                           </div>
                         </td>
                         <td>{{ formatNumber(creator.followerCount, true) }}</td>
                         <td class="cell-strong">{{ formatCurrency(creator.gmv, true) }}</td>
                       </tr>
                     </tbody>
                   </table>
                 </div>
               </div>

               <div v-show="tab === 'shops'">
                 <div v-if="(detail.shops || []).length === 0" class="empty">Chưa có Shop canonical được xác minh cho sản phẩm này.</div>
                 <div v-else class="table-wrap">
                   <table class="data">
                     <thead><tr><th>Shop</th><th>Trạng thái</th><th>Giá/Số bán</th></tr></thead>
                     <tbody>
                       <tr v-for="shop in detail.shops" :key="shop.productShopId">
                         <td><div class="entity"><avatar :src="shop.avatarUrl" :name="shop.name" /><div><div class="entity-title">{{ shop.name }}</div><a v-if="shop.shopUrl" :href="shop.shopUrl" target="_blank" rel="noopener" class="link">Mở shop →</a></div></div></td>
                         <td>{{ shop.isActive ? 'VERIFIED / active' : 'VERIFIED / inactive' }}</td>
                         <td>{{ formatCurrency(shop.price, true) }} · {{ formatNumber(shop.sales, true) }}</td>
                       </tr>
                     </tbody>
                   </table>
                 </div>
               </div>
             </state-block>
          </div>
        </aside>
      </div>
    </teleport>
  `,
};
