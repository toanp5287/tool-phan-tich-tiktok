import { createLogger } from '../../utils/logger.js';
import type {
  EchoTikProductData,
  EchoTikShopData,
} from '../../types/echotik.js';
import type {
  ScrapedRecord,
  ScrapedProductRecord,
  ScrapedShopRecord,
  ScrapedVariantRecord,
  ScrapedRevenueBreakdown,
} from '../../types/scraper.js';
import { toOptionalBigInt, toOptionalDecimal } from '../../utils/numbers.js';
import type { Prisma } from '@prisma/client';

const logger = createLogger('echotik-normalizer');

/**
 * Chuyển đổi dữ liệu EchoTik API thô sang định dạng ScrapedRecord
 * tương thích với pipeline ingestion hiện tại
 */
export function normalizeEchoTikProduct(
  product: EchoTikProductData,
): ScrapedRecord {
  const shop = product.shop ? normalizeEchoTikShop(product.shop) : null;

  const variants: ScrapedVariantRecord[] =
    product.variants?.map((v) => ({
      platformSkuId: v.skuId,
      name: v.name ?? null,
      price: toOptionalDecimal(v.price),
      stock: v.stock ?? null,
      soldCount: v.soldCount ?? null,
      attributes: null,
    })) ?? [];

  const productRecord: ScrapedProductRecord = {
    platformProductId: product.productId,
    title: product.title,
    description: product.description ?? null,
    imageUrl: product.imageUrl ?? null,
    productUrl: product.productUrl ?? null,
    category: product.category ?? null,
    subCategory: product.subCategory ?? null,
    price: product.price ? Number(product.price) : null,
    salesTotal: product.soldCount ? Number(product.soldCount) : null,
    gmvTotal: null, // UNVERIFIED: EchoTik không trả GMV
    sellerCount: null, // UNVERIFIED: EchoTik không trả seller count
    minPrice: toOptionalDecimal(product.price),
    maxPrice: toOptionalDecimal(product.price),
    variants,
    playCount: null, // UNVERIFIED: EchoTik không có video engagement
    diggCount: null,
    shareCount: null,
    commentCount: null,
    isEstimated: true,
    capturedAt: product.capturedAt ?? new Date(),
    rawData: {
      source: 'echotik',
      ratingScore: product.rating,
      ratingCount: product.ratingCount,
      stock: product.stock,
    },
  };

  return {
    platformVideoId: null,
    content: product.title,
    author: shop?.name ?? null,
    videoUrl: product.productUrl ?? null,
    keywords: [],
    trendMetrics: {
      playCount: null,
      diggCount: null,
      shareCount: null,
      commentCount: null,
    },
    shop,
    creator: null,
    product: productRecord,
  };
}

/**
 * Chuyển đổi dữ liệu shop EchoTik sang định dạng ScrapedShopRecord
 */
export function normalizeEchoTikShop(shop: EchoTikShopData): ScrapedShopRecord {
  return {
    platformShopId: shop.sellerId,
    name: shop.name,
    username: shop.username ?? null,
    avatarUrl: shop.avatarUrl ?? null,
    shopUrl: shop.shopUrl ?? null,
    followerCount: shop.followerCount ? Number(shop.followerCount) : null,
    revenueBreakdown: null, // UNVERIFIED: EchoTik không trả revenue breakdown
  };
}

/**
 * Chuyển đổi array products từ EchoTik API
 */
export function normalizeEchoTikProducts(
  products: EchoTikProductData[],
): ScrapedRecord[] {
  return products.map((product) => {
    try {
      return normalizeEchoTikProduct(product);
    } catch (error) {
      logger.warn(`Failed to normalize EchoTik product ${product.productId}: ${error}`);
      throw error;
    }
  });
}

/**
 * Normalize EchoTik category L1
 */
export function normalizeEchoTikCategoryL1(
  category: Record<string, unknown>,
): { id: string; name: string; slug: string } {
  const id = String(category.id ?? category.category_id ?? '');
  const name = String(category.name ?? category.category_name ?? '');
  
  if (!id || !name) {
    throw new Error(`Invalid L1 category: missing id or name`);
  }

  const slug = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 100);

  return { id, name, slug };
}

/**
 * Normalize EchoTik category L2
 */
export function normalizeEchoTikCategoryL2(
  category: Record<string, unknown>,
  parentId: string,
): { id: string; name: string; slug: string; parentId: string } {
  const id = String(category.id ?? category.category_id ?? '');
  const name = String(category.name ?? category.category_name ?? '');

  if (!id || !name) {
    throw new Error(`Invalid L2 category: missing id or name`);
  }

  const slug = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 100);

  return { id, name, slug, parentId };
}

