-- Bổ sung dữ liệu thương mại TikTok Shop: giá niêm yết, tồn kho, đánh giá
-- và mốc chênh lệch 90 ngày cho snapshot.

-- ─── Product ────────────────────────────────────────────────────────────────
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "minOriginalPrice" DECIMAL(18, 2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxOriginalPrice" DECIMAL(18, 2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockTotal" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "ratingScore" DECIMAL(4, 2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "ratingCount" BIGINT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT true;

-- ─── ProductVariant ─────────────────────────────────────────────────────────
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "originalPrice" DECIMAL(18, 2);
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT true;

-- ─── Shop ───────────────────────────────────────────────────────────────────
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "productCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "soldCountTotal" BIGINT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "gmvTotal" DECIMAL(20, 2);
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "avgOrderValue" DECIMAL(20, 2);
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "ratingScore" DECIMAL(4, 2);
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "ratingCount" BIGINT;

-- ─── ProductSnapshot ────────────────────────────────────────────────────────
ALTER TABLE "ProductSnapshot" ADD COLUMN IF NOT EXISTS "originalPrice" DECIMAL(18, 2);
ALTER TABLE "ProductSnapshot" ADD COLUMN IF NOT EXISTS "stockTotal" INTEGER;
ALTER TABLE "ProductSnapshot" ADD COLUMN IF NOT EXISTS "ratingScore" DECIMAL(4, 2);
ALTER TABLE "ProductSnapshot" ADD COLUMN IF NOT EXISTS "ratingCount" BIGINT;
ALTER TABLE "ProductSnapshot" ADD COLUMN IF NOT EXISTS "soldCount90d" BIGINT;
ALTER TABLE "ProductSnapshot" ADD COLUMN IF NOT EXISTS "gmv90d" DECIMAL(20, 2);

-- ─── ShopProductSnapshot ────────────────────────────────────────────────────
ALTER TABLE "ShopProductSnapshot" ADD COLUMN IF NOT EXISTS "soldCount90d" BIGINT;
ALTER TABLE "ShopProductSnapshot" ADD COLUMN IF NOT EXISTS "gmv90d" DECIMAL(20, 2);

-- ─── ShopRevenueSnapshot ────────────────────────────────────────────────────
ALTER TABLE "ShopRevenueSnapshot" ADD COLUMN IF NOT EXISTS "soldCountTotal" BIGINT;
ALTER TABLE "ShopRevenueSnapshot" ADD COLUMN IF NOT EXISTS "productCount" INTEGER;
ALTER TABLE "ShopRevenueSnapshot" ADD COLUMN IF NOT EXISTS "avgOrderValue" DECIMAL(20, 2);
ALTER TABLE "ShopRevenueSnapshot" ADD COLUMN IF NOT EXISTS "ratingScore" DECIMAL(4, 2);
ALTER TABLE "ShopRevenueSnapshot" ADD COLUMN IF NOT EXISTS "ratingCount" BIGINT;

-- ─── Index hỗ trợ truy vấn tăng trưởng ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Product_ratingScore_idx" ON "Product" ("ratingScore");
CREATE INDEX IF NOT EXISTS "Product_stockTotal_idx" ON "Product" ("stockTotal");
CREATE INDEX IF NOT EXISTS "Shop_gmvTotal_idx" ON "Shop" ("gmvTotal");
CREATE INDEX IF NOT EXISTS "ShopProductSnapshot_productShopId_bucketDate_idx" ON "ShopProductSnapshot" ("productShopId", "bucketDate");
