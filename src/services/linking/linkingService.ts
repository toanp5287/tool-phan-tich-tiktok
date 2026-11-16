/**
 * Linking & classification backfill service.
 *
 * Idempotent: only touches entities that lack a primary classification, uses
 * unique-key upserts where they exist, and never rewrites a CONFIRMED
 * (source-path) link. It only ADDS semantic category/niche/topic grouping — it
 * never creates creator/video <-> product promotion links from text similarity.
 */

import { datasetDb as db } from '../../config/datasetDb.js';
import { createLogger } from '../../utils/logger.js';
import { classifyToGroup, type MatchTier, type Resolver } from './matcher.js';

const logger = createLogger('linking');

const resolver: Resolver = {
  async categoryByName(name: string) {
    return (await db.category.findFirst({ where: { name }, select: { id: true } })) ?? undefined;
  },
  async subCategoryByNames(categoryId: number, name: string) {
    return (
      (await db.subCategory.findFirst({ where: { categoryId, name }, select: { id: true } })) ?? undefined
    );
  },
};

function verificationStatusFor(tier: MatchTier) {
  switch (tier) {
    case 'CONFIRMED':
      return 'VERIFIED' as const;
    case 'INFERRED':
      return 'SUGGESTED' as const;
    default:
      return 'NEEDS_REVIEW' as const;
  }
}

interface Target { categoryId: number; subCategoryId: number | null }

interface Resolved { target: Target; tier: MatchTier; reason: string; confidence: number }

/**
 * Resolve a semantic group to concrete DB ids. If the named sub-category is not in
 * the taxonomy, downgrade to a category-only PROVISIONAL link (never invent a sub).
 */
async function resolveTarget(target: NonNullable<ReturnType<typeof classifyToGroup>>): Promise<Resolved | null> {
  const category = await resolver.categoryByName(target.category);
  if (!category) return null;
  if (!target.subCategory) {
    return { target: { categoryId: category.id, subCategoryId: null }, tier: target.tier, reason: target.reason, confidence: target.confidence };
  }
  const sub = await resolver.subCategoryByNames(category.id, target.subCategory);
  if (sub) {
    return { target: { categoryId: category.id, subCategoryId: sub.id }, tier: target.tier, reason: target.reason, confidence: target.confidence };
  }
  return {
    target: { categoryId: category.id, subCategoryId: null },
    tier: 'PROVISIONAL',
    reason: `Tạm thời: ngành con "${target.subCategory}" chưa có trong taxonomy, xếp vào ngành "${target.category}".`,
    confidence: Math.min(target.confidence, 35),
  };
}

/** ProductCategory has no compound unique key; only a partial unique on isPrimary. */
async function linkProductCategory(productId: number, resolved: Resolved): Promise<void> {
  const { target, tier, reason, confidence } = resolved;
  const existing = await db.productCategory.findFirst({ where: { productId, isPrimary: true }, select: { id: true, method: true } });
  if (existing) {
    // Never overwrite a source-derived classification with a weaker semantic guess.
    if (existing.method !== 'SEMANTIC_GROUP') return;
    await db.productCategory.update({ where: { id: existing.id }, data: { status: tier, reason, confidence, verificationStatus: verificationStatusFor(tier) } });
  } else {
    await db.productCategory.create({
      data: {
        productId,
        categoryId: target.categoryId,
        subCategoryId: target.subCategoryId,
        isPrimary: true,
        method: 'SEMANTIC_GROUP',
        verificationStatus: verificationStatusFor(tier),
        status: tier,
        confidence,
        reason,
      },
    });
  }
  const state = tier === 'CONFIRMED' ? 'LINKED' : tier === 'INFERRED' ? 'INFERRED' : 'PROVISIONAL';
  await db.product.update({ where: { id: productId }, data: { processingState: state, lastClassifiedAt: new Date() } });
}

async function linkCreatorCategory(channel: { id: number }, resolved: Resolved): Promise<void> {
  const { target, tier, reason, confidence } = resolved;
  await db.creatorCategory.upsert({
    where: { channelId_categoryId: { channelId: channel.id, categoryId: target.categoryId } },
    update: { status: tier, reason, confidence, verificationStatus: verificationStatusFor(tier) },
    create: {
      channelId: channel.id,
      categoryId: target.categoryId,
      method: 'BIO_SEMANTIC_GROUP',
      verificationStatus: verificationStatusFor(tier),
      status: tier,
      confidence,
      reason,
    },
  });
  await db.creatorChannel.update({ where: { id: channel.id }, data: { processingState: tier === 'CONFIRMED' ? 'LINKED' : tier === 'INFERRED' ? 'INFERRED' : 'PROVISIONAL', lastClassifiedAt: new Date() } });
}

async function linkVideoCategory(videoId: number, resolved: Resolved): Promise<void> {
  const { target, tier, reason, confidence } = resolved;
  await db.videoCategory.upsert({
    where: { videoId_categoryId: { videoId, categoryId: target.categoryId } },
    update: { status: tier, reason, confidence, verificationStatus: verificationStatusFor(tier) },
    create: {
      videoId,
      categoryId: target.categoryId,
      method: 'CONTENT_SEMANTIC_GROUP',
      verificationStatus: verificationStatusFor(tier),
      status: tier,
      confidence,
      reason,
    },
  });
  await db.video.update({ where: { id: videoId }, data: { processingState: tier === 'CONFIRMED' ? 'LINKED' : tier === 'INFERRED' ? 'INFERRED' : 'PROVISIONAL', lastClassifiedAt: new Date() } });
}

interface Progress { checked: number; linked: number }

function progress(): Progress { return { checked: 0, linked: 0 }; }

/** Backfill product classification for products missing a primary category. */
export async function backfillProducts(batchSize = 500): Promise<Progress> {
  const total = await db.product.count({ where: { categories: { none: { isPrimary: true } } } });
  logger.info(`Backfill product classification: ${total} sản phẩm chưa phân loại`);
  const result = progress();
  let cursor = 0;
  while (true) {
    const rows = await db.product.findMany({
      where: { id: { gt: cursor }, categories: { none: { isPrimary: true } } },
      select: { id: true, title: true, description: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (!rows.length) break;
    for (const product of rows) {
      result.checked += 1;
      const target = classifyToGroup(product.title, product.description);
      if (!target) continue;
      const resolved = await resolveTarget(target);
      if (!resolved) continue;
      await linkProductCategory(product.id, resolved);
      result.linked += 1;
    }
    cursor = rows.at(-1)!.id;
  }
  return result;
}

/** Backfill creator niche grouping from bio for channels without any category. */
export async function backfillCreators(batchSize = 500): Promise<Progress> {
  const total = await db.creatorChannel.count({ where: { categories: { none: {} } } });
  logger.info(`Backfill creator niche: ${total} kênh chưa có nhóm nội dung`);
  const result = progress();
  let cursor = 0;
  while (true) {
    const rows = await db.creatorChannel.findMany({
      where: { id: { gt: cursor }, categories: { none: {} } },
      select: { id: true, bio: true, displayName: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (!rows.length) break;
    for (const channel of rows) {
      result.checked += 1;
      const text = `${channel.bio ?? ''} ${channel.displayName ?? ''}`;
      if (!text.trim()) continue;
      const target = classifyToGroup(channel.bio, channel.displayName);
      if (!target) continue;
      const resolved = await resolveTarget(target);
      if (!resolved) continue;
      await linkCreatorCategory({ id: channel.id }, resolved);
      result.linked += 1;
    }
    cursor = rows.at(-1)!.id;
  }
  return result;
}

/** Backfill video topic grouping from caption + hashtags for videos without a category. */
export async function backfillVideos(batchSize = 500): Promise<Progress> {
  const total = await db.video.count({ where: { categories: { none: {} } } });
  logger.info(`Backfill video topic: ${total} video chưa có chủ đề`);
  const result = progress();
  let cursor = 0;
  while (true) {
    const rows = await db.video.findMany({
      where: { id: { gt: cursor }, categories: { none: {} } },
      select: { id: true, caption: true, hashtags: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (!rows.length) break;
    for (const video of rows) {
      result.checked += 1;
      const hashtagText = (video.hashtags ?? []).join(' ');
      const target = classifyToGroup(video.caption, hashtagText);
      if (!target) continue;
      const resolved = await resolveTarget(target);
      if (!resolved) continue;
      await linkVideoCategory(video.id, resolved);
      result.linked += 1;
    }
    cursor = rows.at(-1)!.id;
  }
  return result;
}

export interface BackfillReport {
  products: Progress;
  creators: Progress;
  videos: Progress;
  totals: {
    processed: number;
    linked: number;
    confirmed: number;
    inferred: number;
    provisional: number;
    unresolvedProducts: number;
    unresolvedCreators: number;
    unresolvedVideos: number;
  };
}

async function summarize() {
  const [confirmed, inferred, provisional, unresolvedProducts, unresolvedCreators, unresolvedVideos] = await Promise.all([
    db.productCategory.count({ where: { status: 'CONFIRMED' } }),
    db.productCategory.count({ where: { status: 'INFERRED' } }),
    db.productCategory.count({ where: { status: 'PROVISIONAL' } }),
    db.product.count({ where: { categories: { none: { isPrimary: true } } } }),
    db.creatorChannel.count({ where: { categories: { none: {} } } }),
    db.video.count({ where: { categories: { none: {} } } }),
  ]);
  return { confirmed, inferred, provisional, unresolvedProducts, unresolvedCreators, unresolvedVideos };
}

/** Recompute entity processingState from current links (repairs any backfill drift). */
export async function reconcileStates(): Promise<{ products: number; creators: number; videos: number }> {
  const productStates = await db.$queryRaw<Array<{ id: number; status: string }>>`
    SELECT p.id, CASE WHEN pc.id IS NOT NULL THEN
      CASE pc.status WHEN 'CONFIRMED' THEN 'LINKED' WHEN 'INFERRED' THEN 'INFERRED' ELSE 'PROVISIONAL' END
      ELSE 'NEEDS_DATA' END AS status
    FROM "Product" p
    LEFT JOIN "ProductCategory" pc ON pc."productId" = p.id AND pc."isPrimary"
  `;
  for (const row of productStates) {
    await db.product.update({ where: { id: row.id }, data: { processingState: row.status as 'LINKED' | 'INFERRED' | 'PROVISIONAL' | 'NEEDS_DATA' } });
  }

  const channelStates = await db.$queryRaw<Array<{ id: number; status: string }>>`
    SELECT ch.id, CASE WHEN cc.id IS NOT NULL THEN
      CASE cc.status WHEN 'CONFIRMED' THEN 'LINKED' WHEN 'INFERRED' THEN 'INFERRED' ELSE 'PROVISIONAL' END
      ELSE 'NEEDS_DATA' END AS status
    FROM "CreatorChannel" ch
    LEFT JOIN "CreatorCategory" cc ON cc."channelId" = ch.id OR cc."creatorId" = ch."creatorId"
  `;
  for (const row of channelStates) {
    await db.creatorChannel.update({ where: { id: row.id }, data: { processingState: row.status as 'LINKED' | 'INFERRED' | 'PROVISIONAL' | 'NEEDS_DATA' } });
  }

  const videoStates = await db.$queryRaw<Array<{ id: number; status: string }>>`
    SELECT v.id, CASE WHEN vc.id IS NOT NULL THEN
      CASE vc.status WHEN 'CONFIRMED' THEN 'LINKED' WHEN 'INFERRED' THEN 'INFERRED' ELSE 'PROVISIONAL' END
      ELSE 'NEEDS_DATA' END AS status
    FROM "Video" v
    LEFT JOIN "VideoCategory" vc ON vc."videoId" = v.id
  `;
  for (const row of videoStates) {
    await db.video.update({ where: { id: row.id }, data: { processingState: row.status as 'LINKED' | 'INFERRED' | 'PROVISIONAL' | 'NEEDS_DATA' } });
  }

  return { products: productStates.length, creators: channelStates.length, videos: videoStates.length };
}

/** Run the full idempotent backfill over all three entity kinds. */
export async function runBackfill(): Promise<BackfillReport> {
  const products = await backfillProducts();
  const creators = await backfillCreators();
  const videos = await backfillVideos();
  await reconcileStates();
  const status = await summarize();
  return {
    products,
    creators,
    videos,
    totals: {
      processed: products.checked + creators.checked + videos.checked,
      linked: products.linked + creators.linked + videos.linked,
      ...status,
    },
  };
}
