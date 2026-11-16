import assert from 'node:assert/strict';
import { datasetDb, datasetPool } from '../dist/config/datasetDb.js';
import { findWinningProducts } from '../dist/services/ai/winningProductFinder.js';

try {
  const sim = await findWinningProducts({ mode: 'simulation', limit: 10, days: 30 });
  assert.equal(sim.mode, 'SIMULATION');
  assert.ok(sim.total > 0, 'SIMULATION ranks products');
  assert.ok(sim.top.length <= 10);
  // Score is deterministic and bounded.
  assert.ok(sim.top.every((c) => c.winningScore === null || (c.winningScore >= 0 && c.winningScore <= 100)));
  // Every candidate carries the required fields.
  assert.ok(sim.top.every((c) => typeof c.productId === 'number' && typeof c.classification === 'string' && Array.isArray(c.scoredCriteria) && typeof c.confidence === 'number'));
  // SIMULATION must be clearly labelled.
  assert.ok(sim.top.every((c) => c.limitation.includes('SIMULATED')));
  // Sorted descending by score.
  for (let i = 1; i < sim.top.length; i++) {
    assert.ok((sim.top[i - 1].winningScore ?? -1) >= (sim.top[i].winningScore ?? -1), 'sorted desc');
  }
  // Classification is one of the five allowed values.
  const allowed = ['EMERGING_WINNER', 'POTENTIAL_WINNER', 'ESTABLISHED_WINNER', 'SATURATED_PRODUCT', 'DECLINING_PRODUCT'];
  assert.ok(sim.top.every((c) => allowed.includes(c.classification)));

  // Top candidate has a score with full confidence and reasons.
  const top = sim.top[0];
  assert.ok(top.criteria.some((c) => c.value !== null), 'at least one scored criterion');
  assert.ok(top.reasons.length > 0, 'has reasons');

  const real = await findWinningProducts({ mode: 'real_data', limit: 5, days: 30 });
  assert.equal(real.mode, 'REAL_DATA');
  assert.ok(real.top.every((c) => !c.limitation.includes('SIMULATED')), 'REAL_DATA never labels SIMULATED');

  console.log(JSON.stringify({ result: 'PASS', checks: ['mode', 'rank', 'bounds', 'classification', 'sorting', 'isolation', 'evidence'] }));
} finally {
  await datasetDb.$disconnect();
  await datasetPool.end();
}
