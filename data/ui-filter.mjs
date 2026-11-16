import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

await page.goto(base + '/shop.html?range=30d', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const readKpis = async () => {
  const values = await page.locator('.kpi-value').allInnerTexts();
  return values.map((v) => v.replace(/\s+/g, ' ').trim());
};

const before = await readKpis();
console.log('Kỳ 30d:', before.slice(0, 3).join(' | '));

await page.getByRole('button', { name: 'Hôm qua' }).click();
await page.waitForTimeout(2000);
const afterYesterday = await readKpis();
console.log('Kỳ hôm qua:', afterYesterday.slice(0, 3).join(' | '));
console.log('URL:', page.url());

await page.getByRole('button', { name: '90N' }).click();
await page.waitForTimeout(2000);
const after90 = await readKpis();
console.log('Kỳ 90d:', after90.slice(0, 3).join(' | '));

const changed = JSON.stringify(before) !== JSON.stringify(afterYesterday) && JSON.stringify(afterYesterday) !== JSON.stringify(after90);
console.log(changed ? 'PASS time filter thay đổi dữ liệu' : 'FAIL time filter không thay đổi dữ liệu');

await page.goto(base + '/creators.html?range=7d', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const creatorRows = await page.locator('table.data tbody tr').count();
await page.getByRole('button', { name: '90N' }).click();
await page.waitForTimeout(2000);
console.log(`Creators rows=${creatorRows}, url=${page.url()}`);

await page.goto(base + '/detail.html?id=19&range=7d', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const detailTitleBefore = await page.locator('h2').first().innerText().catch(() => '');
await page.getByRole('button', { name: 'Hôm qua' }).click();
await page.waitForTimeout(2000);
const detailTitleAfter = await page.locator('h2').first().innerText().catch(() => '');
console.log(`Detail title stable=${detailTitleBefore === detailTitleAfter} url=${page.url()}`);

await browser.close();
if (errors.length > 0) {
  console.log('PAGE ERRORS:', errors);
  process.exit(1);
}
