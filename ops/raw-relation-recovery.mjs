import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../generated/v2');

const PRODUCT_KEYS = new Set(['product_id', 'productid', 'item_id', 'itemid', 'product_id_str', 'item_id_str']);
const SHOP_ID_PATTERN = /\/(?:store|shop)\/(?:[^/]+\/)?(\d{15,})(?:[/?#]|$)/i;
const PRODUCT_ID_PATTERN = /^\d{15,}$/;

export function parseJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function canonicalId(value) {
  const id = String(value ?? '').trim();
  return PRODUCT_ID_PATTERN.test(id) ? id : null;
}

export function canonicalShopId(payload) {
  const store = parseJson(payload.store_details) ?? {};
  for (const value of [payload.seller_url, store.url]) {
    const match = String(value ?? '').match(SHOP_ID_PATTERN);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function explicitProductIds(value, path = '$', found = []) {
  const input = parseJson(value);
  if (Array.isArray(input)) {
    input.forEach((entry, index) => explicitProductIds(entry, `${path}[${index}]`, found));
    return found;
  }
  if (!input || typeof input !== 'object') return found;
  for (const [key, raw] of Object.entries(input)) {
    const nextPath = `${path}.${key}`;
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (PRODUCT_KEYS.has(normalized)) {
      const id = canonicalId(raw);
      if (id) found.push({ id, path: nextPath });
    }
    explicitProductIds(raw, nextPath, found);
  }
  return found;
}

export function postCommerceProductIds(payload) {
  const found = [];
  for (const key of ['commerce_info', 'offical_item', 'original_item']) {
    explicitProductIds(payload[key], `$.${key}`, found);
  }
  return [...new Map(found.map(item => [`${item.id}:${item.path}`, item])).values()];
}

export function candidate(kind, status, rawRecordId, detail) {
  return { kind, status, rawRecordId: String(rawRecordId), ...detail };
}

function increment(target, key, value = 1) { target[key] = (target[key] ?? 0) + value; }

function identityMaps(identities) {
  const product = new Map(); const shop = new Map(); const video = new Map();
  for (const row of identities) {
    if (row.namespace === 'tiktok:product' && row.productId !== null) product.set(row.externalId, row.productId);
    if (row.namespace === 'tiktok:shop' && row.shopId !== null) shop.set(row.externalId, row.shopId);
    if (row.namespace === 'tiktok:post' && row.videoId !== null) video.set(row.externalId, row.videoId);
  }
  return { product, shop, video };
}

export async function discoverRawRelationships(db, { batchSize = 500, sampleLimit = 20 } = {}) {
  const [identities, channels] = await Promise.all([
    db.externalIdentity.findMany({ select: { namespace: true, externalId: true, productId: true, shopId: true, videoId: true } }),
    db.creatorChannel.findMany({ select: { id: true, creatorId: true } }),
  ]);
  const ids = identityMaps(identities);
  const creatorByChannel = new Map(channels.filter(row => row.creatorId !== null).map(row => [row.id, row.creatorId]));
  const result = {
    scanned: 0,
    bySource: {},
    candidates: { ProductShop: { VERIFIED: 0, SUGGESTED: 0, NEEDS_REVIEW: 0 }, ProductVideo: { VERIFIED: 0, SUGGESTED: 0, NEEDS_REVIEW: 0 }, ProductCreator: { VERIFIED: 0, SUGGESTED: 0, NEEDS_REVIEW: 0 } },
    rejected: { cdnMediaWithoutPostId: 0, maskedSellerId: 0, unresolvedCanonicalId: 0, channelWithoutCreator: 0 },
    samples: [],
  };
  const seen = new Set();
  let cursor;
  while (true) {
    const rows = await db.rawRecord.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: batchSize,
      orderBy: { id: 'asc' },
      include: { file: { include: { source: true } } },
    });
    if (!rows.length) break;
    for (const row of rows) {
      result.scanned++;
      const source = row.file.source.code;
      result.bySource[source] ??= { records: 0, fields: {}, candidates: 0 };
      result.bySource[source].records++;
      const payload = row.payload;
      const normalized = row.normalized ?? {};
      if (source === 'brightdata-shop') {
        const productExternalId = canonicalId(payload.id ?? normalized.externalId);
        const shopExternalId = canonicalShopId(payload);
        if (!shopExternalId && String(payload.seller_id ?? '').includes('*')) increment(result.rejected, 'maskedSellerId');
        if (productExternalId && shopExternalId) {
          const productId = ids.product.get(productExternalId);
          const shopId = ids.shop.get(shopExternalId);
          const status = productId && shopId ? 'VERIFIED' : 'SUGGESTED';
          const key = `ProductShop:${row.id}:${productExternalId}:${shopExternalId}`;
          if (!seen.has(key)) {
            seen.add(key); increment(result.candidates.ProductShop, status); result.bySource[source].candidates++;
            const item = candidate('ProductShop', status, row.id, { productExternalId, shopExternalId, productId: productId ?? null, shopId: shopId ?? null, evidencePath: payload.seller_url ? '$.seller_url' : '$.store_details.url', method: 'RAW_PRODUCT_ID_AND_CANONICAL_SHOP_URL_V1' });
            if (result.samples.length < sampleLimit) result.samples.push(item);
            if (status !== 'VERIFIED') increment(result.rejected, 'unresolvedCanonicalId');
          }
        }
        const media = [payload.videos, payload.video_link, payload.related_videos].some(value => String(value ?? '').trim() && !['[]', 'null'].includes(String(value).trim()));
        if (media) increment(result.rejected, 'cdnMediaWithoutPostId');
      }
      if (source === 'brightdata-posts') {
        const postExternalId = canonicalId(payload.post_id ?? normalized.externalId);
        const videoId = postExternalId ? ids.video.get(postExternalId) : null;
        const channelId = Number(normalized.channelId ?? 0) || null;
        const creatorId = channelId ? creatorByChannel.get(channelId) : null;
        const references = postCommerceProductIds(payload);
        if (references.length) result.bySource[source].fields.explicitProductReferences = (result.bySource[source].fields.explicitProductReferences ?? 0) + references.length;
        for (const reference of references) {
          const productId = ids.product.get(reference.id);
          const status = productId && videoId ? 'VERIFIED' : 'SUGGESTED';
          const videoKey = `ProductVideo:${row.id}:${reference.id}:${postExternalId}`;
          if (!seen.has(videoKey)) {
            seen.add(videoKey); increment(result.candidates.ProductVideo, status); result.bySource[source].candidates++;
            const item = candidate('ProductVideo', status, row.id, { productExternalId: reference.id, postExternalId, productId: productId ?? null, videoId: videoId ?? null, evidencePath: reference.path, method: 'RAW_POST_AND_EXPLICIT_PRODUCT_REFERENCE_V1' });
            if (result.samples.length < sampleLimit) result.samples.push(item);
            if (status !== 'VERIFIED') increment(result.rejected, 'unresolvedCanonicalId');
          }
          if (status === 'VERIFIED') {
            const creatorStatus = creatorId ? 'VERIFIED' : 'NEEDS_REVIEW';
            const creatorKey = `ProductCreator:${row.id}:${reference.id}:${creatorId ?? channelId}`;
            if (!seen.has(creatorKey)) {
              seen.add(creatorKey); increment(result.candidates.ProductCreator, creatorStatus);
              const item = candidate('ProductCreator', creatorStatus, row.id, { productExternalId: reference.id, productId, videoId, channelId, creatorId: creatorId ?? null, evidencePath: reference.path, method: 'DERIVED_VERIFIED_PRODUCT_VIDEO_AND_CHANNEL_CREATOR_V1' });
              if (result.samples.length < sampleLimit) result.samples.push(item);
              if (!creatorId) increment(result.rejected, 'channelWithoutCreator');
            }
          }
        }
      }
    }
    cursor = rows.at(-1).id;
  }
  return result;
}

export async function applyVerifiedRawRelationships(db, discovery) {
  const verified = discovery.samples.filter(item => item.status === 'VERIFIED');
  if (discovery.candidates.ProductShop.VERIFIED + discovery.candidates.ProductVideo.VERIFIED + discovery.candidates.ProductCreator.VERIFIED > verified.length) {
    throw new Error('Refusing apply: discovery sample limit hides candidates. Re-run with sampleLimit above verified count.');
  }
  let created = 0; let existing = 0;
  for (const item of verified) {
    if (item.kind === 'ProductShop') {
      const link = await db.productShop.upsert({ where: { productId_shopId: { productId: item.productId, shopId: item.shopId } }, update: {}, create: { productId: item.productId, shopId: item.shopId, isActive: true, verificationStatus: 'VERIFIED' } });
      const evidence = await db.relationEvidence.findFirst({ where: { rawRecordId: BigInt(item.rawRecordId), productShopId: link.id } });
      if (!evidence) { await db.relationEvidence.create({ data: { rawRecordId: BigInt(item.rawRecordId), productShopId: link.id, verificationStatus: 'VERIFIED', method: item.method, evidencePath: item.evidencePath, explanation: 'Canonical product ID and canonical shop ID occur in the same source record.' } }); created++; } else existing++;
    }
    if (item.kind === 'ProductVideo') {
      const link = await db.productVideo.upsert({ where: { productId_videoId: { productId: item.productId, videoId: item.videoId } }, update: {}, create: { productId: item.productId, videoId: item.videoId, verificationStatus: 'VERIFIED' } });
      const evidence = await db.relationEvidence.findFirst({ where: { rawRecordId: BigInt(item.rawRecordId), productVideoId: link.id } });
      if (!evidence) { await db.relationEvidence.create({ data: { rawRecordId: BigInt(item.rawRecordId), productVideoId: link.id, verificationStatus: 'VERIFIED', method: item.method, evidencePath: item.evidencePath, explanation: 'Canonical post ID and explicit product ID occur in the same commerce payload.' } }); created++; } else existing++;
    }
    if (item.kind === 'ProductCreator') {
      const link = await db.productCreator.upsert({ where: { productId_creatorId: { productId: item.productId, creatorId: item.creatorId } }, update: {}, create: { productId: item.productId, creatorId: item.creatorId, verificationStatus: 'VERIFIED' } });
      const evidence = await db.relationEvidence.findFirst({ where: { rawRecordId: BigInt(item.rawRecordId), productCreatorId: link.id } });
      if (!evidence) { await db.relationEvidence.create({ data: { rawRecordId: BigInt(item.rawRecordId), productCreatorId: link.id, verificationStatus: 'VERIFIED', method: item.method, evidencePath: item.evidencePath, explanation: 'Derived from a verified product-video relation and the video channel canonical creator.' } }); created++; } else existing++;
    }
  }
  return { created, existing };
}

export async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && process.env.RECOVERY_APPLY_CONFIRM !== 'APPLY_CANONICAL_RELATIONS') throw new Error('Apply requires RECOVERY_APPLY_CONFIRM=APPLY_CANONICAL_RELATIONS');
  const url = new URL(process.env.NEW_DATABASE_URL ?? '');
  if (url.pathname !== '/tiktok_datasets_v2') throw new Error('Refusing non-dataset database');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  try {
    const discovery = await discoverRawRelationships(db, { sampleLimit: 100_000 });
    const result = apply ? { discovery, applied: await applyVerifiedRawRelationships(db, discovery) } : { mode: 'DRY_RUN', discovery };
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) await main();
