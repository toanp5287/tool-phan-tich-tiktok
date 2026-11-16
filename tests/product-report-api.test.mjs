import assert from 'node:assert/strict';
import { env } from '../dist/config/env.js';
import { createApp } from '../dist/app.js';
import { datasetDb as db, datasetPool } from '../dist/config/datasetDb.js';

// Pick a real product to exercise the full endpoint path with a mocked provider.
const product = await db.product.findFirst({ where: { market: 'VN' }, orderBy: { id: 'asc' }, select: { id: true } });
assert.ok(product, 'need a VN product');

const server = createApp().listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const oldFetch = globalThis.fetch, oldProvider = env.ai.provider, oldEnabled = env.gemini.enabled, oldKey = env.gemini.apiKey;
const MARKDOWN = '## Tổng quan\n\n**Sản phẩm** có tiềm năng.\n\n- Điểm mạnh A\n- Điểm yếu B';
try {
  env.ai.provider = 'google'; env.gemini.enabled = true; env.gemini.apiKey = 'unit-test-not-a-key';
  globalThis.fetch = async (url, ...args) => {
    if (String(url).startsWith(origin)) return oldFetch(url, ...args);
    // Mock Gemini generateContent
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: MARKDOWN }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 } }), { status: 200 });
  };

  const headers = { 'Content-Type': 'application/json', ...(env.adminToken ? { 'x-admin-token': env.adminToken } : {}) };
  const response = await fetch(`${origin}/api/products/${product.id}/ai-analysis`, { method: 'POST', headers, body: JSON.stringify({ days: 30, force: true }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.persisted, true);
  assert.equal(body.data.status, 'COMPLETED');
  assert.equal(body.data.format, 'markdown');
  assert.equal(body.data.report, MARKDOWN);
  const reportId = body.data.id;
  assert.ok(reportId);

  // Read back from database via GET endpoint (no provider call).
  const readback = await fetch(`${origin}/api/ai-analysis/${reportId}`, { headers: { Accept: 'application/json' } });
  const readBody = await readback.json();
  assert.equal(readBody.success, true);
  assert.equal(readBody.data.report, MARKDOWN);
  assert.equal(readBody.data.format, 'markdown');

  // Latest endpoint also returns it.
  const latest = await fetch(`${origin}/api/products/${product.id}/ai-analysis/latest`);
  const latestBody = await latest.json();
  assert.equal(latestBody.success, true);
  assert.equal(latestBody.data.report, MARKDOWN);

  console.log(JSON.stringify({ result: 'PASS', productId: product.id, reportId, realProviderRequests: 0, persistenceVerified: true }));
} finally {
  globalThis.fetch = oldFetch; env.ai.provider = oldProvider; env.gemini.enabled = oldEnabled; env.gemini.apiKey = oldKey;
  await new Promise(r => server.close(r));
  await db.$disconnect();
  await datasetPool.end();
}
