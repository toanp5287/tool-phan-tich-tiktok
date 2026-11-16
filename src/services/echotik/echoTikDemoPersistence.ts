import { Prisma } from '@prisma/client';
import prisma from '../../config/db.js';
import { count, id, mergePresent, metrics, profile, text, variants, type Row } from './echoTikDemoMapping.js';

export interface DemoDataset {
  product: Row; shop: Row; videos: Row[]; creators: Row[]; creatorDetails: Row[]; videoDetails: Row[];
  capturedAt: Date; rawRequestKeys: string[];
}

export async function persistDemo(jobId: number, input: DemoDataset) {
  const productId = id(input.product.product_id);
  const sellerId = id(input.product.seller_id);
  if (sellerId !== id(input.shop.seller_id)) throw new Error('Shop does not match product seller_id');
  return prisma.$transaction(async (tx) => {
    const previous = await tx.intelligenceObservation.findFirst({ where: { scrapeJobId: jobId } });
    if (previous) return previous.productId;
    const existing = await tx.product.findFirst({ where: { platformProductId: productId } });
    if (existing || productId === '1729427780723968911') throw new Error('Demo requires a new product, excluding product 149');
    const shopProfile = profile(input.shop, 'SHOP');
    if (!shopProfile.name || !text(input.shop.region)) throw new Error('Shop identity is incomplete');
    const shop = await tx.shop.upsert({
      where: { platformShopId_source: { platformShopId: sellerId, source: 'echotik' } },
      create: { platformShopId: sellerId, source: 'echotik', name: shopProfile.name, region: text(input.shop.region)!, shopUrl: text(input.shop.seller_link), avatarUrl: shopProfile.images[0] ?? null, followerCount: count(input.shop.followers_count) },
      // Do not overwrite existing shop metrics/profile from an earlier collection.
      update: {},
    });
    const productProfile = profile(input.product, 'PRODUCT');
    if (!productProfile.name || input.product.region !== 'VN') throw new Error('Product must have a name and VN region');
    const skus = variants(input.product);
    const knownPrices = skus.filter((sku) => sku.price !== null && sku.currency === 'VND').map((sku) => new Prisma.Decimal(sku.price!));
    const lowPrice = knownPrices.reduce<Prisma.Decimal | null>((low, price) => !low || price.lt(low) ? price : low, null);
    const highPrice = knownPrices.reduce<Prisma.Decimal | null>((high, price) => !high || price.gt(high) ? price : high, null);
    const product = await tx.product.create({ data: {
      platformProductId: productId, source: 'echotik', title: productProfile.name,
      description: productProfile.description, imageUrl: productProfile.images[0] ?? null,
      region: 'VN', currency: knownPrices.length ? 'VND' : 'UNKNOWN', minPrice: lowPrice, maxPrice: highPrice, variantCount: skus.length, shopId: shop.id, soldCount: count(input.product.total_sale_cnt),
      // Category external IDs are preserved in observations, not mislabeled as names.
    } });
    await tx.productShop.create({ data: { productId: product.id, shopId: shop.id } });
    for (const sku of skus) {
      await tx.productVariant.create({ data: { productId: product.id, platformSkuId: sku.externalId, price: sku.price, stock: sku.stock !== null && BigInt(sku.stock) <= 2147483647n ? Number(sku.stock) : null } });
    }
    const observe = async (kind: string, externalId: string, data: object) => {
      await tx.intelligenceObservation.create({ data: { productId: product.id, scrapeJobId: jobId, kind, externalId, source: 'echotik', capturedAt: input.capturedAt, rawRequestKeys: input.rawRequestKeys, data: data as unknown as Prisma.InputJsonValue } });
    };
    await observe('PRODUCT', productId, { ...productProfile, metrics: metrics(input.product, 'PRODUCT'), variants: skus, categoryIds: [input.product.category_id ?? null, input.product.category_l2_id ?? null, input.product.category_l3_id ?? null], monetaryUnit: 'UNVERIFIED' });
    await observe('SHOP', sellerId, { ...shopProfile, metrics: metrics(input.shop, 'SHOP'), monetaryUnit: 'UNVERIFIED' });
    const creatorIds = new Map<string, number>();
    for (const related of input.creators) {
      const externalId = id(related.user_id);
      const detail = input.creatorDetails.find((row) => id(row.user_id) === externalId);
      if (!detail) throw new Error('Missing selected creator detail');
      const value = mergePresent(related, detail);
      const creatorProfile = profile(value, 'CREATOR');
      if (!creatorProfile.name) throw new Error('Creator name missing');
      const creator = await tx.creator.upsert({
        where: { platformCreatorId_source: { platformCreatorId: externalId, source: 'echotik' } },
        create: { platformCreatorId: externalId, source: 'echotik', displayName: creatorProfile.name, username: creatorProfile.username, avatarUrl: creatorProfile.images[0] ?? null, bio: creatorProfile.description, region: text(value.region) ?? 'UNKNOWN', followerCount: count(value.total_followers_cnt), followingCount: count(value.total_following_cnt) },
        update: {},
      });
      creatorIds.set(externalId, creator.id);
      // Estimated product attribution lives in the observation, not unqualified aggregate columns.
      await tx.productCreator.create({ data: { productId: product.id, creatorId: creator.id } });
      await observe('CREATOR', externalId, { ...creatorProfile, metrics: metrics(value, 'CREATOR'), metricScope: 'CREATOR_TOTAL' });
      await observe('PRODUCT_CREATOR', externalId, { metrics: metrics(related, 'PRODUCT_CREATOR'), metricScope: 'PRODUCT_CREATOR', productExternalId: productId });
    }
    for (const related of input.videos) {
      const externalId = id(related.video_id);
      const detail = input.videoDetails.find((row) => id(row.video_id) === externalId);
      if (!detail) throw new Error('Missing selected video detail');
      if (detail.user_id != null && related.user_id != null && id(detail.user_id) !== id(related.user_id)) throw new Error('Video author mismatch');
      const videoProfile = profile(mergePresent(related, detail), 'VIDEO');
      const authorId = videoProfile.authorExternalId;
      // Global unique legacy video IDs may belong to other providers. Never update them.
      let video = await tx.trendItem.findUnique({ where: { platformVideoId: externalId } });
      if (!video) video = await tx.trendItem.create({ data: { platformVideoId: externalId, content: videoProfile.name ?? '', coverUrl: videoProfile.images[0] ?? null, creatorId: authorId ? creatorIds.get(authorId) ?? null : null, playCount: count(detail.total_views_cnt), diggCount: count(detail.total_digg_cnt), commentCount: count(detail.total_comments_cnt), shareCount: count(detail.total_shares_cnt) } });
      await tx.productVideo.create({ data: { productId: product.id, trendItemId: video.id, source: 'echotik' } });
      await observe('VIDEO', externalId, { ...videoProfile, creatorInternalId: authorId ? creatorIds.get(authorId) ?? null : null, metrics: metrics(detail, 'VIDEO'), metricScope: 'VIDEO_TOTAL', durationUnit: 'UNVERIFIED' });
      await observe('PRODUCT_VIDEO', externalId, { metrics: metrics(related, 'VIDEO'), metricScope: 'PRODUCT_VIDEO_CONTEXT', attribution: 'UNVERIFIED', productExternalId: productId });
    }
    return product.id;
  }, { timeout: 30000 });
}
