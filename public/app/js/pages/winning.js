import { formatCurrency, formatNumber, formatCompact, formatPercent, dataKindLabel } from "../format.js";
import { SectionCard, StateBlock } from "../components.js";

const CLASS_LABELS = {
  EMERGING_WINNER: "Sản phẩm mới nổi",
  POTENTIAL_WINNER: "Tiềm năng (cần theo dõi)",
  ESTABLISHED_WINNER: "Đã chứng minh nhu cầu",
  SATURATED_PRODUCT: "Bão hòa",
  DECLINING_PRODUCT: "Suy giảm",
};
const CLASS_CLASS = {
  EMERGING_WINNER: "b-high",
  POTENTIAL_WINNER: "b-signal",
  ESTABLISHED_WINNER: "b-competition",
  SATURATED_PRODUCT: "b-watch",
  DECLINING_PRODUCT: "b-insufficient",
};

async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error?.message || `Yêu cầu thất bại (${response.status})`);
  return body.data;
}

export const WinningPage = {
  name: "WinningPage",
  components: { SectionCard, StateBlock },
  props: { range: { type: String, required: true } },
  emits: ["open-product", "update:range"],
  data() {
    return {
      loading: true,
      error: "",
      mode: "simulation",
      data: null,
    };
  },
  computed: {
    days() {
      const map = { "7d": 7, "30d": 30, "90d": 90 };
      return map[this.range] ?? 30;
    },
    top() {
      return this.data?.top ?? [];
    },
    modeLabel() {
      return this.mode === "simulation" ? "Mô phỏng" : "Dữ liệu thật";
    },
  },
  watch: {
    range: "reload",
  },
  async mounted() {
    await this.reload();
  },
  methods: {
    formatCurrency,
    formatNumber,
    formatCompact,
    formatPercent,
    classLabel(c) {
      return CLASS_LABELS[c] || c;
    },
    classClass(c) {
      return CLASS_CLASS[c] || "b-insufficient";
    },
    dataKind(mode) {
      return mode === "simulation" ? "SIMULATED" : "VERIFIED";
    },
    async reload() {
      this.loading = true;
      this.error = "";
      try {
        this.data = await request(`/api/winning-products?mode=${this.mode}&days=${this.days}&limit=50`);
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
  },
  template: `
    <div>
      <div class="page-head">
        <div>
          <p class="page-eyebrow">Winning Product Finder</p>
          <h1 class="page-title">Tìm sản phẩm tiềm năng</h1>
          <p class="page-desc">
            Xếp hạng sản phẩm theo điểm cơ hội do backend tính toán từ dữ liệu thực tế.
            Mỗi sản phẩm có điểm số, phân loại, số liệu chứng minh và độ tin cậy.
          </p>
        </div>
        <div class="page-actions">
          <div class="segmented" role="group" aria-label="Chế độ dữ liệu">
            <button :class="{ 'is-active': mode === 'simulation' }" @click="setMode('simulation')">Mô phỏng</button>
            <button :class="{ 'is-active': mode === 'real_data' }" @click="setMode('real_data')">Dữ liệu thật</button>
          </div>
          <time-filter :model-value="range" :ranges="$root.timeRanges" @update:model-value="$emit('update:range', $event)" />
        </div>
      </div>

      <div class="market-note section-gap" v-if="mode === 'simulation'">
        ⚠️ Chế độ MÔ PHỎNG: các sản phẩm dưới đây không phải "sản phẩm chiến thắng" thật trên thị trường.
        Điểm số chỉ dùng để kiểm thử thuật toán và giao diện.
      </div>

      <state-block :loading="loading" :error="error" :empty="top.length === 0" empty-text="Chưa đủ dữ liệu để xếp hạng.">
        <section-card
          :title="'Bảng xếp hạng — ' + modeLabel"
          :subtitle="'Điểm cơ hội 0–100; ' + (mode === 'simulation' ? 'dữ liệu mô phỏng' : 'dữ liệu đã xác minh')"
          :kind="dataKind(mode)"
        >
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>#</th><th>Sản phẩm</th><th>Danh mục</th><th>Giá</th><th>Doanh số</th><th>GMV</th>
                  <th>Tăng trưởng 30d</th><th>Shop</th><th>Creator</th><th>Điểm</th><th>Phân loại</th><th>Tin cậy</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(c, index) in top" :key="c.productId" style="cursor:pointer" @click="$emit('open-product', c.productId)">
                  <td><span class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                  <td>
                    <div class="entity-title" :title="c.title">{{ c.title }}</div>
                  </td>
                  <td class="cell-muted">{{ c.category || "—" }}</td>
                  <td>{{ formatCurrency(c.price, true, c.currency) }}</td>
                  <td>{{ formatNumber(c.sales, true) }}</td>
                  <td class="cell-strong">{{ formatCurrency(c.gmv, true, c.currency) }}</td>
                  <td>
                    <span :class="c.growth30d === null ? '' : (c.growth30d >= 0 ? 'is-up' : 'is-down')">
                      {{ c.growth30d === null ? '—' : formatPercent(c.growth30d, true) }}
                    </span>
                  </td>
                  <td>{{ formatNumber(c.sellerCount) }}</td>
                  <td>{{ formatNumber(c.affiliateCreatorCount) }}</td>
                  <td class="cell-strong">{{ formatNumber(c.winningScore) }}</td>
                  <td><span class="pill" :class="classClass(c.classification)">{{ classLabel(c.classification) }}</span></td>
                  <td>{{ formatNumber(c.confidence) }}/100</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="data?.methodology" class="cell-muted" style="margin-top:10px">
            Công thức: {{ data.methodology.criteria.map((c) => c.criterion + ' ' + c.weight).join(' · ') }}.
            Nhóm thiếu dữ liệu bị loại khỏi trọng số (không gán 0).
          </p>
        </section-card>
      </state-block>
    </div>
  `,
};
