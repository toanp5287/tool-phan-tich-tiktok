import assert from 'node:assert/strict';
import { datasetDb, datasetPool } from '../dist/config/datasetDb.js';
import {
  buildGrowthSummary,
  buildTimeline,
  competition,
  coverage,
  dataKindFor,
  marketGrowth,
  parseMode,
  readSeries,
  unavailableMetric,
  SIMULATED_SOURCE,
} from '../dist/services/analyticsService.js';

try {
  // Pure helpers.
  assert.equal(parseMode('SIMULATION'), 'SIMULATION');
  assert.equal(parseMode('simulation'), 'SIMULATION');
  assert.equal(parseMode(undefined), 'REAL_DATA');
  assert.equal(parseMode('garbage'), 'REAL_DATA');
  assert.equal(dataKindFor(SIMULATED_SOURCE, false), 'SIMULATED');
  assert.equal(dataKindFor('dataset-v2', false), 'VERIFIED');
  assert.equal(dataKindFor('dataset-v2', true), 'ESTIMATED');
  assert.deepEqual(unavailableMetric().direction, 'unknown');

  // A product with simulated series (mode=SIMULATION).
  const simProd = await datasetDb.metricSnapshot.findFirst({ where: { source: { startsWith: 'simulated' }, entityType: 'PRODUCT', metric: 'soldCount' }, select: { entityId: true } });
  assert.ok(simProd, 'simulated product exists');
  const sales = await readSeries('PRODUCT', simProd.entityId, 'soldCount', 'SIMULATION');
  const gmv = await readSeries('PRODUCT', simProd.entityId, 'gmv', 'SIMULATION');
  const price = await readSeries('PRODUCT', simProd.entityId, 'price', 'SIMULATION');
  assert.equal(sales.length, 90, 'simulated product has 90 days of sales');
  assert.equal(gmv.length, 90);
  assert.equal(price.length, 90);
  assert.ok(sales.every((p) => p.dataKind === 'SIMULATED'));

  // REAL_DATA for the same product must NOT include simulated rows.
  const realSales = await readSeries('PRODUCT', simProd.entityId, 'soldCount', 'REAL_DATA');
  assert.ok(realSales.every((p) => p.source !== 'simulated'), 'REAL_DATA excludes simulated');

  // Coverage.
  const cov = coverage(sales, 90);
  assert.equal(cov.points, 90);
  assert.equal(cov.completeness, 1);
  assert.equal(cov.gaps.length, 0);

  // Growth summary.
  const growth = buildGrowthSummary(sales, gmv, 30);
  assert.equal(growth.periods.length, 4);
  assert.deepEqual(growth.periods.map((p) => p.days), [1, 7, 30, 90]);
  assert.equal(growth.primary.days, 30);
  // Cumulative sales 90 days → 30-day growth should be computable in simulation.
  assert.ok(growth.periods[2].sales.hasData, '30d sales has data');
  // GMV growth must be consistent with sales growth (both non-null or both null baseline).
  if (growth.periods[2].sales.hasBaseline) assert.equal(growth.periods[2].gmv.hasBaseline, true);

  // Timeline aligned.
  const tl = buildTimeline(sales, gmv, price);
  assert.equal(tl.points.length, 90);
  assert.equal(tl.dataKind, 'SIMULATED');
  assert.equal(tl.mode, 'SIMULATION');
  assert.ok(tl.points.every((p) => p.sales !== null && p.gmv !== null && p.price !== null));

  // Market growth (SIMULATION) — sums increments across products without double-counting.
  const market = await marketGrowth('SIMULATION', 30);
  assert.equal(market.periods.length, 4);
  assert.ok(market.periods[2].sales.hasData, 'market 30d sales has data');
  // Sum of daily market increments over 90 days must be finite and non-negative.
  assert.ok(market.periods[3].sales.current !== null && market.periods[3].sales.current >= 0);

  // REAL_DATA market growth should not see simulated rows (may be insufficient baseline).
  const realMarket = await marketGrowth('REAL_DATA', 30);
  assert.equal(realMarket.periods.length, 4);

  // Competition: SIMULATION returns simulated topShopShare/concentration; REAL_DATA keeps null.
  const compSim = await competition(simProd.entityId, 'SIMULATION');
  assert.equal(compSim.mode, 'SIMULATION');
  assert.ok(compSim.sellerCount >= 1, 'sim sellerCount present');
  // Single-seller products legitimately have topShopShare 1.0; null only if no series.
  assert.ok(compSim.topShopShare !== null || compSim.sellerCount === 0, 'sim topShopShare present when sellers exist');
  if (compSim.topShopShare !== null) { assert.ok(compSim.topShopShare >= 0 && compSim.topShopShare <= 1, 'share within 0..1'); }
  const compReal = await competition(simProd.entityId, 'REAL_DATA');
  assert.equal(compReal.mode, 'REAL_DATA');
  assert.equal(compReal.topShopShare, null, 'REAL_DATA never invents topShopShare');
  assert.equal(compReal.concentration, null, 'REAL_DATA never invents concentration');

  console.log(JSON.stringify({ result: 'PASS', checks: ['mode', 'dataKind', 'series', 'coverage', 'growth', 'timeline', 'marketGrowth', 'competition'] }));
} finally {
  await datasetDb.$disconnect();
  await datasetPool.end();
}
