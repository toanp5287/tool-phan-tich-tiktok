// Run with a running local server: node tests/ai-button.browser.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const posts = [];
  page.on('pageerror', error => errors.push(error.message));
  // No mutation or paid provider requests are allowed during this check.
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') {
      posts.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/app/?view=products`, { waitUntil: 'networkidle' });
  const row = page.locator('tbody tr').first();
  await row.waitFor();
  await row.click();
  const button = page.getByRole('button', { name: 'Phân tích AI', exact: true });
  await button.waitFor();
  assert.equal(await button.isVisible(), true);
  assert.equal(await button.isEnabled(), true);
  assert.deepEqual(posts, [], 'Opening a product must not trigger AI');
  assert.deepEqual(errors, [], 'Product drawer must render without script errors');
  console.log('PASS: product drawer shows AI button without calling AI');
} finally {
  await browser.close();
}
