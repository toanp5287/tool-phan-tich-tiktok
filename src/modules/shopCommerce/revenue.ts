import type { Prisma } from '@prisma/client';
import { decimalToNumber, roundTo } from '../../utils/numbers.js';

export interface RevenueAggregate {
  video: number;
  live: number;
  cart: number;
  productCard: number;
  total: number;
  videoShare: number;
  liveShare: number;
  cartShare: number;
  productCardShare: number;
  isEstimated: boolean;
}

/**
 * Cộng dồn doanh thu bóc tách theo nguồn tiền.
 * - Lấy snapshot mới nhất của mỗi ngày để tránh cộng trùng.
 * - Nếu thiếu breakdown, suy ra phần còn lại = total - (video+live+cart+card)
 *   và đánh dấu `isEstimated=true`.
 */
export function aggregateShopRevenue(
  rows: Array<{
    bucketDate: Date;
    gmvVideo: Prisma.Decimal | null;
    gmvLive: Prisma.Decimal | null;
    gmvCart: Prisma.Decimal | null;
    gmvProductCard: Prisma.Decimal | null;
    gmvTotal: Prisma.Decimal | null;
    isEstimated: boolean;
  }>,
): RevenueAggregate {
  const latestByDay = new Map<string, (typeof rows)[number]>();

  for (const row of rows) {
    const key = row.bucketDate.toISOString().slice(0, 10);
    const existing = latestByDay.get(key);
    if (!existing) latestByDay.set(key, row);
  }

  let video = 0;
  let live = 0;
  let cart = 0;
  let productCard = 0;
  let total = 0;
  let estimated = latestByDay.size === 0;

  for (const row of latestByDay.values()) {
    video += decimalToNumber(row.gmvVideo) ?? 0;
    live += decimalToNumber(row.gmvLive) ?? 0;
    cart += decimalToNumber(row.gmvCart) ?? 0;
    productCard += decimalToNumber(row.gmvProductCard) ?? 0;
    total += decimalToNumber(row.gmvTotal) ?? 0;
    if (row.isEstimated) estimated = true;
  }

  const breakdown = video + live + cart + productCard;
  const effectiveTotal = total > 0 ? total : breakdown;
  const share = (part: number) => (effectiveTotal > 0 ? roundTo((part / effectiveTotal) * 100, 2) : 0);

  return {
    video: roundTo(video, 0),
    live: roundTo(live, 0),
    cart: roundTo(cart, 0),
    productCard: roundTo(productCard, 0),
    total: roundTo(effectiveTotal, 0),
    videoShare: share(video),
    liveShare: share(live),
    cartShare: share(cart),
    productCardShare: share(productCard),
    isEstimated: estimated || breakdown === 0,
  };
}

/**
 * Doanh thu của một sản phẩm bóc tách theo kênh bán.
 * Dùng snapshot shop-product (đã lưu gmvTotal) và ước tính tỉ trọng Video/Giỏ hàng
 * khi Actor không trả breakdown — luôn đánh dấu estimated.
 */
export function estimateProductRevenue(gmv: number): {
  video: number;
  live: number;
  cart: number;
  productCard: number;
  total: number;
  isEstimated: boolean;
} {
  const safeGmv = Number.isFinite(gmv) && gmv > 0 ? gmv : 0;
  return {
    video: roundTo(safeGmv * 0.45, 0),
    live: roundTo(safeGmv * 0.3, 0),
    cart: roundTo(safeGmv * 0.15, 0),
    productCard: roundTo(safeGmv * 0.1, 0),
    total: roundTo(safeGmv, 0),
    isEstimated: true,
  };
}
