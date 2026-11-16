import assert from 'node:assert/strict';

function asItems(value) {
  if (value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function evidenceText(value) {
  if (value === null || value === undefined) return 'Insufficient Data';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (value.statement) return String(value.statement);
    const labels = { metric: 'Chỉ số', value: 'Giá trị', unit: 'Đơn vị', source: 'Nguồn', period: 'Kỳ' };
    return Object.entries(value).map(([key, item]) => `${labels[key] || key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item ?? 'Không đủ dữ liệu')}`).join(' · ');
  }
  if (Array.isArray(value)) return value.map(evidenceText).join(' · ');
  return String(value);
}

function isVietnameseNarrative(value) {
  const commonEnglishWords = /\b(the|and|with|from|this|that|market|product|sales|growth|data|insufficient|evidence|recommendation|forecast|analysis|demand|increased|decreased|shows|strong|weak|high|medium|low)\b/gi;
  return (value.match(commonEnglishWords) ?? []).length < 2;
}

const typeLabels = { FACT: 'SỰ KIỆN', ANALYSIS: 'PHÂN TÍCH', FORECAST: 'DỰ BÁO', RECOMMENDATION: 'ĐỀ XUẤT' };
const confidenceLabels = { HIGH: 'CAO', MEDIUM: 'TRUNG BÌNH', LOW: 'THẤP' };
const statusLabels = { COMPLETED: 'HOÀN THÀNH', RUNNING: 'ĐANG PHÂN TÍCH', FAILED: 'THẤT BẠI' };

assert.deepEqual(asItems('Có 3 snapshot'), ['Có 3 snapshot']);
assert.equal(evidenceText('Có 3 snapshot'), 'Có 3 snapshot');
assert.equal(evidenceText({ metric: 'snapshotDays', value: 3, unit: 'ngày', source: 'ProductSnapshot' }), 'Chỉ số: snapshotDays · Giá trị: 3 · Đơn vị: ngày · Nguồn: ProductSnapshot');
assert.deepEqual(asItems(['Fact A', 'Fact B']), ['Fact A', 'Fact B']);

const sections = ['productOverview', 'demandAnalysis', 'trendIntelligence', 'priceRevenueAnalysis', 'videoAnalysis', 'sellerAnalysis', 'competitiveIntelligence', 'affiliateAnalysis', 'swotRisk', 'forecastStrategy', 'finalConclusion'];
const narrative = 'Nhu cầu tăng theo dữ liệu bán hàng trong kỳ được ghi nhận.';
for (const section of sections) {
  assert.equal(isVietnameseNarrative(narrative), true, `${section} Vietnamese narrative`);
  assert.equal(isVietnameseNarrative('The product shows strong sales growth from market data.'), false, `${section} English narrative`);
}
assert.deepEqual(typeLabels, { FACT: 'SỰ KIỆN', ANALYSIS: 'PHÂN TÍCH', FORECAST: 'DỰ BÁO', RECOMMENDATION: 'ĐỀ XUẤT' });
assert.deepEqual(confidenceLabels, { HIGH: 'CAO', MEDIUM: 'TRUNG BÌNH', LOW: 'THẤP' });
assert.deepEqual(statusLabels, { COMPLETED: 'HOÀN THÀNH', RUNNING: 'ĐANG PHÂN TÍCH', FAILED: 'THẤT BẠI' });
assert.equal(isVietnameseNarrative('Shop ABC bán 125 sản phẩm trong 30 ngày.'), true, 'preserves proper names and figures');
