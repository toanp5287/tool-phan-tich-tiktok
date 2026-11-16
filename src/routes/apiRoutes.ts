import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import {
  getJobs,
  getKeywords,
  getOverview,
  getProductById,
  getProductComparison,
  getProducts,
  getShopById,
  getShops,
  getTrendItems,
  getTrends,
} from '../controllers/analyticsController.js';
import { getScrapeJob, getScrapeStatus, triggerScrape } from '../controllers/scrapeController.js';
import {
  getCategories,
  getCategory,
  getSubCategory,
  getVideosByShop,
  syncCategories,
} from '../controllers/hierarchyController.js';
import {
  getCreatorById,
  getCreators,
  getTopCreatorsList,
  triggerCreativeScrape,
} from '../controllers/creatorController.js';
import {
  createTarget,
  deleteTarget,
  getProfileScrapeStatus,
  getTargetedShop,
  getTargetedShops,
  toggleTarget,
  triggerTopShopScrape,
  updateTarget,
} from '../controllers/targetedShopController.js';
import {
  getProductGrowthById,
  getShopGrowthById,
  getShopScrapeStatus,
  triggerShopScrape,
} from '../controllers/shopScrapeController.js';
import {
  getEchoTikQuota,
  getEchoTikSyncStatus,
  triggerEchoTikSync,
} from '../controllers/echoTikController.js';

const router = Router();

// Dashboard & thống kê tổng quan
router.get('/overview', asyncHandler(getOverview));
router.get('/analytics', asyncHandler(getOverview));
router.get('/analytics/trends', asyncHandler(getTrends));
router.get('/trends', asyncHandler(getTrendItems));
router.get('/trends/keywords', asyncHandler(getKeywords));

// Phân cấp ngành hàng: Category -> Sub-category -> Shop -> Video
router.get('/categories', asyncHandler(getCategories));
router.post('/categories/sync', asyncHandler(syncCategories));
router.get('/categories/:category', asyncHandler(getCategory));
router.get('/categories/:category/subcategories/:subCategory', asyncHandler(getSubCategory));

// Sản phẩm
router.get('/products', asyncHandler(getProducts));
router.get('/products/compare', asyncHandler(getProductComparison));
router.get('/products/:id', asyncHandler(getProductById));

// Shop
router.get('/shops', asyncHandler(getShops));
router.get('/shops/:id/videos', asyncHandler(getVideosByShop));
router.get('/shops/:id', asyncHandler(getShopById));

// Nhà sáng tạo & Affiliate
router.get('/creators', asyncHandler(getCreators));
router.get('/creators/top', asyncHandler(getTopCreatorsList));
router.get('/creators/:id', asyncHandler(getCreatorById));
router.post('/creators/scrape', asyncHandler(triggerCreativeScrape));

// Job & tiến trình
router.get('/jobs', asyncHandler(getJobs));
router.get('/jobs/:id', asyncHandler(getScrapeJob));
router.get('/scrape/status', asyncHandler(getScrapeStatus));
router.post('/scrape', asyncHandler(triggerScrape));

// ─── Sprint 1: Targeted Profile Scraping ─────────────────────────────

// CRUD Targeted Shops (danh sách Top Shop mục tiêu)
router.get('/targets', asyncHandler(getTargetedShops));
router.get('/targets/:id', asyncHandler(getTargetedShop));
router.post('/targets', asyncHandler(createTarget));
router.patch('/targets/:id', asyncHandler(updateTarget));
router.patch('/targets/:id/toggle', asyncHandler(toggleTarget));
router.delete('/targets/:id', asyncHandler(deleteTarget));

// Trigger Pipeline cào theo Targeted Profiles
router.post('/scrape/run-top-shops', asyncHandler(triggerTopShopScrape));
router.get('/scrape/profile-status', asyncHandler(getProfileScrapeStatus));

// ─── TikTok Shop (độc quyền thương mại điện tử) ──────────────────────
router.post('/scrape/tiktok-shop', asyncHandler(triggerShopScrape));
router.get('/scrape/tiktok-shop/status', asyncHandler(getShopScrapeStatus));

// Tăng trưởng & Delta GMV theo mốc 1 / 7 / 30 / 90 ngày
router.get('/growth/products/:id', asyncHandler(getProductGrowthById));
router.get('/growth/shops/:id', asyncHandler(getShopGrowthById));

// ─── EchoTik Integration (ADMIN) ──────────────────────────────────────
router.get('/admin/echotik/quota', asyncHandler(getEchoTikQuota));
router.get('/admin/echotik/status', asyncHandler(getEchoTikSyncStatus));
router.post('/admin/echotik/sync', asyncHandler(triggerEchoTikSync));

export default router;
