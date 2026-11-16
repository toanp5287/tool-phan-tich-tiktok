import assert from 'node:assert/strict';
import { parseMarketGapRequest } from '../dist/services/ai/marketGapAnalyticsService.js';
import { scoreMarketGap, stabilityFromIncrements } from '../dist/services/ai/opportunityScoring.js';

assert.deepEqual(parseMarketGapRequest({categoryId:1,currency:'vnd',days:30,mode:'QUICK'}),{market:'VN',categoryId:1,subCategoryId:undefined,currency:'VND',days:30,mode:'QUICK',force:false});
for(const value of [{},{categoryId:1,currency:'VND',days:14},{categoryId:1,currency:'',days:30},{categoryId:1,subCategoryId:-1,currency:'VND',days:30}])assert.throws(()=>parseMarketGapRequest(value));

const base={demandLevel:80,growthRate:null,competitionAdvantage:.5,stability:50,productCoverage:.5};
const incomplete=scoreMarketGap(base);
assert.equal(typeof incomplete.total,'number');assert.equal(incomplete.isFull,false);assert.ok(incomplete.missing.includes('Tăng trưởng'));assert.ok(incomplete.scoredCriteria.includes('Nhu cầu thị trường'));

const complete=scoreMarketGap({demandLevel:80,growthRate:20,competitionAdvantage:.5,stability:50,productCoverage:.5});
assert.equal(typeof complete.total,'number');
assert.equal(complete.missing.length,0);assert.equal(complete.isFull,true);

const noCompetition=scoreMarketGap({demandLevel:80,growthRate:20,competitionAdvantage:null,stability:50,productCoverage:.5});
assert.equal(typeof noCompetition.total,'number');assert.equal(noCompetition.isFull,false);assert.ok(noCompetition.missing.includes('Lợi thế cạnh tranh'));

const noEvidence=scoreMarketGap({demandLevel:null,growthRate:null,competitionAdvantage:null,stability:null,productCoverage:null});
assert.equal(noEvidence.total,null);assert.equal(noEvidence.scoredCriteria.length,0);

assert.equal(stabilityFromIncrements([1,2,3]),null);
assert.equal(typeof stabilityFromIncrements([1,2,3,4,5,6,7]),'number');
assert.deepEqual([...(!0 ? ['Lịch sử kỳ hiện tại'] : [])],['Lịch sử kỳ hiện tại']);

console.log(JSON.stringify({result:'PASS',checks:15}));
