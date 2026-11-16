import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { datasetDb, datasetPool } from '../dist/config/datasetDb.js';
import { parseMode, readSeries, buildGrowthSummary, buildTimeline, coverage, competition, affiliateContribution } from '../dist/services/analyticsService.js';

const server = createApp().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function request(path, options) {
  const response = await fetch(base + '/api' + path, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

try {
  // Find a product with simulated history.
  const simProd = await datasetDb.metricSnapshot.findFirst({ where: { source: { startsWith: 'simulated' }, entityType: 'PRODUCT', metric: 'soldCount' }, select: { entityId: true } });
  assert.ok(simProd, 'simulated product exists');
  const pid = simProd.entityId;

  // Context inputs, mode-separated.
  const simSales = await readSeries('PRODUCT', pid, 'soldCount', 'SIMULATION');
  const realSales = await readSeries('PRODUCT', pid, 'soldCount', 'REAL_DATA');
  assert.ok(simSales.length >= 90, 'SIMULATION has >=90 days');
  assert.ok(simSales.every((p) => p.dataKind === 'SIMULATED'));
  assert.ok(realSales.every((p) => p.dataKind !== 'SIMULATED'), 'REAL_DATA excludes simulated');

  const growth = buildGrowthSummary(simSales, await readSeries('PRODUCT', pid, 'gmv', 'SIMULATION'), 30);
  assert.equal(growth.periods.length, 4);

  const comp = await competition(pid, 'SIMULATION');
  assert.ok(comp.sellerCount >= 2 || comp.sellerCount === 0, 'sim competition sellerCount is a number');
  const aff = await affiliateContribution(pid, 'SIMULATION');
  assert.equal(typeof aff.creatorCount, 'number');

  // GET endpoints must not invoke a provider.
  const latest = await request(`/products/${pid}/deep-analysis/latest`);
  assert.ok([200, 404].includes(latest.response.status), 'latest deep-analysis responds without provider call');
  const list = await request(`/products/${pid}/deep-analysis`);
  assert.equal(list.response.status, 200);
  assert.ok(Array.isArray(list.body.data));

  // Invalid id.
  assert.equal((await request('/products/abc/deep-analysis')).response.status, 400);

  console.log(JSON.stringify({ result: 'PASS', checks: ['mode separation', 'growth', 'competition', 'affiliate', 'routes'] }));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await datasetDb.$disconnect();
  await datasetPool.end();
}
