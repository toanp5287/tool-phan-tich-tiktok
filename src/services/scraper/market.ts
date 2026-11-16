import type { RawShopItem } from '../../types/shopScrape.js';

export type MarketCode = 'VN' | 'US' | 'UNKNOWN';

const VN_HOST_HINTS = ['tiktok.com/vn', 'shop.tiktok.com/vn', '/vn/', 'vn.tiktok', 'tiktokshop.vn'];
const US_HOST_HINTS = ['tiktok.com/us', 'shop.tiktok.com/us', '/us/', 'tiktok.com/shop/us'];

/**
 * Xác định thị trường của một item TikTok Shop.
 *
 * Ưu tiên tín hiệu mạnh nhất:
 *  1. `currency` (VND => VN; USD => US)
 *  2. Đường dẫn/URL sản phẩm (`/vn/`, `/us/`)
 *  3. Trường `region`/`country`/`market` do Actor trả về
 *
 * Trả `UNKNOWN` khi không đủ tín hiệu — nơi gọi quyết định có chấp nhận hay không.
 */
export function detectMarket(item: RawShopItem, fallbackRegion = 'VN'): MarketCode {
  const currency = readCurrencyHint(item);
  if (currency === 'VND') return 'VN';
  if (currency === 'USD') return 'US';

  const urls = [item.productUrl, item.shop_url, item.product_url, item.url]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());

  for (const url of urls) {
    if (VN_HOST_HINTS.some((hint) => url.includes(hint))) return 'VN';
    if (US_HOST_HINTS.some((hint) => url.includes(hint))) return 'US';
  }

  const explicit = readStringHint(
    item.region,
    item.country,
    item.countryCode,
    item.country_code,
    item.market,
    item.marketplace,
    (item.seller as Record<string, unknown> | undefined)?.region,
    (item.seller as Record<string, unknown> | undefined)?.country,
  );
  if (explicit) {
    const normalized = explicit.toUpperCase();
    if (normalized === 'VN' || normalized === 'VIETNAM' || normalized === 'VIET NAM') return 'VN';
    if (normalized === 'US' || normalized === 'USA' || normalized === 'UNITED STATES') return 'US';
  }

  // Actor thường không trả thị trường: dùng region cấu hình làm mặc định yếu.
  const fallback = fallbackRegion.toUpperCase();
  if (fallback === 'VN' || fallback === 'US') return fallback;

  return 'UNKNOWN';
}

function readCurrencyHint(item: RawShopItem): string | null {
  const candidates: unknown[] = [
    item.currency,
    (item.salePrice as { currency?: unknown } | undefined)?.currency,
    (item.originalPrice as { currency?: unknown } | undefined)?.currency,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().toUpperCase();
  }
  return null;
}

function readStringHint(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
