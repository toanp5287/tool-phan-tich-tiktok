import { formatCurrency, formatNumber, formatPercent, dataKindLabel } from "../format.js";
import { SectionCard, StateBlock } from "../components.js";

const CLASS_LABELS = {
  EMERGING_WINNER: "Ngách mới nổi",
  POTENTIAL_WINNER: "Tiềm năng (theo dõi)",
  ESTABLISHED_WINNER: "Đã ổn định",
  SATURATED_MARKET: "Bão hòa",
  DECLINING_MARKET: "Suy giảm",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu",
};
const CLASS_CLASS = {
  EMERGING_WINNER: "b-high",
  POTENTIAL_WINNER: "b-signal",
  ESTABLISHED_WINNER: "b-competition",
  SATURATED_MARKET: "b-watch",
  DECLINING_MARKET: "b-insufficient",
  INSUFFICIENT_DATA: "b-insufficient",
};
const COMPETITION_LABELS = { LOW: "Thấp", MODERATE: "Vừa", HIGH: "Cao", SATURATED: "Bão hòa", UNKNOWN: "—" };

async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error?.message || `Yêu cầu thất bại (${response.status})`);
  return body.data;
}

export const MarketOpportunitiesPage = {
  name: "MarketOpportunitiesPage",
  components: { SectionCard, StateBlock },
  data() {
    return {
      loading: true,
      error: "",
      mode: "simulation",
      days: 30,
      market: "",
      competition: "",
      growth: "",
      minScore: 0,
      page: 1,
      pageSize: 20,
      data: null,
      markets: [],
      detail: null,
      detailLoading: false,
    };
  },
  computed: {
    items() {
      return this.data?.items ?? [];
    },
    total() {
      return this.data?.total ?? 0;
    },
    totalPages() {
      return Math.max(1, Math.ceil(this.total / this.pageSize));
    },
    modeLabel() {
      return this.mode === "simulation" ? "Mô phỏng" : "Dữ liệu thật";
    },
  },
  async mounted() {
    await Promise.all([this.loadMarkets(), this.reload()]);
  },
  methods: {
    formatCurrency,
    formatNumber,
    formatPercent,
    classLabel(c) {
      return CLASS_LABELS[c] || c;
    },
    classClass(c) {
      return CLASS_CLASS[c] || "b-insufficient";
    },
    competitionLabel(c) {
      return COMPETITION_LABELS[c] || "—";
    },
    dataKind() {
      return this.mode === "simulation" ? "SIMULATED" : "VERIFIED";
    },
    async loadMarkets() {
      try {
        this.markets = (await request("/api/market-intelligence/markets")).markets ?? [];
      } catch (error) {
        this.error = error.message;
      }
    },
    async reload() {
      this.loading = true;
      this.error = "";
      this.page = 1;
      this.detail = null;
      try {
        const params = new URLSearchParams();
        params.set("mode", this.mode);
        params.set("days", String(this.days));
        params.set("page", String(this.page));
        params.set("pageSize", String(this.pageSize));
        if (this.market) params.set("market", this.market);
        if (this.competition) params.set("competition", this.competition);
        if (this.growth) params.set("growth", this.growth);
        if (this.minScore) params.set("minScore", String(this.minScore));
        this.data = await request(`/api/market-intelligence/opportunities?${params.toString()}`);
      } catch (error) {
        this.error = error.message;
        this.data = null;
      } finally {
        this.loading = false;
      }
    },
    setMode(mode) {
      if (this.mode === mode) return;
      this.mode = mode;
      this.reload();
    },
    async goPage(page) {
      this.page = Math.max(1, Math.min(page, this.totalPages));
      this.loading = true;
      this.error = "";
      this.detail = null;
      try {
        const params = new URLSearchParams();
        params.set("mode", this.mode);
        params.set("days", String(this.days));
        params.set("page", String(this.page));
        params.set("pageSize", String(this.pageSize));
        if (this.market) params.set("market", this.market);
        if (this.competition) params.set("competition", this.competition);
        if (this.growth) params.set("growth", this.growth);
        if (this.minScore) params.set("minScore", String(this.minScore));
        this.data = await request(`/api/market-intelligence/opportunities?${params.toString()}`);
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    },
    openNiche(niche) {
      this.detail = niche;
    },
  },
  template: `
    <div>
      <div class="page-head">
        <div>
          <p class="page-eyebrow">Market Opportunity Engine</p>
          <h1 class="page-title">Khám phá ngách cơ hội</h1>
          <p class="page-desc">
            Xếp hạng ngách (danh mục con) theo điểm cơ hội từ 7 tiêu chí: nhu cầu, tăng trưởng,
            cạnh tranh, tiềm năng thương mại, cơ hội creator, độ ổn định và độ tin cậy.
          </p>
        </div>
        <div class="page-actions">
          <div class="segmented" role="group" aria-label="Chế độ dữ liệu">
            <button :class="{ 'is-active': mode === 'simulation' }" @click="setMode('simulation')">Mô phỏng</button>
            <button :class="{ 'is-active': mode === 'real_data' }" @click="setMode('real_data')">Dữ liệu thật</button>
          </div>
        </div>
      </div>

      <div class="market-note section-gap" v-if="mode === 'simulation'">
        ⚠️ Chế độ MÔ PHỎNG: kết quả dùng để kiểm thử thuật toán và giao diện, không phải cơ hội thị trường thật.
      </div>

      <form class="card card-pad market-filter section-gap" @submit.prevent="reload">
        <fieldset>
          <label>Thị trường
            <select v-model="market">
              <option value="">Tất cả</option>
              <option v-for="market in markets" :key="market.code || 'null'" :value="market.code || ''">{{ market.code || 'Không rõ' }} ({{ market.productCount }})</option>
            </select>
          </label>
          <label>Khoảng thời gian
            <select v-model.number="days">
              <option :value="7">7 ngày</option>
              <option :value="30">30 ngày</option>
              <option :value="90">90 ngày</option>
            </select>
          </label>
          <label>Mức cạnh tranh
            <select v-model="competition">
              <option value="">Tất cả</option>
              <option value="LOW">Thấp</option>
              <option value="MODERATE">Vừa</option>
              <option value="HIGH">Cao</option>
              <option value="SATURATED">Bão hòa</option>
            </select>
          </label>
          <label>Xu hướng
            <select v-model="growth">
              <option value="">Tất cả</option>
              <option value="rising">Đang tăng</option>
              <option value="declining">Đang giảm</option>
            </select>
          </label>
          <label>Điểm tối thiểu
            <input v-model.number="minScore" type="number" min="0" max="100" step="1" />
          </label>
        </fieldset>
        <div class="page-actions">
          <button class="btn btn-primary" type="submit" :disabled="loading">{{ loading ? 'Đang phân tích…' : 'Áp dụng' }}</button>
        </div>
      </form>

      <state-block :loading="loading" :error="error" :empty="items.length === 0" empty-text="Không có ngách nào đủ dữ liệu để chấm điểm.">
        <section-card
          :title="'Bảng xếp hạng ngách — ' + modeLabel"
          :subtitle="'Điểm cơ hội 0–100; ' + (mode === 'simulation' ? 'dữ liệu mô phỏng' : 'dữ liệu đã xác minh')"
          :kind="dataKind()"
        >
          <div class="summary-strip" v-if="data?.summary">
            <span>{{ data.summary.totalNiches }} ngách</span>
            <span>{{ data.summary.scoredNiches }} chấm được</span>
            <span>{{ data.summary.emerging }} mới nổi</span>
            <span>{{ data.summary.highOpportunity }} điểm cao (≥70)</span>
            <span>{{ data.summary.saturated }} bão hòa</span>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>#</th><th>Ngách</th><th>Sản phẩm</th><th>Doanh số</th><th>GMV</th>
                  <th>Tăng trưởng 30d</th><th>Shop</th><th>Creator</th><th>Cạnh tranh</th>
                  <th>Điểm</th><th>Phân loại</th><th>Tin cậy</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(niche, index) in items" :key="niche.key" class="market-row" @click="openNiche(niche)">
                  <td><span class="rank" :class="{ top: index < 3 }">{{ (page - 1) * pageSize + index + 1 }}</span></td>
                  <td><div class="entity-title" :title="niche.name">{{ niche.name }}</div></td>
                  <td>{{ formatNumber(niche.productCount) }}</td>
                  <td>{{ formatNumber(niche.totalSales, true) }}</td>
                  <td class="cell-strong">{{ formatCurrency(niche.totalGmv, true) }}</td>
                  <td>
                    <span :class="niche.growth30d === null ? '' : (niche.growth30d >= 0 ? 'is-up' : 'is-down')">
                      {{ niche.growth30d === null ? '—' : formatPercent(niche.growth30d, true) }}
                    </span>
                  </td>
                  <td>{{ formatNumber(niche.shopCount) }}</td>
                  <td>{{ formatNumber(niche.creatorCount) }}</td>
                  <td>{{ competitionLabel(niche.competitionLevel) }}</td>
                  <td class="cell-strong">{{ niche.opportunityScore === null ? '—' : formatNumber(niche.opportunityScore) }}</td>
                  <td><span class="pill" :class="classClass(niche.classification)">{{ classLabel(niche.classification) }}</span></td>
                  <td>{{ formatNumber(niche.confidence) }}/100</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="totalPages > 1" class="market-pagination">
            <button class="btn btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">Trước</button>
            <span class="cell-muted">{{ page }} / {{ totalPages }}</span>
            <button class="btn btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">Sau</button>
          </div>
        </section-card>
      </state-block>

      <section v-if="detail" class="card section-gap">
        <header class="card-head">
          <div>
            <h2 class="card-title">{{ detail.name }}</h2>
            <p class="card-sub">Chi tiết tiêu chí chấm điểm và tín hiệu.</p>
          </div>
          <button class="icon-btn" type="button" aria-label="Đóng chi tiết ngách" title="Đóng" @click="detail = null"><span aria-hidden="true">×</span></button>
        </header>
        <div class="card-body">
          <div class="stat-grid">
            <div class="stat"><div class="stat-label">Điểm cơ hội</div><div class="stat-value">{{ detail.opportunityScore === null ? '—' : formatNumber(detail.opportunityScore) }}</div><div class="stat-foot">{{ classLabel(detail.classification) }}</div></div>
            <div class="stat"><div class="stat-label">Độ tin cậy</div><div class="stat-value">{{ formatNumber(detail.confidence) }}</div><div class="stat-foot">/ 100</div></div>
            <div class="stat"><div class="stat-label">Doanh số</div><div class="stat-value">{{ formatNumber(detail.totalSales, true) }}</div></div>
            <div class="stat"><div class="stat-label">GMV</div><div class="stat-value">{{ formatCurrency(detail.totalGmv, true) }}</div></div>
          </div>
          <div class="grid-2 section-gap">
            <section>
              <h3 class="card-title">Tiêu chí đã chấm</h3>
              <p class="cell-muted">Nhóm thiếu dữ liệu bị loại khỏi trọng số (không gán 0).</p>
              <ul class="chip-list" style="margin-top:10px">
                <li v-for="criteria in detail.scoredCriteria" :key="criteria" class="pill">{{ criteria }}</li>
              </ul>
              <p v-if="detail.missing?.length" class="cell-muted" style="margin-top:10px">Thiếu dữ liệu: {{ detail.missing.join(', ') }}.</p>
            </section>
            <section>
              <h3 class="card-title">Tín hiệu</h3>
              <ul class="chip-list" style="margin-top:10px">
                <li v-for="factor in detail.positiveFactors" :key="factor" class="pill">+ {{ factor }}</li>
                <li v-for="factor in detail.negativeFactors" :key="factor" class="pill" style="opacity:.7">− {{ factor }}</li>
              </ul>
              <p v-if="detail.reasons?.length" class="cell-muted" style="margin-top:10px">{{ detail.reasons.join(' ') }}</p>
            </section>
          </div>
          <p class="cell-muted">{{ detail.limitation }}</p>
        </div>
      </section>
    </div>
  `,
};
