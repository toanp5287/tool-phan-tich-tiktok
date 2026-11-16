import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

async function inspect(path, label, checks) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(base + path, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);

  const results = [];
  for (const [name, selector, min] of checks) {
    const count = await page.locator(selector).count();
    results.push({ name, count, min, ok: count >= min });
  }
  const fail = results.some((r) => !r.ok) || errors.length > 0;
  console.log(`${fail ? 'FAIL' : 'PASS'} ${label}`);
  results.forEach((r) => console.log(`   ${r.ok ? '✓' : '✗'} ${r.name}: ${r.count} (>=${r.min})`));
  errors.slice(0, 5).forEach((e) => console.log(`   ✗ ${e}`));
  await page.close();
  return !fail;
}

let ok = true;
ok = (await inspect('/shop.html?range=30d', 'Home', [
  ['Top products rows', 'table.data tbody tr', 10],
  ['Creator cards', 'a[href^="/creator.html"]', 5],
  ['Seller count column', 'table.data thead th', 8],
])) && ok;

ok = (await inspect('/categories.html?range=30d', 'Categories', [
  ['Overview KPI', '.kpi', 4],
  ['Category tiles', 'a.tile', 5],
  ['Doughnut canvas', 'canvas', 2],
])) && ok;

ok = (await inspect('/shops.html?range=30d', 'Shops', [
  ['Shop rows', 'table.data tbody tr', 5],
  ['Top product links', 'table.data a[href^="/detail.html"]', 5],
])) && ok;

ok = (await inspect('/creators.html?range=30d', 'Creators', [
  ['Creator rows', 'table.data tbody tr', 5],
  ['Follower values', 'table.data tbody tr td.is-numeric', 20],
])) && ok;

ok = (await inspect('/detail.html?id=19&range=30d', 'Product detail', [
  ['Variants table rows', 'table.data tbody tr', 3],
  ['Top creators', 'a[href^="/creator.html"]', 1],
  ['Trend video block', 'text=Top Trend Video', 1],
  ['Seller count KPI', 'text=Người bán', 1],
])) && ok;

ok = (await inspect('/shop-detail.html?id=19&range=30d', 'Shop detail', [
  ['Revenue canvas', 'canvas', 2],
  ['Affiliates', 'a[href^="/creator.html"]', 1],
  ['New products section', 'text=Sản phẩm mới (2 tuần)', 1],
  ['Product table rows', 'table.data tbody tr', 3],
])) && ok;

ok = (await inspect('/creator.html?id=28&range=30d', 'Creator detail', [
  ['Product links', 'a[href^="/detail.html"]', 1],
  ['Shop links', 'a[href^="/shop-detail.html"]', 1],
  ['Charts', 'canvas', 2],
])) && ok;

await browser.close();
console.log(ok ? '\nDEEP CHECKS PASSED' : '\nDEEP CHECKS FAILED');
process.exit(ok ? 0 : 1);
