import { formatDate, formatNumber } from "../format.js";
import { renderMarkdown } from "../../../js/markdown.js";

const STATUS = { COMPLETED: "Hoàn thành", RUNNING: "Đang phân tích", FAILED: "Thất bại" };

async function request(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error?.message || `Yêu cầu thất bại (${response.status})`);
  return body.data;
}

export const AiReportPage = {
  name: "AiReportPage",
  props: { reportId: { type: String, default: "" } },
  emits: ["open-product", "go-products"],
  data() { return { loading: true, error: "", report: null }; },
  computed: {
    rawContent() {
      const value = this.report?.report;
      if (typeof value === "string") return value;
      if (value && typeof value === "object") return JSON.stringify(value, null, 2);
      return value ? String(value) : "";
    },
    format() {
      const declared = this.report?.format;
      if (["markdown", "json", "text"].includes(declared)) return declared;
      return /^(#|##|###|\*\*|[-*]\s|\||>|`)/m.test(this.rawContent) ? "markdown" : "text";
    },
    contentHtml() { return this.format === "markdown" ? renderMarkdown(this.rawContent) : ""; },
    statusLabel() { return STATUS[this.report?.status] || "Không xác định"; },
  },
  watch: { reportId: "load" },
  async mounted() { await this.load(); },
  methods: {
    formatDate,
    formatNumber,
    async load() {
      this.loading = true; this.error = ""; this.report = null;
      try {
        if (!/^[1-9]\d*$/.test(this.reportId)) throw new Error("ID báo cáo không hợp lệ");
        this.report = await request(`/api/ai-analysis/${this.reportId}`);
        if (this.report.status === "FAILED") this.error = this.report.errorMessage || "Phân tích thất bại.";
        else if (this.report.status === "RUNNING") this.error = "Báo cáo đang được xử lý. Hãy tải lại sau.";
        else if (!this.rawContent) this.error = "Báo cáo không có nội dung.";
      } catch (error) { this.error = error.message; }
      finally { this.loading = false; }
    },
  },
  template: `
    <section class="ai-report-page">
      <div class="page-head">
        <div><p class="page-eyebrow">AI Product Intelligence</p><h1 class="page-title">Báo cáo phân tích sản phẩm</h1><p class="page-desc">Báo cáo chỉ được tạo khi người dùng chủ động yêu cầu phân tích từ chi tiết sản phẩm.</p></div>
        <div class="page-actions"><button class="btn" type="button" @click="$emit('go-products')">Danh sách sản phẩm</button><button class="btn" type="button" :disabled="loading" @click="load">Làm mới</button></div>
      </div>
      <div v-if="loading" class="card card-pad"><div class="skeleton" style="height:18px;width:32%"></div><div class="skeleton" style="height:170px;margin-top:14px"></div></div>
      <div v-else-if="error" class="alert">{{ error }}</div>
      <template v-else-if="report">
        <section class="card card-pad ai-report-summary">
          <div><span class="data-kind kind-verified">{{ statusLabel }}</span><h2 class="ai-report-product">{{ report.product?.title || ('Sản phẩm #' + report.productId) }}</h2><p class="cell-muted">{{ report.dataWindowDays || '—' }} ngày · {{ formatDate(report.createdAt) }} · {{ report.model || '—' }}</p></div>
          <button class="btn btn-primary" type="button" @click="$emit('open-product', report.productId)">Mở sản phẩm</button>
        </section>
        <div class="stat-grid section-gap">
          <div class="stat"><div class="stat-label">Token đầu vào</div><div class="stat-value">{{ formatNumber(report.inputTokens) }}</div></div>
          <div class="stat"><div class="stat-label">Token đầu ra</div><div class="stat-value">{{ formatNumber(report.outputTokens) }}</div></div>
          <div class="stat"><div class="stat-label">Định dạng</div><div class="stat-value" style="font-size:18px">{{ format }}</div></div>
        </div>
        <section class="card section-gap"><header class="card-head"><div><h2 class="card-title">Nội dung báo cáo</h2><p class="card-sub">Tổng quan, tiềm năng, lợi thế, rủi ro và khuyến nghị theo dữ liệu báo cáo.</p></div></header><div class="card-body"><div v-if="format === 'markdown'" class="report-content" v-html="contentHtml"></div><pre v-else-if="format === 'json'" class="report-json">{{ rawContent }}</pre><div v-else class="report-plain">{{ rawContent }}</div></div></section>
      </template>
    </section>
  `,
};
