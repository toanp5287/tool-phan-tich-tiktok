import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const pages = [
  ['/shop.html', 'Tổng quan'],
  ['/categories.html', 'Ngành hàng'],
  ['/shops.html', 'Cửa hàng'],
  ['/creators.html', 'Nhà sáng tạo'],
  ['/detail.html?id=19', 'Chi tiết sản phẩm'],
  ['/shop-detail.html?id=19', 'Chi tiết shop'],
  ['/creator.html?id=28', 'Chi tiết creator'],
  ['/category.html?name=' + encodeURIComponent('Thời trang & Phụ kiện'), 'Chi tiết ngành'],
  ['/subcategory.html?category=' + encodeURIComponent('Thời trang & Phụ kiện') + '&name=' + encodeURIComponent('Áo'), 'Ngành con'],
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let failures = 0;

for (const [path, label] of pages) {
  const page = await context.newPage();
  const issues = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push(`console: ${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', (err) => issues.push(`pageerror: ${String(err).slice(0, 300)}`));

  try {
    const resp = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);

    const bodyText = (await page.locator('#app').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const hasSpinnerOnly = bodyText.includes('Đang tải') && bodyText.length < 200;
    const hasError = bodyText.includes('Không tải được');

    const status = resp ? resp.status() : 0;
    const ok = status === 200 && issues.length === 0 && !hasSpinnerOnly && !hasError;
    if (!ok) failures += 1;

    console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (${path}) status=${status} chars=${bodyText.length}`);
    if (issues.length) issues.slice(0, 5).forEach((issue) => console.log(`   - ${issue}`));
    if (hasError) console.log(`   - UI báo lỗi tải dữ liệu`);
    if (hasSpinnerOnly) console.log(`   - Trang kẹt ở trạng thái loading`);
    if (ok) console.log(`   · ${bodyText.slice(0, 150)}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label} (${path}) -> ${error.message}`);
    issues.slice(0, 5).forEach((issue) => console.log(`   - ${issue}`));
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(failures === 0 ? '\nALL PAGES PASSED' : `\n${failures} PAGE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
