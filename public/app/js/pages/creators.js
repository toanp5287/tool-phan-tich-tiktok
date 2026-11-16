import { api } from "../api.js";
import { safeFixed } from "../formatters.js";
import { formatCurrency, formatNumber, formatDate, primaryMetric } from "../format.js";
import { GrowthBadge, StatCard, SectionCard, Avatar, ProductImage, StateBlock, DataKindBadge } from "../components.js";

/** Thông điệp minh bạch khi đợt quét chưa có dữ liệu creator/video thực tế. */
const DATA_INTEGRATION_NOTICE =
  "Chưa có liên kết sản phẩm/shop/affiliate đã xác minh cho phạm vi này. Không suy diễn doanh số từ followers hay lượt xem.";

export const CreatorsPage = {
  name: "CreatorsPage",
  components: { GrowthBadge, StatCard, SectionCard, Avatar, ProductImage, StateBlock, DataKindBadge },
  props: { range: { type: String, required: true }, selectedCreator: {type: Number, default: null} },
  emits: ["open-product", "update:range"],
  data() {
    return {
      loading: true,
      error: "",
      creators: [],
      total: 0,
      selected: null,
      detail: null,
      detailLoading: false,
      detailError: "",
      sortBy: "gmv",
      role: "",
      notice: DATA_INTEGRATION_NOTICE,
    };
  },
  watch: {
    selectedCreator(id) { if(id) this.selectCreator(id); },
    range: "load",
    sortBy: "load",
    role: "load",
  },
  async mounted() {
    await this.load();
  },
  methods: {
    formatCurrency,
    formatNumber,
    formatDate,
    primaryMetric,
    safeFixed,
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const body = await api.creators({
          range: this.range,
          page: 1,
          pageSize: 10,
          sortBy: this.sortBy,
          role: this.role || undefined,
        });
        this.creators = body.data ?? [];
        this.total = body.pagination?.total ?? this.creators.length;
        if (this.creators.length > 0) {
          const exists = this.selected && this.creators.some((creator) => creator.id === this.selected);
          await this.selectCreator(this.selectedCreator || (exists ? this.selected : this.creators[0].id));
        } else {
          this.selected = null;
          this.detail = null;
        }
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    },
    async selectCreator(id) {
      this.selected = id;
      this.detailLoading = true;
      this.detailError = "";
      try {
        const body = await api.creator(id, this.range);
        this.detail = body.data;
      } catch (error) {
        this.detailError = error.message;
      } finally {
        this.detailLoading = false;
      }
    },
  },
  template: `
    <div>
      <div class="page-head">
        <div>
          <p class="page-eyebrow">Nhà sáng tạo &amp; Affiliate</p>
          <h1 class="page-title">Top 10 nhà sáng tạo nổi bật</h1>
          <p class="page-desc">Followers và tương tác theo quan sát thực; GMV UNKNOWN do chưa có liên kết sản phẩm đã xác minh.</p>
        </div>
        <div class="page-actions">
          <div class="segmented">
            <button :class="{ 'is-active': role === '' }" @click="role = ''">Tất cả</button>
            <button :class="{ 'is-active': role === 'AFFILIATE' }" @click="role = 'AFFILIATE'">Affiliate</button>
            <button :class="{ 'is-active': role === 'CREATOR' }" @click="role = 'CREATOR'">Creator</button>
          </div>
          <time-filter :model-value="range" :ranges="$root.timeRanges" @update:model-value="$emit('update:range', $event)" />
        </div>
      </div>

      <state-block :loading="loading" :error="error" :empty="creators.length === 0" :empty-text="notice">
        <div class="creators-detail-layout">
        <section-card title="Bảng xếp hạng nhà sáng tạo" :subtitle="'Tổng ' + formatNumber(total) + ' nhà sáng tạo'">
          <template #actions>
            <div class="segmented">
              <button :class="{ 'is-active': sortBy === 'gmv' }" @click="sortBy = 'gmv'">GMV</button>
              <button :class="{ 'is-active': sortBy === 'followers' }" @click="sortBy = 'followers'">Followers</button>
              <button :class="{ 'is-active': sortBy === 'engagement' }" @click="sortBy = 'engagement'">Tương tác</button>
            </div>
          </template>

          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>#</th><th>Nhà sáng tạo</th><th>Followers</th><th>Tương tác</th><th>GMV</th><th>Tăng trưởng</th></tr></thead>
              <tbody>
                <tr v-for="(creator, index) in creators" :key="creator.id" style="cursor:pointer" :style="selected === creator.id ? 'background:var(--brand-soft)' : ''" @click="selectCreator(creator.id)">
                  <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                  <td>
                    <div class="entity">
                      <avatar :src="creator.avatarUrl" :name="creator.displayName" />
                      <div style="min-width:0">
                        <div class="entity-title">{{ creator.displayName }}</div>
                        <div class="entity-sub">@{{ creator.username || "—" }} · {{ creator.role }}</div>
                      </div>
                    </div>
                  </td>
                  <td>{{ formatNumber(creator.followerCount, true) }}</td>
                  <td>{{ creator.engagementRate === null ? "—" : safeFixed(creator.engagementRate, 2) + "%" }} <data-kind-badge v-if="creator.engagementRate !== null" kind="ESTIMATED" /></td>
                  <td class="cell-strong">{{ formatCurrency(creator.gmv, true) }} <data-kind-badge :kind="creator.analytics?.gmv?.dataKind ?? 'UNKNOWN'" /></td>
                  <td><growth-badge :metric="primaryMetric(creator.growth)" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section-card>

        <state-block :loading="detailLoading" :error="detailError">
          <div v-if="detail" class="creator-detail-panel">
            <div class="stat-grid">
              <stat-card label="GMV" :value="formatCurrency(detail.gmv, true)" :metric="primaryMetric(detail.growth)" kind="UNKNOWN" hint="Chưa có liên kết sản phẩm" />
              <stat-card label="Followers" :value="formatNumber(detail.followerCount, true)" icon="☺" />
              <stat-card label="Tỷ lệ tương tác" :value="detail.engagementRate === null ? '—' : safeFixed(detail.engagementRate, 2) + '%'" :kind="detail.analytics?.engagement?.dataKind ?? 'UNKNOWN'" hint="Từ các bài đăng có đủ views/likes/shares/comments" icon="◎" />
              <stat-card label="Số bán" :value="formatNumber(detail.soldCount, true)" icon="↗" />
            </div>

            <div class="grid-2">
              <section-card title="3 sản phẩm bán chạy nhất" subtitle="Đóng góp doanh số nhiều nhất">
                 <div v-if="(detail.topProducts || []).length === 0" class="empty">{{ detail.relations?.products?.state === 'NO_DATA' ? 'Chưa có ProductCreator VERIFIED; không suy diễn sản phẩm từ category hoặc video.' : notice }}</div>
                <div v-else style="display:grid;gap:10px">
                  <article v-for="product in detail.topProducts" :key="product.id" class="mini-card" @click="$emit('open-product', product.id)">
                    <div class="mini-head">
                      <product-image :src="product.imageUrl" :name="product.title" :alt="product.title" class-name="thumb" />
                      <div style="min-width:0"><div class="mini-title">{{ product.title }}</div><div class="entity-sub">{{ formatCurrency(product.price, true) }}</div></div>
                    </div>
                    <div class="mini-metrics">
                      <div class="mini-metric"><div class="mini-metric-label">Đã bán</div><div class="mini-metric-value">{{ formatNumber(product.sales, true) }}</div></div>
                      <div class="mini-metric"><div class="mini-metric-label">GMV</div><div class="mini-metric-value">{{ formatCurrency(product.gmv, true) }}</div></div>
                    </div>
                  </article>
                </div>
              </section-card>

              <section-card title="Cửa hàng liên kết" subtitle="Shop mà nhà sáng tạo đang cộng tác">
                 <div v-if="(detail.shops || []).length === 0" class="empty">{{ detail.relations?.shops?.state === 'NO_DATA' ? 'Chưa có CreatorShop VERIFIED; không suy diễn shop từ category hoặc audience.' : notice }}</div>
                <div v-else class="table-wrap">
                  <table class="data">
                    <thead><tr><th>Cửa hàng</th><th>GMV</th></tr></thead>
                    <tbody>
                      <tr v-for="shop in detail.shops" :key="shop.id">
                        <td>
                          <div class="entity">
                            <avatar :src="shop.avatarUrl" :name="shop.name" />
                            <span class="entity-title">{{ shop.name }}</span>
                          </div>
                        </td>
                        <td class="cell-strong">{{ formatCurrency(shop.gmv, true) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section-card>
            </div>

            <section-card class="section-gap" title="Top Trend Video" subtitle="Video gắn với nhà sáng tạo">
                 <div v-if="(detail.topTrendVideos || []).length === 0" class="empty">Chưa có video canonical của kênh này.</div>
              <div v-else class="grid-3">
                <article v-for="video in detail.topTrendVideos" :key="video.id" class="mini-card" style="cursor:default">
                  <a v-if="video.videoUrl" :href="video.videoUrl" target="_blank" rel="noopener" class="video-cover-wrap">
                    <product-image :src="video.coverUrl" :name="video.content" :alt="video.content" class-name="video-cover" />
                    <span class="video-cover-badge">{{ formatNumber(video.viewsCount ?? video.playCount, true) }} views</span>
                  </a>
                  <div v-else class="video-cover-wrap">
                    <product-image :src="video.coverUrl" :name="video.content" :alt="video.content" class-name="video-cover" />
                    <span class="video-cover-badge">{{ formatNumber(video.viewsCount ?? video.playCount, true) }} views</span>
                  </div>
                  <div class="mini-title" style="min-height:auto">{{ video.content }}</div>
                  <div class="entity-sub">{{ formatNumber(video.viewsCount ?? video.playCount, true) }} lượt xem · {{ safeFixed(video.engagementRate, 2) }}%</div>
                  <a v-if="video.videoUrl" :href="video.videoUrl" target="_blank" rel="noopener" class="link" style="font-size:12px">Xem video →</a>
                </article>
              </div>
            </section-card>
          </div>
        </state-block>
        </div>
      </state-block>
    </div>
  `,
};
