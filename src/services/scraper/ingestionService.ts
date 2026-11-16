import { Prisma } from '@prisma/client';
import prisma from '../../config/db.js';
import type { IngestResult, ScrapedCreatorRecord, ScrapedRecord, ScrapedShopRecord, ScrapedVariantRecord } from '../../types/scraper.js';
import { isValidDate, toBucketDate } from '../../utils/dates.js';
import { toOptionalBigInt, toOptionalDecimal } from '../../utils/numbers.js';
import { createLogger } from '../../utils/logger.js';
import { toErrorMessage } from '../../utils/errors.js';
import { mapWithConcurrency } from '../../utils/async.js';
import { ensureCategory } from '../categoryCatalogService.js';

const logger = createLogger('ingest');

interface IngestOptions {
  jobId: number;
  source: string;
  concurrency?: number;
  region?: string;
  currency?: string;
}

interface RecordOutcome {
  saved: boolean;
  updated: boolean;
}

export async function ingestRecords(records: readonly ScrapedRecord[], options: IngestOptions): Promise<IngestResult> {
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
  const result: IngestResult = { found: records.length, saved: 0, updated: 0, failed: 0, skipped: 0, errors: [] };

  const outcomes = await mapWithConcurrency(records, concurrency, (record) => persistRecord(record, options));

  outcomes.forEach((outcome, index) => {
    if (outcome.ok) {
      if (outcome.value.saved) result.saved += 1;
      if (outcome.value.updated) result.updated += 1;
      return;
    }

    result.failed += 1;
    const message = toErrorMessage(outcome.error);
    result.errors.push({ index, message });

    if (result.errors.length <= 5) {
      logger.warn(`Bỏ qua bản ghi #${index}: ${message}`);
    }
  });

  logger.info(
    `Ingest hoàn tất (job #${options.jobId}): ${result.saved} mới, ${result.updated} cập nhật, ${result.failed} lỗi`,
  );

  await syncCategoryCatalogForRecords(records);

  return result;
}

/**
 * Đảm bảo mọi cặp (category, subCategory) mới xuất hiện trong payload đều có
 * bản ghi trong bảng Category/SubCategory. Chạy sau khi ingest, lỗi không chặn pipeline.
 */
async function syncCategoryCatalogForRecords(records: readonly ScrapedRecord[]): Promise<void> {
  const pairs = new Map<string, { category: string; subCategory: string | null }>();

  for (const record of records) {
    const category = record.product.category?.trim();
    if (!category) continue;
    const subCategory = record.product.subCategory?.trim() ?? null;
    pairs.set(`${category}::${subCategory ?? ''}`, { category, subCategory });
  }

  for (const pair of pairs.values()) {
    await ensureCategory(pair.category, pair.subCategory);
  }
}

async function persistRecord(record: ScrapedRecord, options: IngestOptions): Promise<RecordOutcome> {
  const capturedAt = isValidDate(record.product.capturedAt) ? record.product.capturedAt : new Date();
  const bucketDate = toBucketDate(capturedAt);

  return prisma.$transaction(async (tx) => {
    const shop = record.shop
      ? await tx.shop.upsert({
          where: {
            platformShopId_source: {
              platformShopId: record.shop.platformShopId,
              source: options.source,
            },
          },
          update: {
            name: record.shop.name,
            username: record.shop.username,
            avatarUrl: record.shop.avatarUrl,
            shopUrl: record.shop.shopUrl,
            ...shopFollowerUpdate(record.shop),
            lastSeenAt: capturedAt,
          },
          create: {
            platformShopId: record.shop.platformShopId,
            source: options.source,
            name: record.shop.name,
            username: record.shop.username,
            avatarUrl: record.shop.avatarUrl,
            shopUrl: record.shop.shopUrl,
            followerCount: toOptionalBigInt(record.shop.followerCount),
            region: options.region ?? 'VN',
          },
          select: { id: true },
        })
      : null;

    const existing = await tx.product.findUnique({
      where: {
        platformProductId_source: {
          platformProductId: record.product.platformProductId,
          source: options.source,
        },
      },
      select: { id: true },
    });

    const product = await tx.product.upsert({
      where: {
        platformProductId_source: {
          platformProductId: record.product.platformProductId,
          source: options.source,
        },
      },
      update: {
        title: record.product.title,
        ...(options.source === 'echotik' ? {} : { description: record.product.description }),
        imageUrl: record.product.imageUrl,
        productUrl: record.product.productUrl,
        category: record.product.category,
        subCategory: record.product.subCategory,
        shopId: shop?.id ?? undefined,
        ...priceRangeUpdate(record),
        soldCount: toOptionalBigInt(record.product.salesTotal) ?? undefined,
        avgPrice: toOptionalDecimal(record.product.price) ?? undefined,
        lastSeenAt: capturedAt,
      },
      create: {
        platformProductId: record.product.platformProductId,
        source: options.source,
        title: record.product.title,
        ...(options.source === 'echotik' ? {} : { description: record.product.description }),
        imageUrl: record.product.imageUrl,
        productUrl: record.product.productUrl,
        category: record.product.category,
        subCategory: record.product.subCategory,
        shopId: shop?.id ?? null,
        minPrice: record.product.minPrice ?? toOptionalDecimal(record.product.price),
        maxPrice: record.product.maxPrice ?? toOptionalDecimal(record.product.price),
        variantCount: record.product.variants.length,
        sellerCount: record.product.sellerCount ?? (shop ? 1 : 0),
        soldCount: toOptionalBigInt(record.product.salesTotal),
        avgPrice: toOptionalDecimal(record.product.price),
        currency: options.currency ?? 'VND',
        region: options.region ?? 'VN',
      },
      select: { id: true, sellerCount: true },
    });

    // ─── Lưu biến thể / SKU (chỉ khi payload có dữ liệu) ────────────────
    if (record.product.variants.length > 0) {
      await persistVariants(tx, product.id, record.product.variants, capturedAt);
    }

    const tracking = shop
      ? await tx.productShop.upsert({
          where: { productId_shopId: { productId: product.id, shopId: shop.id } },
          update: { isActive: true, lastSeenAt: capturedAt },
          create: {
            productId: product.id,
            shopId: shop.id,
            isActive: true,
            firstSeenAt: capturedAt,
            lastSeenAt: capturedAt,
          },
          select: { id: true },
        })
      : null;

    // ─── Creator / Affiliate + liên kết sản phẩm & shop ────────────────
    if (record.creator) {
      await persistCreator(tx, record.creator, record, product.id, shop?.id ?? null, capturedAt, bucketDate, options);
    }

    // ─── Bóc tách doanh thu shop theo nguồn tiền ───────────────────────
    if (shop && record.shop?.revenueBreakdown) {
      await persistShopRevenue(tx, shop.id, record.shop, bucketDate, capturedAt, options);
    }

    // ─── Trend video liên kết sản phẩm + creator ───────────────────────
    await persistTrendItem(tx, record, product.id, bucketDate, options);

    const snapshotData = buildSnapshotData(record, options);

    await tx.productSnapshot.upsert({
      where: {
        productId_source_bucketDate: {
          productId: product.id,
          source: options.source,
          bucketDate,
        },
      },
      update: snapshotData,
      create: {
        productId: product.id,
        scrapeJobId: options.jobId,
        source: options.source,
        capturedAt,
        bucketDate,
        ...snapshotData,
      },
    });

    if (tracking) {
      // ShopProductSnapshot không có cột sellerCount (chỉ ProductSnapshot có).
      const { sellerCount: _sellerCount, ...shopSnapshotData } = snapshotData;
      await tx.shopProductSnapshot.upsert({
        where: {
          productShopId_source_bucketDate: {
            productShopId: tracking.id,
            source: options.source,
            bucketDate,
          },
        },
        update: shopSnapshotData,
        create: {
          productShopId: tracking.id,
          scrapeJobId: options.jobId,
          source: options.source,
          capturedAt,
          bucketDate,
          ...shopSnapshotData,
        },
      });
    }

    await syncSellerCount(tx, product.id, record.product.sellerCount);

    return { saved: existing === null, updated: existing !== null };
  });
}

/**
 * Đồng bộ sellerCount: ưu tiên số liệu payload (nếu Actor trả về), ngược lại
 * đếm số shop đang active bán sản phẩm. Không bao giờ giảm về 0 khi đã có dữ liệu.
 */
async function syncSellerCount(
  tx: Prisma.TransactionClient,
  productId: number,
  explicit: number | null,
): Promise<void> {
  const activeCount = await tx.productShop.count({ where: { productId, isActive: true } });
  const next = Math.max(explicit ?? 0, activeCount);
  if (next <= 0) return;

  const current = await tx.product.findUnique({ where: { id: productId }, select: { sellerCount: true } });
  if (current && current.sellerCount === next) return;

  await tx.product.update({ where: { id: productId }, data: { sellerCount: next } });
}

function shopFollowerUpdate(shop: ScrapedShopRecord): Prisma.ShopUpdateInput {
  if (shop.followerCount === null) return {};
  return { followerCount: toOptionalBigInt(shop.followerCount) };
}

async function persistCreator(
  tx: Prisma.TransactionClient,
  creator: ScrapedCreatorRecord,
  record: ScrapedRecord,
  productId: number,
  shopId: number | null,
  capturedAt: Date,
  bucketDate: Date,
  options: IngestOptions,
): Promise<void> {
  const creatorRow = await tx.creator.upsert({
    where: {
      platformCreatorId_source: {
        platformCreatorId: creator.platformCreatorId,
        source: options.source,
      },
    },
    update: {
      displayName: creator.displayName,
      avatarUrl: creator.avatarUrl,
      ...(creator.username ? { username: creator.username } : {}),
      ...(creator.followerCount !== null ? { followerCount: toOptionalBigInt(creator.followerCount) } : {}),
      ...(creator.engagementRate !== null ? { engagementRate: toOptionalDecimal(creator.engagementRate) } : {}),
      ...(creator.gmvTotal !== null ? { gmvTotal: toOptionalDecimal(creator.gmvTotal) } : {}),
      ...(creator.soldCount !== null ? { soldCount: toOptionalBigInt(creator.soldCount) } : {}),
      ...(creator.videoCount !== null ? { videoCount: Math.trunc(creator.videoCount) } : {}),
      lastSeenAt: capturedAt,
    },
    create: {
      platformCreatorId: creator.platformCreatorId,
      source: options.source,
      username: creator.username,
      displayName: creator.displayName,
      avatarUrl: creator.avatarUrl,
      role: creator.role,
      region: options.region ?? 'VN',
      followerCount: toOptionalBigInt(creator.followerCount),
      engagementRate: toOptionalDecimal(creator.engagementRate),
      gmvTotal: toOptionalDecimal(creator.gmvTotal),
      soldCount: toOptionalBigInt(creator.soldCount),
      videoCount: creator.videoCount === null ? null : Math.trunc(creator.videoCount),
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
    },
    select: { id: true },
  });

  const productGmv = toOptionalDecimal(record.product.gmvTotal);
  const productSold = toOptionalBigInt(record.product.salesTotal);

  await tx.productCreator.upsert({
    where: { productId_creatorId: { productId, creatorId: creatorRow.id } },
    update: {
      isActive: true,
      ...(productGmv !== null ? { gmvTotal: productGmv } : {}),
      ...(productSold !== null ? { soldCount: productSold } : {}),
      lastSeenAt: capturedAt,
    },
    create: {
      productId,
      creatorId: creatorRow.id,
      isActive: true,
      gmvTotal: productGmv,
      soldCount: productSold,
      firstSeenAt: capturedAt,
      lastSeenAt: capturedAt,
    },
  });

  if (shopId !== null) {
    await tx.creatorShop.upsert({
      where: { creatorId_shopId: { creatorId: creatorRow.id, shopId } },
      update: {
        isActive: true,
        ...(productGmv !== null ? { gmvTotal: productGmv } : {}),
        ...(productSold !== null ? { soldCount: productSold } : {}),
        lastSeenAt: capturedAt,
      },
      create: {
        creatorId: creatorRow.id,
        shopId,
        isActive: true,
        gmvTotal: productGmv,
        soldCount: productSold,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
    });
  }

  if (
    creator.followerCount !== null ||
    creator.engagementRate !== null ||
    creator.gmvTotal !== null ||
    creator.soldCount !== null
  ) {
    const snapshotData = {
      followerCount: toOptionalBigInt(creator.followerCount),
      engagementRate: toOptionalDecimal(creator.engagementRate),
      gmvTotal: toOptionalDecimal(creator.gmvTotal),
      soldCount: toOptionalBigInt(creator.soldCount),
      videoCount: creator.videoCount === null ? null : Math.trunc(creator.videoCount),
      isEstimated: creator.engagementRate === null,
    };

    await tx.creatorSnapshot.upsert({
      where: {
        creatorId_source_bucketDate: {
          creatorId: creatorRow.id,
          source: options.source,
          bucketDate,
        },
      },
      update: snapshotData,
      create: {
        creatorId: creatorRow.id,
        scrapeJobId: options.jobId,
        source: options.source,
        capturedAt,
        bucketDate,
        ...snapshotData,
      },
    });
  }
}

async function persistShopRevenue(
  tx: Prisma.TransactionClient,
  shopId: number,
  shop: ScrapedShopRecord,
  bucketDate: Date,
  capturedAt: Date,
  options: IngestOptions,
): Promise<void> {
  const breakdown = shop.revenueBreakdown;
  if (!breakdown) return;

  const snapshotData = {
    gmvVideo: toOptionalDecimal(breakdown.gmvVideo),
    gmvLive: toOptionalDecimal(breakdown.gmvLive),
    gmvCart: toOptionalDecimal(breakdown.gmvCart),
    gmvProductCard: toOptionalDecimal(breakdown.gmvProductCard),
    gmvTotal: toOptionalDecimal(breakdown.gmvTotal),
    isEstimated: breakdown.isEstimated,
    rawData: (toJsonValue({ ...breakdown, source: options.source }) ?? {}) as Prisma.InputJsonObject,
  };

  await tx.shopRevenueSnapshot.upsert({
    where: {
      shopId_source_bucketDate: {
        shopId,
        source: options.source,
        bucketDate,
      },
    },
    update: snapshotData,
    create: {
      shopId,
      scrapeJobId: options.jobId,
      source: options.source,
      capturedAt,
      bucketDate,
      ...snapshotData,
    },
  });
}

async function persistTrendItem(
  tx: Prisma.TransactionClient,
  record: ScrapedRecord,
  productId: number,
  bucketDate: Date,
  options: IngestOptions,
): Promise<void> {
  if (!record.platformVideoId) return;

  const creatorRow = record.creator
      ? await tx.creator.findUnique({
        where: {
          platformCreatorId_source: {
            platformCreatorId: record.creator.platformCreatorId,
            source: options.source,
          },
        },
        select: { id: true },
      })
    : null;

  await tx.trendItem.upsert({
    where: { platformVideoId: record.platformVideoId },
    update: {
      author: record.author,
      content: record.content,
      keywords: record.keywords,
      videoUrl: record.videoUrl,
      playCount: toOptionalBigInt(record.trendMetrics.playCount),
      diggCount: toOptionalBigInt(record.trendMetrics.diggCount),
      shareCount: toOptionalBigInt(record.trendMetrics.shareCount),
      commentCount: toOptionalBigInt(record.trendMetrics.commentCount),
      productId,
      creatorId: creatorRow?.id ?? null,
      bucketDate,
      scrapedAt: new Date(),
    },
    create: {
      platformVideoId: record.platformVideoId,
      author: record.author,
      content: record.content,
      keywords: record.keywords,
      videoUrl: record.videoUrl,
      playCount: toOptionalBigInt(record.trendMetrics.playCount),
      diggCount: toOptionalBigInt(record.trendMetrics.diggCount),
      shareCount: toOptionalBigInt(record.trendMetrics.shareCount),
      commentCount: toOptionalBigInt(record.trendMetrics.commentCount),
      productId,
      creatorId: creatorRow?.id ?? null,
      bucketDate,
      scrapeJobId: options.jobId,
    },
  });
}

interface SnapshotScalarPayload {
  price: Prisma.Decimal | null;
  soldCountTotal: bigint | null;
  sellerCount: number | null;
  gmvTotal: Prisma.Decimal | null;
  playCount: bigint | null;
  diggCount: bigint | null;
  shareCount: bigint | null;
  commentCount: bigint | null;
  isEstimated: boolean;
  rawData: Prisma.InputJsonObject;
}

type JsonSafe = null | string | number | boolean | JsonSafe[] | { [key: string]: JsonSafe };

function toJsonValue(value: unknown): JsonSafe | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return isValidDate(value) ? value.toISOString() : undefined;
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item) ?? null);
  }
  if (typeof value === 'object') {
    const object: Record<string, JsonSafe> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = toJsonValue(item);
      if (normalized !== undefined) object[key] = normalized;
    }
    return object;
  }
  return undefined;
}

function buildSnapshotData(record: ScrapedRecord, options: IngestOptions): SnapshotScalarPayload {
  const { product } = record;

  return {
    price: toOptionalDecimal(product.price),
    soldCountTotal: toOptionalBigInt(product.salesTotal),
    sellerCount: product.sellerCount,
    gmvTotal: toOptionalDecimal(product.gmvTotal),
    playCount: toOptionalBigInt(product.playCount),
    diggCount: toOptionalBigInt(product.diggCount),
    shareCount: toOptionalBigInt(product.shareCount),
    commentCount: toOptionalBigInt(product.commentCount),
    isEstimated: product.isEstimated,
    rawData: (toJsonValue({
      ...product.rawData,
      source: options.source,
    }) ?? {}) as Prisma.InputJsonObject,
  };
}

interface PriceRangeFields {
  minPrice?: Prisma.Decimal | null;
  maxPrice?: Prisma.Decimal | null;
  variantCount?: number;
}

function priceRangeUpdate(record: ScrapedRecord): PriceRangeFields {
  const { minPrice, maxPrice, variants, price } = record.product;

  if (variants.length > 0 && (minPrice !== null || maxPrice !== null)) {
    return {
      minPrice: minPrice ?? maxPrice,
      maxPrice: maxPrice ?? minPrice,
      variantCount: variants.length,
    };
  }

  const singlePrice = toOptionalDecimal(price);
  if (singlePrice !== null) {
    return {
      minPrice: singlePrice,
      maxPrice: singlePrice,
    };
  }

  return {};
}

async function persistVariants(
  tx: Prisma.TransactionClient,
  productId: number,
  variants: readonly ScrapedVariantRecord[],
  capturedAt: Date,
): Promise<void> {
  for (const variant of variants) {
    const attributesJson =
      variant.attributes && Object.keys(variant.attributes).length > 0
        ? (variant.attributes as Prisma.InputJsonObject)
        : Prisma.JsonNull;

    await tx.productVariant.upsert({
      where: {
        productId_platformSkuId: {
          productId,
          platformSkuId: variant.platformSkuId,
        },
      },
      update: {
        name: variant.name,
        price: variant.price,
        stock: variant.stock ?? null,
        soldCount: variant.soldCount ?? null,
        attributes: attributesJson,
        lastSeenAt: capturedAt,
      },
      create: {
        productId,
        platformSkuId: variant.platformSkuId,
        name: variant.name,
        price: variant.price,
        stock: variant.stock ?? null,
        soldCount: variant.soldCount ?? null,
        attributes: attributesJson,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
    });
  }
}
