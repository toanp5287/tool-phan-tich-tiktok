import assert from 'node:assert/strict';
import { normalizeProductContent } from '../dist/services/ai/productReportCompatibility.js';

// 1. Markdown full
const fullMd = normalizeProductContent('## Tổng quan\n\n**Sản phẩm** bán tốt.\n\n- Điểm mạnh\n- Điểm yếu\n\n| Chỉ số | Giá trị |\n|---|---|\n| GMV | 10 |');
assert.equal(fullMd.format, 'markdown');
assert.ok(fullMd.content.includes('## Tổng quan'));

// 2. Markdown short
const shortMd = normalizeProductContent('**Kết luận:** nhu cầu tăng.');
assert.equal(shortMd.format, 'markdown');
assert.ok(shortMd.content.length > 0);

// 3. plain text
const plain = normalizeProductContent('Sản phẩm có tiềm năng tăng trưởng.');
assert.equal(plain.format, 'text');
assert.equal(plain.content, 'Sản phẩm có tiềm năng tăng trưởng.');

// 4. valid JSON (report field extracted as plain text)
const json = normalizeProductContent({ report: 'Nội dung JSON', strengths: ['a'] });
assert.equal(json.format, 'text'); // extracted the "report" string field
assert.equal(json.content, 'Nội dung JSON');

// 5. JSON missing optional fields (no report/text field -> pretty JSON)
const jsonNoFields = normalizeProductContent({ someKey: 'value', other: 123 });
assert.equal(jsonNoFields.format, 'json');
assert.ok(jsonNoFields.content.includes('"someKey"'));
assert.ok(jsonNoFields.content.includes('"other"'));

// 6. string with newlines
const multiline = normalizeProductContent('Dòng 1\nDòng 2\nDòng 3');
assert.equal(multiline.format, 'markdown');
assert.ok(multiline.content.includes('\n'));

// 7. markdown table
const table = normalizeProductContent('| A | B |\n|---|---|\n| 1 | 2 |');
assert.equal(table.format, 'markdown');
assert.ok(table.content.includes('|'));

// 8. ~447 chars text
const chars447 = 'a'.repeat(447);
const long = normalizeProductContent(chars447);
assert.equal(long.format, 'text');
assert.equal(long.content.length, 447);

// 9. empty string -> null
assert.equal(normalizeProductContent(''), null);
assert.equal(normalizeProductContent('   '), null);

// 10. null -> null
assert.equal(normalizeProductContent(null), null);
assert.equal(normalizeProductContent(undefined), null);

// 12. truncated JSON (unbalanced) still yields text content
const truncated = normalizeProductContent('{"report": "bị cắt');
assert.equal(truncated.format, 'text');
assert.equal(truncated.content, '{"report": "bị cắt');

// JSON with code fence wrapper
const fenced = normalizeProductContent('```markdown\n## Tiêu đề\n```');
assert.equal(fenced.format, 'markdown');
assert.equal(fenced.content, '## Tiêu đề');

// '{}' and '[]' are rejected as empty
assert.equal(normalizeProductContent('{}'), null);
assert.equal(normalizeProductContent('[]'), null);

console.log(JSON.stringify({ result: 'PASS', cases: 18 }));
