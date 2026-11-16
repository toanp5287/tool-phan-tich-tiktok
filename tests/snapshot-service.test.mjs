import assert from 'node:assert/strict';
import 'dotenv/config';
import { datasetDb as db, datasetPool } from '../dist/config/datasetDb.js';
import { dailyIncrements, growthRate, readMetricSeries } from '../dist/services/snapshotService.js';

// Unit: daily increments for a cumulative metric.
assert.deepEqual(dailyIncrements([
  { date: '2025-07-01', value: 100 },
  { date: '2025-07-02', value: 130 },
  { date: '2025-07-03', value: 130 },
  { date: '2025-07-04', value: 150 },
]), [
  { date: '2025-07-01', value: null },  // no baseline
  { date: '2025-07-02', value: 30 },
  { date: '2025-07-03', value: 0 },
  { date: '2025-07-04', value: 20 },
]);

// Anomalous decrease -> null, never negative sales.
assert.deepEqual(dailyIncrements([
  { date: '2025-07-01', value: 100 },
  { date: '2025-07-02', value: 50 },   // reset/anomaly
]), [
  { date: '2025-07-01', value: null },
  { date: '2025-07-02', value: null },
]);

// growthRate requires >= 2 valid points and non-zero baseline.
assert.equal(growthRate([{ date: 'a', value: 100 }, { date: 'b', value: 150 }], 7), 0.5);
assert.equal(growthRate([{ date: 'a', value: 100 }], 7), null);
assert.equal(growthRate([{ date: 'a', value: 0 }, { date: 'b', value: 10 }], 7), null);

// Integration: a video with dated snapshots has real multi-day history.
const vid = await db.metricSnapshot.findFirst({ where: { entityType: 'VIDEO', metric: 'views' }, select: { entityId: true } });
assert.ok(vid, 'a video snapshot exists');
const series = await readMetricSeries('VIDEO', vid.entityId, 'views');
assert.ok(series.length >= 1, `video views series has ${series.length} points`);
for (const point of series) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(point.date));

// Integration: a product has a baseline snapshot (honest start, not fabricated 90 days).
const prod = await db.metricSnapshot.findFirst({ where: { entityType: 'PRODUCT', metric: 'soldCount' }, select: { entityId: true } });
assert.ok(prod, 'a product baseline snapshot exists');
const prodSeries = await readMetricSeries('PRODUCT', prod.entityId, 'soldCount');
assert.ok(prodSeries.length <= 3, 'product history is a fresh baseline, not fabricated 90 days');

await db.$disconnect();
await datasetPool.end();
console.log(JSON.stringify({ result: 'PASS', videoSeries: series.length, productSeries: prodSeries.length }));
