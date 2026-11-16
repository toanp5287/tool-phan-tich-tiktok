import assert from 'node:assert/strict';
import { datasetDb, datasetPool } from '../dist/config/datasetDb.js';
import { simulateSeries, simulateCompetition, scenarioForKey, GENERATION_VERSION } from '../dist/services/simulation/simulationEngine.js';

try {
  // Deterministic + idempotent.
  const end = new Date('2026-11-11T00:00:00Z');
  const a1 = simulateSeries({ scenario: 'RAPID_GROWTH', anchorSold: 1000, anchorPrice: 50 }, 90, end, 'product:1');
  const a2 = simulateSeries({ scenario: 'RAPID_GROWTH', anchorSold: 1000, anchorPrice: 50 }, 90, end, 'product:1');
  assert.deepEqual(a1, a2, 'deterministic / idempotent');
  assert.equal(a1.length, 90, '90 days');
  assert.equal(a1.at(-1).soldCount, 1000, 'final cumulative sold == anchor');
  assert.equal(a1.at(-1).price, 50, 'final price == anchor');

  // Metric consistency: cumulative GMV == soldCount × volume-weighted average price.
  const last = a1.at(-1);
  const volumeWeightedAsp = a1.reduce((sum, p) => sum + p.dailyUnits * p.price, 0) / last.soldCount;
  const approx = last.soldCount * volumeWeightedAsp;
  assert.ok(Math.abs(last.gmv - approx) < 1, `gmv consistent (${last.gmv} vs ${approx})`);

  // Scenario coverage: every scenario produces a non-decreasing cumulative sold series.
  for (const scenario of ['EMERGING', 'RAPID_GROWTH', 'STABLE', 'SEASONAL', 'DECLINING', 'SATURATED']) {
    const s = simulateSeries({ scenario, anchorSold: 500, anchorPrice: 20 }, 90, end, 'p:' + scenario);
    let prev = 0;
    for (const p of s) { assert.ok(p.soldCount >= prev, `${scenario} non-decreasing`); prev = p.soldCount; }
    assert.equal(s.at(-1).soldCount, 500, `${scenario} final anchor`);
  }

  // Competition: shares sum to 1, top share == max, HHI == sum of squares.
  const comp = simulateCompetition([101, 102, 103], 90, end, 'product:9');
  assert.equal(comp.length, 90);
  for (const p of comp) {
    const sum = p.shares.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.01, `shares sum to 1 (${sum})`);
    assert.ok(Math.abs(p.topShopShare - Math.max(...p.shares)) < 0.01, 'top share == max');
    const hhi = p.shares.reduce((a, b) => a + b * b, 0);
    assert.ok(Math.abs(p.hhi - hhi) < 0.01, 'HHI == sum of squares');
  }
  // Single-shop: share == 1.
  const single = simulateCompetition([42], 90, end, 'product:10');
  assert.equal(single[0].topShopShare, 1);
  assert.equal(single[0].hhi, 1);

  // DB: simulated rows exist, all correctly marked, no overwrite of verified.
  const simCount = await datasetDb.metricSnapshot.count({ where: { source: 'simulated' } });
  assert.ok(simCount > 0, 'simulated rows present');
  const verifiedCount = await datasetDb.metricSnapshot.count({ where: { source: { in: ['dataset-v2', 'vitied'] } } });
  assert.ok(verifiedCount >= 135281, 'verified rows untouched');

  console.log(JSON.stringify({ result: 'PASS', checks: ['determinism', '90d coverage', 'metric consistency', 'scenarios', 'competition shares', 'separation'] }));
} finally {
  await datasetDb.$disconnect();
  await datasetPool.end();
}
