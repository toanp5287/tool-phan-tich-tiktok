import { Router } from 'express';
import { asyncHandler } from '../../utils/http.js';
import { sendSuccess } from '../../utils/http.js';
import { AppError } from '../../utils/errors.js';
import { getProductIntelligence, listDemoProducts } from './productIntelligenceService.js';
import {
  getCategories,
  getCategoryByName,
  getCreatorById,
  getCreators,
  getOverview,
  getProductById,
  getProducts,
  getShopById,
  getShops,
  getTrendVideos,
} from './shopCommerceController.js';

/**
 * Module độc lập: /api/commerce/*
 * Chỉ phục vụ dữ liệu TikTok Shop thị trường VN.
 */
const router = Router();

router.get('/overview', asyncHandler(getOverview));

router.get('/products', asyncHandler(getProducts));
router.get('/demo-products', asyncHandler(async (_req, res) => {
  sendSuccess(res, await listDemoProducts());
}));
router.get('/products/:id/intelligence', asyncHandler(async (req, res) => {
  const raw = String(req.params.id);
  const id = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(id) || id > 2147483647) throw AppError.badRequest('ID sản phẩm không hợp lệ');
  sendSuccess(res, await getProductIntelligence(id));
}));
router.get('/products/:id', asyncHandler(getProductById));

router.get('/shops', asyncHandler(getShops));
router.get('/shops/:id', asyncHandler(getShopById));

router.get('/creators', asyncHandler(getCreators));
router.get('/creators/:id', asyncHandler(getCreatorById));

router.get('/categories', asyncHandler(getCategories));
router.get('/categories/:name', asyncHandler(getCategoryByName));

router.get('/trend-videos', asyncHandler(getTrendVideos));

export default router;
