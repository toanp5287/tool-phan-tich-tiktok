import { renderMarkdown, normalizeReport } from "../../../js/markdown.js";

const STATUS = { HIGH_POTENTIAL: "Tiềm năng cao", POSITIVE_SIGNAL: "Có tín hiệu tích cực", HIGH_COMPETITION: "Cạnh tranh cao", WATCH: "Cần theo dõi thêm", INSUFFICIENT_DATA: "Chưa đủ dữ liệu" };

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error?.message || `API lỗi ${response.status}`);
  return body.data;
}

export const MarketGapPage = {
  name: "MarketGapPage",
  data() {
    return { categories: [], currencies: ["VND"], form: { categoryId: null, subCategoryId: null, currency: "VND", days: 30, mode: "QUICK" }, adminToken: "", requiresToken: false, loading: false, error: "", stage: "", result: null, detail: null, page: 1, pageSize: 10, aiLoading: false, aiError: "", aiReport: null, aiReportState: "", reports: [], reportsLoading: false };
  },
  computed: {
    selectedCategory() { return this.categories.find((item) => item.id === this.form.categoryId) || null; },
    totalPages() { return Math.max(1, Math.ceil((this.result?.niches?.length || 0) / this.pageSize)); },
    pagedNiches() { const start = (this.page - 1) * this.pageSize; return (this.result?.niches || []).slice(start, start + this.pageSize); },
    normalizedReport() { return normalizeReport(this.aiReport); },
    reportSections() { return this.normalizedReport.sections || []; },
    reportRawText() { return this.normalizedReport.raw || ""; },
  },
  async mounted() {
    try { const [, categories] = await Promise.all([request("/api/market-intelligence/capabilities"), request("/api/categories")]); this.categories = categories.categories || []; this.currencies = categories.currencies || ["VND"]; if (!this.currencies.includes(this.form.currency)) this.form.currency = this.currencies[0]; }
    catch (error) { this.error = error.message; }
  },
  methods: {
    fmt(value) { return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value) : "—"; },
    money(value) { return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("vi-VN", { style: "currency", currency: this.form.currency, maximumFractionDigits: 0 }).format(value) : "—"; },
    pct(value) { return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 1 }).format(value) : "—"; },
    statusLabel(value) { return STATUS[value] || value || "—"; },
    scoreLabel(niche) { return niche.opportunityScoreKind === "FULL" ? "Điểm cơ hội đầy đủ" : niche.opportunityScoreKind === "PRELIMINARY" ? "Điểm cơ hội sơ bộ" : "Điểm cơ hội"; },
    reasons(value) { return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []; },
    categoryChanged() { this.form.subCategoryId = null; },
    md(value) { return renderMarkdown(value || ""); },
    async analyze() {
      if (this.loading || !this.form.categoryId) return;
      this.loading = true; this.error = ""; this.result = null; this.detail = null; this.aiReport = null; this.page = 1; this.stage = "Đang phân tích ngách từ PostgreSQL…";
      try { const data = await request("/api/market-intelligence/market-gaps/analyses", { method: "POST", headers: { "Content-Type": "application/json", ...(this.adminToken ? { "x-admin-token": this.adminToken } : {}) }, body: JSON.stringify(this.form) }); this.result = { ...data.result, analysisId: data.analysisId }; this.stage = data.cache.hit ? "Đã dùng kết quả đã lưu." : "Đã hoàn tất phân tích dữ liệu; không gọi AI."; }
      catch (error) { if (error.message.includes("Token quản trị")) this.requiresToken = true; this.error = error.message; this.stage = "Không hoàn tất."; }
      finally { this.loading = false; }
    },
    async openNiche(niche) {
      if (!this.result?.analysisId) return;
      this.aiError = ""; this.aiReport = null; this.reports = []; this.reportsLoading = true;
      try { this.detail = await request(`/api/market-intelligence/market-gaps/analyses/${this.result.analysisId}/niches/${encodeURIComponent(niche.key)}`); this.reports = await request(`/api/market-intelligence/market-gaps/analyses/${this.result.analysisId}/niches/${encodeURIComponent(niche.key)}/reports`); }
      catch (error) { this.error = error.message; }
      finally { this.reportsLoading = false; }
    },
    async analyzeAi() {
      if (this.aiLoading || !this.detail?.evidence?.length || !this.result?.analysisId) return;
      if (!window.confirm("Gửi bằng chứng của ngách đã chọn đến AI để phân tích chuyên sâu? Có thể phát sinh phí.")) return;
      this.aiLoading = true; this.aiError = "";
      try { const data = await request("/api/market-intelligence/market-gaps/ai-analyses", { method: "POST", headers: { "Content-Type": "application/json", ...(this.adminToken ? { "x-admin-token": this.adminToken } : {}) }, body: JSON.stringify({ analysisId: this.result.analysisId, nicheKey: this.detail.key, confirmProviderCall: true }) }); this.aiReport = data.report; this.aiReportState = data.execution === "CACHED" ? "Báo cáo cache theo cùng bộ bằng chứng." : "Báo cáo AI đã hoàn tất."; this.reports = await request(`/api/market-intelligence/market-gaps/analyses/${this.result.analysisId}/niches/${encodeURIComponent(this.detail.key)}/reports`); }
      catch (error) { this.aiError = error.message; }
      finally { this.aiLoading = false; }
    },
    async openReport(report) { try { const data = await request(`/api/market-intelligence/market-gaps/ai-reports/${report.id}`); this.aiReport = data.report ?? data; this.aiReportState = "Báo cáo đã lưu."; } catch (error) { this.aiError = error.message; } },
  },
  template: `
    <section class="market-gap-page">
      <div class="page-head"><div><p class="page-eyebrow">Market Gap Finder</p><h1 class="page-title">Tìm ngách thị trường</h1><p class="page-desc">Đánh giá nhu cầu, tăng trưởng, cạnh tranh, ổn định, điểm cơ hội và độ tin cậy từ dữ liệu thực tế cùng đơn vị tiền tệ.</p></div></div>
      <div class="market-note">Phân tích dùng dữ liệu PostgreSQL sẵn có. Shop quan sát là số shop trong dataset, không phải toàn bộ thị trường.</div>
      <form class="card card-pad market-filter section-gap" @submit.prevent="analyze"><fieldset :disabled="loading"><label>Danh mục<select v-model.number="form.categoryId" required @change="categoryChanged"><option :value="null" disabled>Chọn danh mục</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.displayName || category.name }}</option></select></label><label>Danh mục con<select v-model.number="form.subCategoryId"><option :value="null">Tất cả danh mục con</option><option v-for="sub in selectedCategory?.subCategories || []" :key="sub.id" :value="sub.id">{{ sub.displayName || sub.name }}</option></select></label><label>Tiền tệ<select v-model="form.currency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></label><label>Khoảng thời gian<select v-model.number="form.days"><option :value="7">7 ngày</option><option :value="30">30 ngày</option><option :value="90">90 ngày</option></select></label><label>Độ sâu<select v-model="form.mode"><option value="QUICK">Phân tích nhanh</option><option value="DEEP">Phân tích chuyên sâu</option></select></label></fieldset><label v-if="requiresToken">Token quản trị<input v-model="adminToken" type="password" /></label><div class="page-actions"><button class="btn btn-primary" type="submit" :disabled="loading || !form.categoryId">{{ loading ? 'Đang phân tích…' : 'Tìm khoảng trống' }}</button><span class="cell-muted" role="status">{{ stage }}</span></div></form>
      <div v-if="error" class="alert section-gap">{{ error }}</div>
      <template v-if="result"><section class="card section-gap"><header class="card-head"><div><h2 class="card-title">Ngách thị trường</h2><p class="card-sub">{{ result.scope.category.name }} · {{ result.scope.currency }} · {{ result.scope.days }} ngày · {{ result.nicheCount }} ngách</p></div></header><div class="card-body"><div v-if="!result.nicheCount" class="empty">{{ result.diagnostics?.message || 'Chưa đủ dữ liệu để tạo ngách.' }}</div><div v-else class="table-wrap"><table class="data"><thead><tr><th>Ngách</th><th>Mức</th><th>Sản phẩm</th><th>Nhu cầu</th><th>Tăng trưởng</th><th>Shop</th><th>Cơ hội</th><th>Tin cậy</th><th>Trạng thái</th></tr></thead><tbody><tr v-for="niche in pagedNiches" :key="niche.key" class="market-row" @click="openNiche(niche)"><td class="cell-strong">{{ niche.subCategory?.name || 'Toàn danh mục' }}</td><td>{{ niche.analysisLevel }}</td><td>{{ fmt(niche.productCount) }}</td><td>{{ money(niche.marketDemand.estimatedSalesValue) }}</td><td>{{ pct(niche.marketDemand.growthRate) }}</td><td>{{ fmt(niche.marketCompetition.observedVerifiedActiveShopCount) }}</td><td><strong>{{ fmt(niche.opportunityScore) }}</strong><br><small>{{ scoreLabel(niche) }}</small></td><td>{{ fmt(niche.evidenceConfidence) }} / 100</td><td><span class="pill">{{ statusLabel(niche.status) }}</span></td></tr></tbody></table></div><div v-if="totalPages > 1" class="market-pagination"><button class="btn btn-sm" :disabled="page <= 1" @click="page--">Trước</button><span class="cell-muted">{{ page }} / {{ totalPages }}</span><button class="btn btn-sm" :disabled="page >= totalPages" @click="page++">Sau</button></div></div></section></template>
      <section v-if="detail" class="card section-gap"><header class="card-head"><div><h2 class="card-title">{{ detail.subCategory?.name || 'Toàn danh mục' }}</h2><p class="card-sub">Chi tiết ngách, bằng chứng và báo cáo AI.</p></div><button class="icon-btn" type="button" aria-label="Đóng chi tiết ngách" title="Đóng" @click="detail=null"><span aria-hidden="true">×</span></button></header><div class="card-body"><div class="stat-grid"><div class="stat"><div class="stat-label">Điểm cơ hội</div><div class="stat-value">{{ fmt(detail.opportunityScore) }}</div><div class="stat-foot">{{ scoreLabel(detail) }}</div></div><div class="stat"><div class="stat-label">Độ tin cậy</div><div class="stat-value">{{ fmt(detail.evidenceConfidence) }}</div><div class="stat-foot">/ 100</div></div><div class="stat"><div class="stat-label">Nhu cầu ước tính</div><div class="stat-value">{{ money(detail.marketDemand.estimatedSalesValue) }}</div></div><div class="stat"><div class="stat-label">Cạnh tranh quan sát</div><div class="stat-value">{{ fmt(detail.marketCompetition.observedVerifiedActiveShopCount) }}</div><div class="stat-foot">shop</div></div></div><p v-if="detail.opportunityScore===null" class="market-note section-gap">Điểm cơ hội chưa tính được: {{ reasons(detail.missingRequiredMetrics).join('; ') || 'thiếu dữ liệu bắt buộc' }}.</p><div class="grid-2 section-gap"><section><h3 class="card-title">Tiêu chí chấm điểm</h3><div class="table-wrap"><table class="data"><thead><tr><th>Tiêu chí</th><th>Điểm</th><th>Trọng số</th><th>Trạng thái</th></tr></thead><tbody><tr v-for="score in detail.scores" :key="score.criterion"><td>{{ score.criterion }}</td><td>{{ fmt(score.value) }}</td><td>{{ score.weight }}</td><td>{{ score.state }}</td></tr></tbody></table></div></section><section><h3 class="card-title">Độ tin cậy dữ liệu</h3><div class="table-wrap"><table class="data"><thead><tr><th>Thành phần</th><th>Điểm</th></tr></thead><tbody><tr v-for="item in detail.confidenceBreakdown" :key="item.criterion"><td>{{ item.criterion }}</td><td>{{ item.points }} / {{ item.maxPoints }}</td></tr></tbody></table></div></section></div><div class="page-actions section-gap"><button class="btn btn-primary" type="button" :disabled="aiLoading || !detail.evidence?.length" @click="analyzeAi">{{ aiLoading ? 'Đang phân tích AI…' : 'Phân tích chuyên sâu bằng AI' }}</button><span v-if="aiError" class="cell-muted" role="alert">{{ aiError }}</span></div><section v-if="reportsLoading || reports.length" class="section-gap"><h3 class="card-title">Lịch sử báo cáo</h3><div v-if="reportsLoading" class="cell-muted">Đang tải lịch sử…</div><div v-else class="chip-row"><button v-for="report in reports" :key="report.id" class="chip chip-link" type="button" @click="openReport(report)">{{ report.model || 'AI report' }} · {{ report.createdAt || report.id }}</button></div></section><section v-if="aiReport" class="market-ai-report section-gap"><header><div><p class="page-eyebrow">Báo cáo AI</p><h3 class="card-title">{{ aiReportState }}</h3></div></header><div v-if="reportSections.length"><article v-for="(section,index) in reportSections" :key="index" class="report-section"><h4>{{ section.heading }}</h4><div class="report-content" v-html="md(section.content)"></div></article></div><div v-else class="report-content" v-html="md(reportRawText)"></div></section></div></section>
    </section>
  `,
};
