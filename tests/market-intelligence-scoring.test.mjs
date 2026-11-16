import assert from 'node:assert/strict';
import {
  scoreOpportunity,
  logScaleScore,
  growthScore,
  competitionGapScore,
  stabilityScore,
  creatorOpportunityScore,
} from '../dist/services/marketIntelligence/opportunityScoringEngine.js';
import { classifyOpportunity, competitionLevel } from '../dist/services/marketIntelligence/opportunityClassification.js';

// Pure scoring engine tests.
const full = [
  { key: 'demand', label: 'Market Demand', weight: 20, value: 80, formula: 'x' },
  { key: 'growth', label: 'Growth Momentum', weight: 20, value: 90, formula: 'x' },
  { key: 'competition', label: 'Competition Gap', weight: 20, value: 70, formula: 'x' },
  { key: 'commercial', label: 'Commercial Potential', weight: 15, value: 60, formula: 'x' },
  { key: 'creator', label: 'Creator Opportunity', weight: 10, value: 50, formula: 'x' },
  { key: 'stability', label: 'Market Stability', weight: 10, value: 55, formula: 'x' },
  { key: 'confidence', label: 'Data Confidence', weight: 5, value: null, formula: 'x' },
];
const fullResult = scoreOpportunity(full);
assert.equal(fullResult.isInsufficient, false, 'full criteria not insufficient');
assert.equal(fullResult.missing.length, 1, 'only confidence missing');
assert.ok(fullResult.total !== null && fullResult.total >= 0 && fullResult.total <= 100);
// Weighted avg ignoring confidence: (80*20+90*20+70*20+60*15+50*10+55*10)/(20+20+20+15+10+10) = (1600+1800+1400+900+500+550)/95 = 6750/95 = 71.05 → 71
assert.equal(fullResult.total, 71);

// Missing 2 core criteria → insufficient.
const missingCore = [
  { key: 'demand', label: 'Market Demand', weight: 20, value: null, formula: 'x' },
  { key: 'growth', label: 'Growth Momentum', weight: 20, value: null, formula: 'x' },
  { key: 'competition', label: 'Competition Gap', weight: 20, value: 70, formula: 'x' },
  { key: 'commercial', label: 'Commercial Potential', weight: 15, value: 60, formula: 'x' },
];
assert.equal(scoreOpportunity(missingCore).isInsufficient, true, '2 missing core → insufficient');

// All null → null total, insufficient.
assert.equal(scoreOpportunity(full.map((c) => ({ ...c, value: null }))).total, null);

// Helpers.
assert.equal(logScaleScore(0), null, 'zero sales → null demand');
assert.equal(logScaleScore(null), null);
assert.ok(logScaleScore(1000) !== null && logScaleScore(1000) > 0);
assert.equal(growthScore(null), null);
assert.equal(growthScore(50), 100);
assert.equal(competitionGapScore(null), null);
assert.equal(competitionGapScore(0.6), 40);
assert.equal(stabilityScore([1, 2, 3]), null, '<7 increments → null');
assert.equal(stabilityScore([10, 10, 10, 10, 10, 10, 10, 10]), 100, 'zero variance → 100');
assert.equal(creatorOpportunityScore(0, 80), 80, 'no creator + high demand → high');
assert.ok(creatorOpportunityScore(20, 80) < 80, 'many creators → lower');

// Classification.
assert.equal(classifyOpportunity({ score: null, confidence: 0, isInsufficient: true, growthRate: null, competitionLevel: 'UNKNOWN', topShopShare: null }).classification, 'INSUFFICIENT_DATA');
assert.equal(classifyOpportunity({ score: 50, confidence: 80, isInsufficient: false, growthRate: 0, competitionLevel: 'HIGH', topShopShare: 0.7 }).classification, 'SATURATED_MARKET');
assert.equal(classifyOpportunity({ score: 50, confidence: 80, isInsufficient: false, growthRate: -20, competitionLevel: 'MODERATE', topShopShare: 0.3 }).classification, 'DECLINING_MARKET');
assert.equal(classifyOpportunity({ score: 80, confidence: 80, isInsufficient: false, growthRate: 30, competitionLevel: 'LOW', topShopShare: 0.1 }).classification, 'EMERGING_WINNER');
assert.equal(classifyOpportunity({ score: 60, confidence: 80, isInsufficient: false, growthRate: 10, competitionLevel: 'MODERATE', topShopShare: 0.3 }).classification, 'POTENTIAL_WINNER');
assert.equal(classifyOpportunity({ score: 45, confidence: 80, isInsufficient: false, growthRate: 5, competitionLevel: 'MODERATE', topShopShare: 0.3 }).classification, 'ESTABLISHED_WINNER');

assert.equal(competitionLevel(0.7, 5), 'SATURATED');
assert.equal(competitionLevel(0.5, 5), 'HIGH');
assert.equal(competitionLevel(0.3, 5), 'MODERATE');
assert.equal(competitionLevel(0.1, 5), 'LOW');
assert.equal(competitionLevel(null, 0), 'UNKNOWN');

console.log(JSON.stringify({ result: 'PASS', checks: ['score', 'missing', 'null', 'helpers', 'classification', 'competitionLevel'] }));
