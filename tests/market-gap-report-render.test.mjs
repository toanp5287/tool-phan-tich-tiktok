import assert from 'node:assert/strict';
import { renderMarkdown, normalizeReport } from '../public/js/markdown.js';

// Fetch the real Home Care Supplies report from the DB.
import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.NEW_DATABASE_URL });
await c.connect();
const row = await c.query(`SELECT "report" FROM "MarketGapAiReport" WHERE "report"->>'content' LIKE '%HOME CARE SUPPLIES%' ORDER BY id DESC LIMIT 1`);
await c.end();
assert.ok(row.rows.length, 'need the Home Care Supplies report in DB');

const aiReport = row.rows[0].report; // { version, format, content, limitations }
const normalized = normalizeReport(aiReport);

// 1. JSON parsed successfully
assert.equal(normalized.format, 'json');
// 2. title
assert.ok(normalized.title.includes('HOME CARE SUPPLIES'), `title=${normalized.title}`);
// 6. 10 sections in order
assert.equal(normalized.sections.length, 10, `sections=${normalized.sections.length}`);
const headings = normalized.sections.map(s => s.heading.replace(/^#+\s*/, ''));
assert.deepEqual(headings, ['Tổng quan', 'Dữ kiện từ dữ liệu', 'Phân tích sản phẩm', 'Phân tích shop và cạnh tranh', 'Xu hướng', 'Cơ hội', 'Rủi ro', 'Dữ liệu còn thiếu', 'Khuyến nghị', 'Kết luận']);

// 3/4. Opportunity Score 29, Confidence 52 present in overview text
const overview = normalized.sections[0].content;
assert.ok(/29/.test(overview), 'opportunity score 29');
assert.ok(/52/.test(overview), 'confidence 52');
// 5. estimated sales value
const facts = normalized.sections[1].content;
assert.ok(/23\.990\.733/.test(facts), 'estimated sales value');

// 7. Markdown renders nicely (no raw ## / **)
const html = renderMarkdown(normalized.sections[1].content);
assert.ok(!html.includes('##'), 'no raw heading markers');
assert.ok(!html.includes('**'), 'no raw bold markers');
assert.ok(html.includes('<li>'), 'renders list items');
assert.ok(html.includes('<strong>'), 'renders bold');

// 8. no raw JSON shown (content was JSON string, now structured)
assert.ok(!normalized.raw.startsWith('{:'), 'raw JSON not surfaced');

// 10. plain markdown report fallback
const mdReport = { version: 'market-gap-markdown-v1', format: 'markdown', content: '## Tổng quan\n\n**Điểm mạnh** của ngách.\n\n- A\n- B', limitations: [] };
const mdNorm = normalizeReport(mdReport);
assert.equal(mdNorm.format, 'markdown');
assert.equal(mdNorm.sections.length, 0);
assert.ok(renderMarkdown(mdNorm.raw).includes('<strong>Điểm mạnh</strong>'));

// keyword-key normalization (report/sections without colon)
const plain = normalizeReport({ report: 'Tiêu đề', sections: [{ heading: '## A', content: 'x' }] });
assert.equal(plain.title, 'Tiêu đề');
assert.equal(plain.sections.length, 1);

console.log(JSON.stringify({ result: 'PASS', sections: normalized.sections.length, title: normalized.title }));
