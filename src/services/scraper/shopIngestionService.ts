import { Prisma } from '@prisma/client';
import prisma from '../../config/db.js';
import { SOURCE, GROWTH_WINDOWS } from '../../config/constants.js';
import type {
  ScrapedShopAffiliate,
  ScrapedShopProduct,
  ScrapedShopRecord,
  ScrapedShopVariant,
  ScrapedShopVideo,
  ShopIngestResult,
} from '../../types/shopScrape.js';
import { mapWithConcurrency } from '../../utils/async.js';
import { addDays, isValidDate, toBucketDate } from '../../utils/dates.js';
import { toErrorMessage } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { toOptionalBigInt, toOptionalDecimal } from '../../utils/numbers.js';

const logger = createLogger('shop-ingest');

export interface ShopIngestOptions {
  jobId: number;
  source?: string;
  concurrency?: number;
  region?: string;
}

interface PersistOutcome {
  saved: boolean;
  updated: boolean;
  shopId: number;
}

/**
 * Ghi dữ liệu TikTok Shop vào DB.
 * - Mỗi item được xử lý trong transaction riêng => 1 sản phẩm lỗi không làm hỏng cả lô.
 * - Không ghi bất kỳ trường mạng xã hội nào (video/trend).
 * - Delta 1/7/30/90 ngày được tính từ snapshot luỹ kế trước đó theo `bucketDate`.
 */
export async function ingestShopRecords(
  records: readonly ScrapedShopRecord[],
  options: ShopIngestOptions,
): Promise<ShopIngestResult> {
  const source = options.source ?? SOURCE.APIFY_SHOP;
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
  const result: ShopIngestResult = {
    found: records.length,
    saved: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const outcomes = await mapWithConcurrency(records, concurrency, (record) =>
    persistShopRecord(record, { ...options, source }),
  );

  const touchedShops = new Set<number>();

  outcomes.forEach((outcome, index) => {
    if (outcome.ok) {
      if (outcome.value.saved) result.saved += 1;
      if (outcome.value.updated) result.updated += 1;
      touchedShops.add(outcome.value.shopId);
      return;
    }

    result.failed += 1;
    const message = toErrorMessage(outcome.error);
    result.errors.push({ index, message });
    if (result.errors.length <= 5) logger.warn(`Bỏ qua sản phẩm TikTok Shop #${index}: ${message}`);
  });

  // Tổng hợp lại shop SAU khi tất cả sản phẩm đã ghi xong, tránh mỗi item
  // cùng cập nhật một shop trong transaction song song (tranh chấp row lock).
  await refreshShopAggregates([...touchedShops], source);

  logger.info(
    `Ingest TikTok Shop hoàn tất (job #${options.jobId}): ${result.saved} mới, ${result.updated} cập nhật, ${result.failed} lỗi`,
  );

  return result;
}

/**
 * Làm mới tổng hợp GMV/số bán/giá trị đơn trung bình cho các shop vừa cào.
 * Lỗi của từng shop được cô lập, không làm hỏng kết quả ingest đã ghi.
 */
async function refreshShopAggregates(shopIds: readonly number[], source: string): Promise<void> {
  for (const shopId of shopIds) {
    try {
      const latestBucket = await prisma.shopProductSnapshot.findFirst({
        where: { productShop: { shopId }, source },
        orderBy: { bucketDate: 'desc' },
        select: { bucketDate: true },
      });

      if (!latestBucket) continue;

      await prisma.$transaction(async (tx) => {
        await syncShopAggregates(tx, shopId, source, latestBucket.bucketDate, new Date());
      });
    } catch (error) {
      logger.warn(`Không thể tổng hợp lại shop #${shopId}: ${toErrorMessage(error)}`);
    }
  }
}

async function persistShopRecord(
  record: ScrapedShopRecord,
  options: ShopIngestOptions & { source: string },
): Promise<PersistOutcome> {
  const capturedAt = isValidDate(record.product.capturedAt) ? record.product.capturedAt : new Date();
  const bucketDate = toBucketDate(capturedAt);
  const region = options.region ?? 'VN';

  return prisma.$transaction(async (tx) => {
    const shop = await tx.shop.upsert({
      where: {
        platformShopId_source: {
          platformShopId: record.shop.platformShopId,
          source: options.source,
        },
      },
      update: {
        name: record.shop.name,
        ...(record.shop.username ? { username: record.shop.username } : {}),
        ...(record.shop.avatarUrl ? { avatarUrl: record.shop.avatarUrl } : {}),
        ...(record.shop.bannerUrl ? { bannerUrl: record.shop.bannerUrl } : {}),
        ...(record.shop.shopUrl ? { shopUrl: record.shop.shopUrl } : {}),
        ...(record.shop.followerCount !== null ? { followerCount: toOptionalBigInt(record.shop.followerCount) } : {}),
        ...(record.shop.productCount !== null ? { productCount: record.shop.productCount } : {}),
        ...(record.shop.ratingScore !== null ? { ratingScore: record.shop.ratingScore } : {}),
        ...(record.shop.ratingCount !== null ? { ratingCount: toOptionalBigInt(record.shop.ratingCount) } : {}),
        lastSeenAt: capturedAt,
      },
      create: {
        platformShopId: record.shop.platformShopId,
        source: options.source,
        name: record.shop.name,
        username: record.shop.username,
        avatarUrl: record.shop.avatarUrl,
        bannerUrl: record.shop.bannerUrl,
        shopUrl: record.shop.shopUrl,
        region,
        followerCount: toOptionalBigInt(record.shop.followerCount),
        productCount: record.shop.productCount ?? 0,
        ratingScore: record.shop.ratingScore,
        ratingCount: toOptionalBigInt(record.shop.ratingCount),
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
      select: { id: true },
    });

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
        description: record.product.description,
        imageUrl: record.product.imageUrl,
        productUrl: record.product.productUrl,
        category: record.product.category,
        subCategory: record.product.subCategory,
        currency: record.product.currency,
        // FK trực tiếp tới shop đại diện (nhà bán chính).
        shopId: shop.id,
        ...priceRangeUpdate(record.product),
        stockTotal: record.product.stockTotal,
        ratingScore: record.product.ratingScore,
        ratingCount: toOptionalBigInt(record.product.ratingCount),
        isAvailable: record.product.isAvailable,
        soldCount: toOptionalBigInt(record.product.soldCount) ?? undefined,
        avgPrice: record.product.price ?? undefined,
        lastSeenAt: capturedAt,
      },
      create: {
        platformProductId: record.product.platformProductId,
        source: options.source,
        title: record.product.title,
        description: record.product.description,
        imageUrl: record.product.imageUrl,
        productUrl: record.product.productUrl,
        category: record.product.category,
        subCategory: record.product.subCategory,
        currency: record.product.currency,
        region,
        shopId: shop.id,
        ...priceRangeCreate(record.product),
        stockTotal: record.product.stockTotal,
        ratingScore: record.product.ratingScore,
        ratingCount: toOptionalBigInt(record.product.ratingCount),
        isAvailable: record.product.isAvailable,
        variantCount: record.product.variants.length,
        sellerCount: record.product.sellerCount ?? 1,
        soldCount: toOptionalBigInt(record.product.soldCount),
        avgPrice: record.product.price,
      },
      select: { id: true },
    });

    if (record.product.variants.length > 0) {
      await persistShopVariants(tx, product.id, record.product.variants, capturedAt);
    }

    const tracking = await tx.productShop.upsert({
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
    });

    await syncSellerCount(tx, product.id, record.product.sellerCount);

    if (record.affiliates.length > 0) {
      await persistShopAffiliates(tx, record.affiliates, shop.id, capturedAt);
    }

    // ─── Video đang bán sản phẩm (gắn product + shop) ───────────────────
    if (record.videos.length > 0) {
      await persistShopVideos(tx, record.videos, product.id, shop.id, bucketDate, capturedAt);
    }

    const deltas = await computeDeltas(tx, product.id, options.source, bucketDate, record.product);

    const snapshotData = buildShopSnapshotData(record.product, deltas, options.source);

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

    const shopSnapshotData = buildShopProductSnapshotData(record.product, deltas, options.source);

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

    return { saved: existing === null, updated: existing !== null, shopId: shop.id };
  });
}

/* ------------------------------------------------------------------ */
/* Delta 1/7/30/90 ngày                                                */
/* ------------------------------------------------------------------ */

interface CommerceDeltas {
  soldCount1d: bigint | null;
  soldCount7d: bigint | null;
  soldCount30d: bigint | null;
  soldCount90d: bigint | null;
  gmv1d: Prisma.Decimal | null;
  gmv7d: Prisma.Decimal | null;
  gmv30d: Prisma.Decimal | null;
  gmv90d: Prisma.Decimal | null;
}

const EMPTY_DELTAS: CommerceDeltas = {
  soldCount1d: null,
  soldCount7d: null,
  soldCount30d: null,
  soldCount90d: null,
  gmv1d: null,
  gmv7d: null,
  gmv30d: null,
  gmv90d: null,
};

/**
 * Delta = giá trị luỹ kế hiện tại - giá trị luỹ kế tại mốc `bucketDate - N ngày`.
 * Chỉ tính khi có snapshot đúng mốc (hoặc cũ nhất trong khoảng) để không bịa số.
 */
async function computeDeltas(
  tx: Prisma.TransactionClient,
  productId: number,
  source: string,
  bucketDate: Date,
  product: ScrapedShopProduct,
): Promise<CommerceDeltas> {
  const currentSold = toOptionalBigInt(product.soldCount);
  const currentGmv = toOptionalDecimal(product.soldCount === null ? null : estimateGmv(product));

  if (currentSold === null && currentGmv === null) return EMPTY_DELTAS;

  const lookbackStart = addDays(bucketDate, -Math.max(...GROWTH_WINDOWS) - 1);

  const history = await tx.productSnapshot.findMany({
    where: {
      productId,
      source,
      bucketDate: { gte: lookbackStart, lt: bucketDate },
    },
    select: { bucketDate: true, soldCountTotal: true, gmvTotal: true },
    orderBy: { bucketDate: 'asc' },
  });

  if (history.length === 0) return EMPTY_DELTAS;

  const deltas: CommerceDeltas = { ...EMPTY_DELTAS };

  for (const window of GROWTH_WINDOWS) {
    const baselineDate = addDays(bucketDate, -window);
    const baseline = findBaseline(history, baselineDate);
    if (!baseline) continue;

    if (window === 1) {
      deltas.soldCount1d = subtractBigInt(currentSold, baseline.soldCountTotal);
      deltas.gmv1d = subtractDecimal(currentGmv, baseline.gmvTotal);
    } else if (window === 7) {
      deltas.soldCount7d = subtractBigInt(currentSold, baseline.soldCountTotal);
      deltas.gmv7d = subtractDecimal(currentGmv, baseline.gmvTotal);
    } else if (window === 30) {
      deltas.soldCount30d = subtractBigInt(currentSold, baseline.soldCountTotal);
      deltas.gmv30d = subtractDecimal(currentGmv, baseline.gmvTotal);
    } else {
      deltas.soldCount90d = subtractBigInt(currentSold, baseline.soldCountTotal);
      deltas.gmv90d = subtractDecimal(currentGmv, baseline.gmvTotal);
    }
  }

  return deltas;
}

/**
 * Chọn snapshot tại/trước mốc baseline (cùng ngày hoặc gần nhất trước đó).
 * KHÔNG fallback về snapshot mới hơn mốc: thà thiếu delta (null) còn hơn gán
 * sai nhãn "90 ngày" cho dữ liệu chỉ có vài ngày lịch sử.
 */
function findBaseline(
  history: Array<{ bucketDate: Date; soldCountTotal: bigint | null; gmvTotal: Prisma.Decimal | null }>,
  baselineDate: Date,
): { soldCountTotal: bigint | null; gmvTotal: Prisma.Decimal | null } | null {
  let candidate: (typeof history)[number] | null = null;

  for (const row of history) {
    if (row.bucketDate.getTime() > baselineDate.getTime()) break;
    candidate = row;
  }

  return candidate;
}

function subtractBigInt(current: bigint | null, previous: bigint | null): bigint | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  return diff < 0n ? 0n : diff;
}

function subtractDecimal(current: Prisma.Decimal | null, previous: Prisma.Decimal | null): Prisma.Decimal | null {
  if (current === null || previous === null) return null;
  const diff = current.minus(previous);
  return diff.lessThan(0) ? new Prisma.Decimal(0) : diff;
}

function estimateGmv(product: ScrapedShopProduct): Prisma.Decimal | null {
  const sold = toOptionalBigInt(product.soldCount);
  if (sold === null || product.price === null) return null;
  return product.price.mul(sold.toString());
}

/* ------------------------------------------------------------------ */
/* Snapshot payloads                                                  */
/* ------------------------------------------------------------------ */

function buildShopSnapshotData(
  product: ScrapedShopProduct,
  deltas: CommerceDeltas,
  source: string,
): Omit<Prisma.ProductSnapshotUncheckedCreateInput, 'productId' | 'scrapeJobId' | 'source' | 'capturedAt' | 'bucketDate'> {
  const gmvTotal = estimateGmv(product) ?? null;

  return {
    price: product.price,
    originalPrice: product.originalPrice,
    stockTotal: product.stockTotal,
    ratingScore: product.ratingScore,
    ratingCount: toOptionalBigInt(product.ratingCount),
    soldCountTotal: toOptionalBigInt(product.soldCount),
    soldCount1d: deltas.soldCount1d,
    soldCount7d: deltas.soldCount7d,
    soldCount30d: deltas.soldCount30d,
    soldCount90d: deltas.soldCount90d,
    sellerCount: product.sellerCount,
    gmvTotal,
    gmv1d: deltas.gmv1d,
    gmv7d: deltas.gmv7d,
    gmv30d: deltas.gmv30d,
    gmv90d: deltas.gmv90d,
    // gmvTotal is computed as current price × cumulative soldCount.
    isEstimated: true,
    rawData: toJsonValue({ ...product.rawData, source }) as Prisma.InputJsonValue,
  };
}

function buildShopProductSnapshotData(
  product: ScrapedShopProduct,
  deltas: CommerceDeltas,
  source: string,
): Omit<Prisma.ShopProductSnapshotUncheckedCreateInput, 'productShopId' | 'scrapeJobId' | 'source' | 'capturedAt' | 'bucketDate'> {
  return {
    price: product.price,
    soldCountTotal: toOptionalBigInt(product.soldCount),
    soldCount1d: deltas.soldCount1d,
    soldCount7d: deltas.soldCount7d,
    soldCount30d: deltas.soldCount30d,
    soldCount90d: deltas.soldCount90d,
    gmvTotal: estimateGmv(product) ?? null,
    gmv1d: deltas.gmv1d,
    gmv7d: deltas.gmv7d,
    gmv30d: deltas.gmv30d,
    gmv90d: deltas.gmv90d,
    // Snapshot GMV is an estimate, not revenue reported by TikTok.
    isEstimated: true,
    rawData: toJsonValue({ source, productId: product.platformProductId }) as Prisma.InputJsonValue,
  };
}

/**
 * Tổng hợp lại GMV/số bán/giá trị đơn trung bình của shop từ snapshot sản phẩm
 * của chính chu kỳ (cùng source + bucketDate). Chạy sau mỗi sản phẩm nên luôn
 * phản ánh trạng thái cuối cùng của lô.
 */
async function syncShopAggregates(
  tx: Prisma.TransactionClient,
  shopId: number,
  source: string,
  bucketDate: Date,
  capturedAt: Date,
): Promise<void> {
  const rows = await tx.productShop.findMany({
    where: { shopId, isActive: true },
    select: {
      product: {
        select: {
          soldCount: true,
          ratingScore: true,
          ratingCount: true,
          productUrl: true,
          imageUrl: true,
        },
      },
      snapshots: {
        where: { source },
        orderBy: { bucketDate: 'desc' },
        select: { gmvTotal: true, soldCountTotal: true },
        take: 1,
      },
    },
  });

  let gmvTotal = new Prisma.Decimal(0);
  let soldTotal = 0n;
  let ratedCount = 0;
  let ratingSum = new Prisma.Decimal(0);
  let ratingCount = 0n;

  for (const row of rows) {
    const snapshot = row.snapshots[0];
    const gmv = snapshot?.gmvTotal;
    if (gmv) gmvTotal = gmvTotal.plus(gmv);

    const sold = toOptionalBigInt(snapshot?.soldCountTotal) ?? toOptionalBigInt(row.product.soldCount);
    if (sold) soldTotal += sold;

    const score = row.product.ratingScore;
    if (score) {
      ratingSum = ratingSum.plus(score);
      ratedCount += 1;
    }
    const count = toOptionalBigInt(row.product.ratingCount);
    if (count) ratingCount += count;
  }

  const avgOrderValue =
    soldTotal > 0n ? gmvTotal.div(new Prisma.Decimal(soldTotal.toString())) : null;
  const ratingScore = ratedCount > 0 ? ratingSum.div(ratedCount) : null;

  await tx.shop.update({
    where: { id: shopId },
    data: {
      productCount: rows.length,
      gmvTotal: rows.length > 0 ? gmvTotal : null,
      soldCountTotal: soldTotal > 0n ? soldTotal : null,
      avgOrderValue,
      ratingScore,
      ratingCount: ratingCount > 0n ? ratingCount : null,
      lastSeenAt: capturedAt,
    },
  });

  await tx.shopRevenueSnapshot.upsert({
    where: { shopId_source_bucketDate: { shopId, source, bucketDate } },
    update: {
      gmvTotal: rows.length > 0 ? gmvTotal : null,
      soldCountTotal: soldTotal > 0n ? soldTotal : null,
      productCount: rows.length,
      avgOrderValue,
      ratingScore,
      ratingCount: ratingCount > 0n ? ratingCount : null,
      isEstimated: true,
    },
    create: {
      shopId,
      source,
      capturedAt,
      bucketDate,
      gmvTotal: rows.length > 0 ? gmvTotal : null,
      soldCountTotal: soldTotal > 0n ? soldTotal : null,
      productCount: rows.length,
      avgOrderValue,
      ratingScore,
      ratingCount: ratingCount > 0n ? ratingCount : null,
      isEstimated: true,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Video đang bán sản phẩm                                            */
/* ------------------------------------------------------------------ */

/**
 * Lưu video gắn sản phẩm/shop vào TrendItem.
 * Chỉ nhận video có `platformVideoId` — video do Actor trả về trong ngữ cảnh
 * sản phẩm, không phải trend giải trí ngoài lề.
 */
async function persistShopVideos(
  tx: Prisma.TransactionClient,
  videos: readonly ScrapedShopVideo[],
  productId: number,
  shopId: number,
  bucketDate: Date,
  capturedAt: Date,
): Promise<void> {
  const creatorIds = await linkVideoCreators(tx, videos, productId, shopId, capturedAt);

  for (const video of videos) {
    if (!video.platformVideoId) continue;
    const creatorKey = creatorKeyOf(video);
    const creatorId = creatorKey ? (creatorIds.get(creatorKey) ?? null) : null;

    await tx.trendItem.upsert({
      where: { platformVideoId: video.platformVideoId },
      update: {
        content: video.content,
        author: video.author,
        videoUrl: video.videoUrl,
        coverUrl: video.coverUrl,
        playCount: toOptionalBigInt(video.playCount),
        diggCount: toOptionalBigInt(video.diggCount),
        shareCount: toOptionalBigInt(video.shareCount),
        commentCount: toOptionalBigInt(video.commentCount),
        productId,
        shopId,
        ...(creatorId !== null ? { creatorId } : {}),
        bucketDate,
        scrapedAt: new Date(),
      },
      create: {
        platformVideoId: video.platformVideoId,
        content: video.content,
        author: video.author,
        videoUrl: video.videoUrl,
        coverUrl: video.coverUrl,
        playCount: toOptionalBigInt(video.playCount),
        diggCount: toOptionalBigInt(video.diggCount),
        shareCount: toOptionalBigInt(video.shareCount),
        commentCount: toOptionalBigInt(video.commentCount),
        productId,
        shopId,
        creatorId,
        bucketDate,
      },
    });
  }
}

/** Stable creator mapping is allowed only when the Actor provides the real author ID. */
function creatorKeyOf(video: ScrapedShopVideo): string | null {
  return video.authorId ? `id_${video.authorId}` : null;
}

/** Persist video authors from real Actor fields; never infer product GMV or sales. */
async function linkVideoCreators(
  tx: Prisma.TransactionClient,
  videos: readonly ScrapedShopVideo[],
  productId: number,
  shopId: number,
  capturedAt: Date,
): Promise<Map<string, number>> {
  const groups = new Map<string, { authorId: string; name: string; videoCount: number; isAffiliate: boolean }>();

  for (const video of videos) {
    const key = creatorKeyOf(video);
    const name = video.author?.trim();
    if (!key || !video.authorId || !name) continue;
    const group = groups.get(key) ?? { authorId: video.authorId, name, videoCount: 0, isAffiliate: false };
    group.videoCount += 1;
    group.isAffiliate = group.isAffiliate || video.isAffiliate;
    groups.set(key, group);
  }

  const result = new Map<string, number>();
  if (groups.size === 0) return result;

  for (const [key, group] of groups) {
    const platformCreatorId = group.authorId;

    const creator = await tx.creator.upsert({
      where: {
        platformCreatorId_source: {
          platformCreatorId,
          source: SOURCE.APIFY_SHOP,
        },
      },
      update: {
        displayName: group.name,
        ...(group.isAffiliate ? { role: 'AFFILIATE' as const } : {}),
        lastSeenAt: capturedAt,
      },
      create: {
        platformCreatorId,
        source: SOURCE.APIFY_SHOP,
        displayName: group.name,
        role: group.isAffiliate ? 'AFFILIATE' : 'CREATOR',
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
      select: { id: true },
    });
    result.set(key, creator.id);

    await tx.productCreator.upsert({
      where: { productId_creatorId: { productId, creatorId: creator.id } },
      update: { isActive: true, gmvTotal: null, soldCount: null, videoCount: group.videoCount, lastSeenAt: capturedAt },
      create: {
        productId,
        creatorId: creator.id,
        isActive: true,
        gmvTotal: null,
        soldCount: null,
        videoCount: group.videoCount,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
    });

    const perShop = await tx.productCreator.aggregate({
      where: { creatorId: creator.id, product: { shopId } },
      _sum: { videoCount: true },
    });
    await tx.creatorShop.upsert({
      where: { creatorId_shopId: { creatorId: creator.id, shopId } },
      update: {
        isActive: true,
        gmvTotal: null,
        soldCount: null,
        videoCount: perShop._sum.videoCount,
        lastSeenAt: capturedAt,
      },
      create: {
        creatorId: creator.id,
        shopId,
        isActive: true,
        gmvTotal: null,
        soldCount: null,
        videoCount: perShop._sum.videoCount,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
    });

    const total = await tx.productCreator.aggregate({
      where: { creatorId: creator.id },
      _sum: { videoCount: true },
    });
    await tx.creator.update({
      where: { id: creator.id },
      data: {
        videoCount: total._sum.videoCount,
      },
    });
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Affiliates                                                         */
/* ------------------------------------------------------------------ */

async function persistShopAffiliates(
  tx: Prisma.TransactionClient,
  affiliates: readonly ScrapedShopAffiliate[],
  shopId: number,
  capturedAt: Date,
): Promise<void> {
  for (const affiliate of affiliates) {
    const creator = await tx.creator.upsert({
      where: {
        platformCreatorId_source: {
          platformCreatorId: affiliate.platformCreatorId,
          source: SOURCE.APIFY_SHOP,
        },
      },
      update: {
        displayName: affiliate.displayName,
        role: 'AFFILIATE',
        ...(affiliate.username ? { username: affiliate.username } : {}),
        ...(affiliate.avatarUrl ? { avatarUrl: affiliate.avatarUrl } : {}),
        ...(affiliate.followerCount !== null ? { followerCount: toOptionalBigInt(affiliate.followerCount) } : {}),
        ...(affiliate.engagementRate !== null ? { engagementRate: affiliate.engagementRate } : {}),
        ...(affiliate.gmvTotal !== null ? { gmvTotal: affiliate.gmvTotal } : {}),
        ...(affiliate.soldCount !== null ? { soldCount: toOptionalBigInt(affiliate.soldCount) } : {}),
        ...(affiliate.videoCount !== null ? { videoCount: affiliate.videoCount } : {}),
        lastSeenAt: capturedAt,
      },
      create: {
        platformCreatorId: affiliate.platformCreatorId,
        source: SOURCE.APIFY_SHOP,
        username: affiliate.username,
        displayName: affiliate.displayName,
        avatarUrl: affiliate.avatarUrl,
        role: 'AFFILIATE',
        followerCount: toOptionalBigInt(affiliate.followerCount),
        engagementRate: affiliate.engagementRate,
        gmvTotal: affiliate.gmvTotal,
        soldCount: toOptionalBigInt(affiliate.soldCount),
        videoCount: affiliate.videoCount,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
      select: { id: true },
    });

    await tx.creatorShop.upsert({
      where: { creatorId_shopId: { creatorId: creator.id, shopId } },
      update: {
        isActive: true,
        ...(affiliate.gmvTotal !== null ? { gmvTotal: affiliate.gmvTotal } : {}),
        ...(affiliate.soldCount !== null ? { soldCount: toOptionalBigInt(affiliate.soldCount) } : {}),
        ...(affiliate.videoCount !== null ? { videoCount: affiliate.videoCount } : {}),
        lastSeenAt: capturedAt,
      },
      create: {
        creatorId: creator.id,
        shopId,
        isActive: true,
        gmvTotal: affiliate.gmvTotal,
        soldCount: toOptionalBigInt(affiliate.soldCount),
        videoCount: affiliate.videoCount,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Variants                                                           */
/* ------------------------------------------------------------------ */

async function persistShopVariants(
  tx: Prisma.TransactionClient,
  productId: number,
  variants: readonly ScrapedShopVariant[],
  capturedAt: Date,
): Promise<void> {
  for (const variant of variants) {
    const attributesJson =
      variant.attributes && Object.keys(variant.attributes).length > 0
        ? (variant.attributes as Prisma.InputJsonObject)
        : Prisma.JsonNull;

    await tx.productVariant.upsert({
      where: { productId_platformSkuId: { productId, platformSkuId: variant.platformSkuId } },
      update: {
        name: variant.name,
        price: variant.price,
        originalPrice: variant.originalPrice,
        stock: variant.stock,
        soldCount: variant.soldCount,
        isAvailable: variant.isAvailable,
        attributes: attributesJson,
        lastSeenAt: capturedAt,
      },
      create: {
        productId,
        platformSkuId: variant.platformSkuId,
        name: variant.name,
        price: variant.price,
        originalPrice: variant.originalPrice,
        stock: variant.stock,
        soldCount: variant.soldCount,
        isAvailable: variant.isAvailable,
        attributes: attributesJson,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

interface PriceRangeFields {
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  minOriginalPrice: Prisma.Decimal | null;
  maxOriginalPrice: Prisma.Decimal | null;
}

/**
 * Đồng bộ sellerCount: ưu tiên số liệu Actor (nếu có), ngược lại đếm số shop
 * đang active bán sản phẩm. Không bao giờ giảm về 0 khi đã có dữ liệu.
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

function priceRangeUpdate(product: ScrapedShopProduct): PriceRangeFields & { variantCount?: number } {
  const hasVariants = product.variants.length > 0;

  return {
    minPrice: product.minPrice ?? product.maxPrice ?? product.price,
    maxPrice: product.maxPrice ?? product.minPrice ?? product.price,
    minOriginalPrice: product.minOriginalPrice ?? product.maxOriginalPrice ?? product.originalPrice,
    maxOriginalPrice: product.maxOriginalPrice ?? product.minOriginalPrice ?? product.originalPrice,
    ...(hasVariants ? { variantCount: product.variants.length } : {}),
  };
}

function priceRangeCreate(product: ScrapedShopProduct): PriceRangeFields {
  return {
    minPrice: product.minPrice ?? product.maxPrice ?? product.price,
    maxPrice: product.maxPrice ?? product.minPrice ?? product.price,
    minOriginalPrice: product.minOriginalPrice ?? product.maxOriginalPrice ?? product.originalPrice,
    maxOriginalPrice: product.maxOriginalPrice ?? product.minOriginalPrice ?? product.originalPrice,
  };
}

type JsonSafe = null | string | number | boolean | JsonSafe[] | { [key: string]: JsonSafe };

function toJsonValue(value: unknown): JsonSafe {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return isValidDate(value) ? value.toISOString() : null;
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry));
  if (typeof value === 'object') {
    const output: Record<string, JsonSafe> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = toJsonValue(entry);
    }
    return output;
  }
  return null;
}
