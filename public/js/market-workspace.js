import { renderMarkdown, normalizeReport } from "./markdown.js";
import { injectShell } from "./shell.js";

const request = async (path, options = {}) => {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok || !body.success) throw Error(body.error?.message || `API lỗi ${response.status}`);
  return body.data;
};

const STATUS_LABELS = {
  HIGH_POTENTIAL: 'Tiềm năng cao',
  POSITIVE_SIGNAL: 'Có tín hiệu tích cực',
  HIGH_COMPETITION: 'Cạnh tranh cao',
  WATCH: 'Cần theo dõi thêm',
  INSUFFICIENT_DATA: 'Chưa đủ dữ liệu',
};
const STATUS_CLASS = {
  HIGH_POTENTIAL: 'b-high',
  POSITIVE_SIGNAL: 'b-signal',
  HIGH_COMPETITION: 'b-competition',
  WATCH: 'b-watch',
  INSUFFICIENT_DATA: 'b-insufficient',
};
const ANALYSIS_LEVELS = { PRELIMINARY: 'Sơ bộ', EXTENDED: 'Mở rộng', FULL: 'Đầy đủ' };
const METRIC_STATES = { AVAILABLE: 'Có dữ liệu', INSUFFICIENT_DATA: 'Thiếu dữ liệu', INSUFFICIENT_HISTORY: 'Thiếu lịch sử', NOT_APPLICABLE: 'Không áp dụng' };

Vue.createApp({
  data() {
    return {
      categories: [], currencies: ['VND'], capabilities: null,
      form: { categoryId: null, subCategoryId: null, currency: 'VND', days: 30, mode: 'QUICK' },
      adminToken: '', requiresToken: false, loading: false, error: '', stage: '',
      result: null, detail: null, page: 1, pageSize: 10,
      aiLoading: false, aiError: '', aiStage: 'Đang chuẩn bị bằng chứng…', aiReport: null, aiReportState: '',
    };
  },
  computed: {
    selectedCategory() { return this.categories.find(c => c.id === this.form.categoryId) || null; },
    totalPages() { return Math.max(1, Math.ceil((this.result?.niches?.length || 0) / this.pageSize)); },
    pagedNiches() {
      const list = this.result?.niches || [];
      const start = (this.page - 1) * this.pageSize;
      return list.slice(start, start + this.pageSize);
    },
    normalizedReport() { return normalizeReport(this.aiReport); },
    reportTitle() { return this.normalizedReport.title || (this.detail?.subCategory?.name ? `Báo cáo phân tích thị trường – ${this.detail.subCategory.name}` : 'Báo cáo phân tích thị trường'); },
    reportSections() { return this.normalizedReport.sections || []; },
    reportHasStructuredSections() { return this.reportSections.length > 0; },
    reportRawText() { return this.normalizedReport.raw || ''; },
    reportKpis() {
      if (!this.detail) return [];
      const d = this.detail;
      return [
        { label: 'Opportunity Score', value: d.opportunityScore, kind: d.opportunityScoreKind || 'UNKNOWN', isScore: true },
        { label: 'Confidence', value: d.evidenceConfidence, suffix: '/ 100', kind: 'CONFIDENCE' },
        { label: 'Giá trị bán ước tính', value: d.marketDemand?.estimatedSalesValue, money: true, kind: 'ESTIMATED' },
        { label: 'Sản phẩm quan sát', value: d.productCount, kind: 'COUNT' },
        { label: 'Shop quan sát', value: d.marketCompetition?.observedVerifiedActiveShopCount, kind: 'COUNT' },
      ].filter(k => k.value !== null && k.value !== undefined);
    },
  },
  async mounted() {
    try {
      const [capabilities, categories] = await Promise.all([request('/api/market-intelligence/capabilities'), request('/api/categories')]);
      this.capabilities = capabilities;
      this.categories = categories.categories || [];
      this.currencies = categories.currencies || ['VND'];
      if (!this.currencies.includes(this.form.currency)) this.form.currency = this.currencies[0];
    } catch (error) { this.error = error.message; }
  },
  methods: {
    fmt(value) { return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value) : '—'; },
    money(value) { return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: this.form.currency, maximumFractionDigits: 0 }).format(value) : '—'; },
    pct(value) { return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 }).format(value) : '—'; },
    statusLabel(status) { return STATUS_LABELS[status] || status; },
    badgeClass(status) { return STATUS_CLASS[status] || 'b-insufficient'; },
    analysisLevel(level) { return ANALYSIS_LEVELS[level] || level || '—'; },
    metricState(state) { return METRIC_STATES[state] || state || '—'; },
    scoreLabel(niche) { return niche.opportunityScoreKind === 'FULL' ? 'Điểm cơ hội đầy đủ' : niche.opportunityScoreKind === 'PRELIMINARY' ? 'Điểm cơ hội sơ bộ' : 'Điểm cơ hội'; },
    md(text) { return renderMarkdown(text || ''); },
    kpiLabel(kpi) { return kpi.kind === 'PRELIMINARY' ? 'Điểm sơ bộ' : kpi.kind === 'FULL' ? 'Điểm đầy đủ' : kpi.kind === 'ESTIMATED' ? 'Ước tính' : kpi.kind === 'CONFIDENCE' ? 'Độ tin cậy' : kpi.kind === 'COUNT' ? 'Thực tế' : ''; },
    kpiValue(kpi) { if (kpi.isScore && kpi.value === null) return 'Chưa đủ dữ liệu'; if (kpi.money) return this.money(kpi.value); return this.fmt(kpi.value); },
    reasons(value) { return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : typeof value === 'string' && value.trim() ? [value] : []; },
    categoryChanged() { this.form.subCategoryId = null; },
    async analyze() {
      if (this.loading || !this.form.categoryId) return;
      this.loading = true; this.error = ''; this.result = null; this.detail = null; this.page = 1;
      this.stage = 'Đang phân tích ngách từ PostgreSQL…';
      try {
        const data = await request('/api/market-intelligence/market-gaps/analyses', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.adminToken ? { 'x-admin-token': this.adminToken } : {}) }, body: JSON.stringify(this.form) });
        this.result = { ...data.result, analysisId: data.analysisId };
        if (data.cache.hit) this.stage = 'Đã dùng kết quả đã lưu.';
        else if (data.result.nicheCount === 0) this.stage = data.result.diagnostics?.message || 'Không tìm thấy ngách phù hợp với điều kiện đã chọn.';
        else this.stage = 'Đã hoàn tất phân tích cấp 1; không gọi AI.';
      } catch (error) {
        if (error.message.includes('Token quản trị')) this.requiresToken = true;
        this.error = error.message; this.stage = 'Không hoàn tất.';
      } finally { this.loading = false; }
    },
    async openNiche(niche) {
      this.aiError = ''; this.aiReport = null; this.aiReportState = '';
      if (!this.result?.analysisId) { this.error = 'Kết quả này chưa được lưu nên không thể mở chi tiết.'; return; }
      try {
        const detail = await request(`/api/market-intelligence/market-gaps/analyses/${this.result.analysisId}/niches/${niche.key}`);
        this.detail = detail;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) { this.error = error.message; }
    },
    async analyzeAi() {
      if (this.aiLoading || !this.detail || !this.result?.analysisId || !this.detail.evidence?.length) return;
      if (!window.confirm('Gửi bằng chứng của ngách đã chọn đến AI để phân tích chuyên sâu? Có thể phát sinh phí.')) return;
      this.aiLoading = true; this.aiError = ''; this.aiStage = 'Đang chuẩn bị bằng chứng…';
      try {
        this.aiStage = 'Đang phân tích bằng AI…';
        const data = await request('/api/market-intelligence/market-gaps/ai-analyses', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.adminToken ? { 'x-admin-token': this.adminToken } : {}) }, body: JSON.stringify({ analysisId: this.result.analysisId, nicheKey: this.detail.key, confirmProviderCall: true }) });
        this.aiStage = data.execution === 'CACHED' ? 'Đang hiển thị báo cáo đã lưu…' : 'Đang tạo báo cáo…';
        this.aiReport = data.report;
        this.aiReportState = data.execution === 'CACHED' ? 'Đang hiển thị báo cáo đã lưu theo cùng bộ bằng chứng.' : 'Báo cáo đã được lưu để xem lại mà không cần gọi AI lần nữa.';
        this.stage = 'Phân tích AI hoàn tất.';
      } catch (error) { this.aiError = error.message; }
      finally { this.aiLoading = false; }
    },
  },
}).mount('#app');

const root = document.getElementById('app');
if (root) injectShell(root);
