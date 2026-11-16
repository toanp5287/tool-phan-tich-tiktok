import { Router } from 'express';
import { datasetDb as db } from '../config/datasetDb.js';
import { runBackfill } from '../services/linking/linkingService.js';
import { asyncHandler, sendSuccess } from '../utils/http.js';

const router = Router();
const id = (value: unknown): number => {
  const s = String(value);
  const n = Number(s);
  if (!/^[1-9][0-9]*$/.test(s) || !Number.isSafeInteger(n) || n > 2147483647) throw new Error('ID không hợp lệ');
  return n;
};

function relationShape(link: Record<string, unknown>) {
  return {
    id: link.id,
    status: link.status,
    tier: link.status,
    confidence: link.confidence,
    reason: link.reason,
    method: link.method,
    verificationStatus: link.verificationStatus,
  };
}

/** All links (with tier/reason/confidence) touching a subject product/shop/creator/video. */
router.get('/products/:id/links', asyncHandler(async (req, res) => {
  const productId = id(req.params.id);
  const categories = await db.productCategory.findMany({
    where: { productId },
    include: { category: true, subCategory: true, thirdLevel: true },
    orderBy: { id: 'asc' },
  });
  const shops = await db.productShop.findMany({ where: { productId }, include: { shop: true } });
  sendSuccess(res, {
    productId,
    categories: categories.map((c) => ({
      ...relationShape(c),
      category: c.category.name,
      subCategory: c.subCategory?.name ?? null,
      thirdLevel: c.thirdLevel?.name ?? null,
      isPrimary: c.isPrimary,
    })),
    shops: shops.map((s) => ({ id: s.id, shopId: s.shopId, shopName: s.shop.name, status: s.verificationStatus, isActive: s.isActive })),
  });
}));

router.get('/shops/:id/links', asyncHandler(async (req, res) => {
  const shopId = id(req.params.id);
  const products = await db.productShop.findMany({ where: { shopId }, include: { product: true } });
  const creators = await db.creatorShop.findMany({ where: { shopId }, include: { creator: true } });
  sendSuccess(res, {
    shopId,
    products: products.map((p) => ({ id: p.id, productId: p.productId, title: p.product.title, status: p.verificationStatus, isActive: p.isActive })),
    creators: creators.map((c) => ({ id: c.id, creatorId: c.creatorId, name: c.creator.displayName, status: c.verificationStatus })),
  });
}));

router.get('/creators/:id/links', asyncHandler(async (req, res) => {
  const channelId = id(req.params.id);
  const channel = await db.creatorChannel.findUnique({ where: { id: channelId }, select: { creatorId: true } });
  const categories = await db.creatorCategory.findMany({
    where: { OR: [{ channelId }, ...(channel?.creatorId ? [{ creatorId: channel.creatorId }] : [])] },
    include: { category: true },
    orderBy: { id: 'asc' },
  });
  sendSuccess(res, {
    channelId,
    creatorId: channel?.creatorId ?? null,
    categories: categories.map((c) => ({ ...relationShape(c), category: c.category.name })),
  });
}));

router.get('/videos/:id/links', asyncHandler(async (req, res) => {
  const videoId = id(req.params.id);
  const categories = await db.videoCategory.findMany({
    where: { videoId },
    include: { category: true },
    orderBy: { id: 'asc' },
  });
  const products = await db.productVideo.findMany({ where: { videoId }, include: { product: true } });
  sendSuccess(res, {
    videoId,
    categories: categories.map((c) => ({ ...relationShape(c), category: c.category.name })),
    products: products.map((p) => ({ id: p.id, productId: p.productId, title: p.product.title, status: p.verificationStatus })),
  });
}));

/** Backfill status summary. */
router.get('/backfill/status', asyncHandler(async (_req, res) => {
  const [confirmed, inferred, provisional, unresolvedProducts, unresolvedCreators, unresolvedVideos] = await Promise.all([
    db.productCategory.count({ where: { status: 'CONFIRMED' } }),
    db.productCategory.count({ where: { status: 'INFERRED' } }),
    db.productCategory.count({ where: { status: 'PROVISIONAL' } }),
    db.product.count({ where: { categories: { none: { isPrimary: true } } } }),
    db.creatorChannel.count({ where: { categories: { none: {} } } }),
    db.video.count({ where: { categories: { none: {} } } }),
  ]);
  sendSuccess(res, { confirmed, inferred, provisional, unresolvedProducts, unresolvedCreators, unresolvedVideos });
}));

/** Run the idempotent semantic backfill on demand (admin token required upstream). */
router.post('/backfill', asyncHandler(async (_req, res) => {
  sendSuccess(res, await runBackfill());
}));

export default router;
