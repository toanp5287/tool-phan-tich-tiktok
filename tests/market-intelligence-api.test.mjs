import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { datasetDb, datasetPool } from '../dist/config/datasetDb.js';

const server = createApp().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function get(path) {
  const response = await fetch(base + '/api/market-intelligence' + path);
  const body = await response.json().catch(() => null);
  return { response, body };
}

try {
  // SIMULATION: has 90-day history → scored niches.
  const sim = await get('/opportunities?mode=simulation&days=30&pageSize=10');
  assert.equal(sim.response.status, 200);
  assert.equal(sim.body.success, true);
  assert.equal(sim.body.data.mode, 'SIMULATION');
  assert.ok(sim.body.data.total > 0, 'SIMULATION has scored niches');
  assert.ok(sim.body.data.items.length <= 10);
  assert.ok(sim.body.data.items.every((n) => n.limitation.includes('SIMULATED')));

  // REAL_DATA: 1-day history → insufficient, no false high scores.
  const real = await get('/opportunities?mode=real_data&days=30&pageSize=10');
  assert.equal(real.body.data.mode, 'REAL_DATA');
  assert.ok(real.body.data.items.every((n) => !n.limitation.includes('SIMULATED')));
  // REAL_DATA must not fabricate a score: any scored niche must have sufficient core data.
  for (const n of real.body.data.items) {
    assert.ok(n.opportunityScore === null || n.opportunityScore >= 0 && n.opportunityScore <= 100);
    if (n.opportunityScore !== null) assert.notEqual(n.classification, 'INSUFFICIENT_DATA', 'scored niche must not be INSUFFICIENT_DATA');
  }

  // Market filter.
  const vn = await get('/opportunities?mode=simulation&market=VN&days=30&pageSize=100');
  assert.ok(vn.body.data.market === 'VN');
  assert.ok(vn.body.data.items.every((n) => n.name && typeof n.name === 'string'));

  // minScore filter.
  const high = await get('/opportunities?mode=simulation&days=30&minScore=70&pageSize=100');
  assert.ok(high.body.data.items.every((n) => (n.opportunityScore ?? 0) >= 70));

  // Invalid mode → defaults REAL_DATA (parseMode) — just verify no crash.
  const invalid = await get('/opportunities?mode=garbage&days=30');
  assert.equal(invalid.response.status, 200);

  // Pagination: page 1 and 2 disjoint.
  const p1 = await get('/opportunities?mode=simulation&days=30&pageSize=5&page=1');
  const p2 = await get('/opportunities?mode=simulation&days=30&pageSize=5&page=2');
  assert.ok(!p2.body.data.items.some((x) => p1.body.data.items.some((y) => y.key === x.key)));

  console.log(JSON.stringify({ result: 'PASS', checks: ['simulation', 'real_data', 'isolation', 'market', 'minScore', 'invalid', 'pagination'] }));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await datasetDb.$disconnect();
  await datasetPool.end();
}
