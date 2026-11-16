import assert from 'node:assert/strict';
import { env } from '../dist/config/env.js';
import { buildMockPack, parseAnalysisRequest } from '../dist/services/ai/localMarketAnalysis.js';
import { requestFlexibleProductNarrative } from '../dist/services/ai/marketGeminiAnalysis.js';

const pack = buildMockPack(parseAnalysisRequest({ execution: 'MOCK', entityType: 'PRODUCT', entityId: '1' }).request);
pack.evidence[0].dataKind = 'UNKNOWN';
pack.evidence[0].usageRestriction = 'COMMERCIAL_ALLOWED';

const oldFetch = globalThis.fetch, oldProvider = env.ai.provider, oldEnabled = env.gemini.enabled, oldKey = env.gemini.apiKey;
try {
  env.ai.provider = 'google'; env.gemini.enabled = true; env.gemini.apiKey = 'unit-test-not-a-key';

  // 1. Markdown accepted directly (no JSON schema, no repair).
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '## Tổng quan\n\n**Sản phẩm** có tiềm năng.\n\n- Điểm mạnh\n- Điểm yếu' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }), { status: 200 });
  let result = await requestFlexibleProductNarrative(pack);
  assert.equal(result.report.includes('## Tổng quan'), true);
  assert.equal(result.report.includes('**Sản phẩm**'), true);

  // 2. Plain text short.
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Sản phẩm có tiềm năng tăng trưởng.' }] } }] }), { status: 200 });
  result = await requestFlexibleProductNarrative(pack);
  assert.equal(result.report, 'Sản phẩm có tiềm năng tăng trưởng.');

  // 3. Multi-line text (447-char style).
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Dòng 1\nDòng 2\nDòng 3' }] } }] }), { status: 200 });
  result = await requestFlexibleProductNarrative(pack);
  assert.ok(result.report.includes('\n'));

  // 4. JSON object with report field.
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ report: 'Nội dung từ JSON', optional: 1 }) }] } }] }), { status: 200 });
  result = await requestFlexibleProductNarrative(pack);
  assert.ok(result.report.length > 0);

  // 5. Empty string rejected.
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '   ' }] } }] }), { status: 200 });
  await assert.rejects(requestFlexibleProductNarrative(pack), e => ['AI_INVALID_RESPONSE', 'AI_EMPTY_RESPONSE'].includes(e.code));

  // 6. Provider HTTP error.
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 });
  await assert.rejects(requestFlexibleProductNarrative(pack), e => e.code === 'AI_INVALID_REQUEST');

  console.log(JSON.stringify({ result: 'PASS', cases: 6, realProviderRequests: 0 }));
} finally {
  globalThis.fetch = oldFetch; env.ai.provider = oldProvider; env.gemini.enabled = oldEnabled; env.gemini.apiKey = oldKey;
}
