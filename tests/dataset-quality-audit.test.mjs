import assert from 'node:assert/strict';
import { QUALITY_CHECKS, qualityState } from '../ops/dataset-quality-audit.mjs';

assert.equal(qualityState(0), 'VALID');
assert.equal(qualityState(2), 'WARNING');
assert.equal(qualityState(1, 'INVALID'), 'INVALID');
assert.equal(qualityState('not-a-count'), 'UNVERIFIED');
assert.deepEqual(QUALITY_CHECKS.map(({ id }) => id), [
  'identity_and_relation_integrity',
  'relation_coverage',
  'observation_time_coverage',
  'source_and_raw_coverage',
  'metric_snapshot_integrity',
]);
for (const { sql } of QUALITY_CHECKS) {
  assert.match(sql, /^SELECT\b/i, 'audit statements must be SELECT-only');
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO)\b/i);
}
console.log('dataset-quality-audit: PASS');
