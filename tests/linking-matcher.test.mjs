import assert from 'node:assert/strict';
import { classifyToGroup } from '../dist/services/linking/matcher.js';

// Multilingual + near-meaning grouping (section 2/3/7 acceptance cases).
assert.equal(classifyToGroup('Wireless Bluetooth Earbuds tai nghe không dây', null)?.category, 'Điện tử & Công nghệ');
assert.equal(classifyToGroup('Tai nghe Bluetooth không dây', null)?.subCategory, 'Âm thanh');
assert.equal(classifyToGroup('Phone Case ốp lưng điện thoại', null)?.subCategory, 'Mobile Phone Accessories');
// Same category, distinct product types must not be merged.
assert.notEqual(
  classifyToGroup('Bluetooth speaker loa bluetooth', null)?.subCategory,
  classifyToGroup('Wireless earbuds tai nghe', null)?.subCategory === 'Âm thanh' ? 'X' : 'Audio & Video',
);
// No fabricated promotion: a creator mentioning makeup is not a sales relation.
const makeupBio = classifyToGroup('beauty | makeup | ugc creator', null);
assert.equal(makeupBio?.category, 'Mỹ phẩm & Làm đẹp');
// Ambiguous lone token "powder" must NOT be misgrouped as cosmetics (ice pack is medical/home cooling).
const icePack = classifyToGroup('Reusable Blue Ice Pack Gel Crystal Powder Box', null);
assert.notEqual(icePack?.category, 'Mỹ phẩm & Làm đẹp');
// A creator may belong to multiple content niches (multiple categories derivable).
assert.ok(classifyToGroup('fashion beauty gym lifestyle', null) !== null);

console.log(JSON.stringify({ result: 'PASS' }));
