-- ============================================================
-- Sprint 2: Creators/Affiliates + Category entities + Seller count
-- 1. Category / SubCategory (danh mục ngành hàng chuẩn hoá)
-- 2. Creator / ProductCreator / CreatorShop / CreatorSnapshot
-- 3. ShopRevenueSnapshot (bóc tách nguồn tiền: video / live / cart)
-- 4. Product.sellerCount/soldCount/avgPrice + snapshot.sellerCount
-- 5. TrendItem.productId/creatorId/bucketDate
-- ============================================================

-- ---------- Category ----------
CREATE TABLE IF NOT EXISTS "Category" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Category_slug_key" ON "Category" ("slug");
CREATE INDEX IF NOT EXISTS "Category_isActive_sortOrder_idx" ON "Category" ("isActive", "sortOrder");

-- ---------- SubCategory ----------
CREATE TABLE IF NOT EXISTS "SubCategory" (
  "id"          SERIAL PRIMARY KEY,
  "categoryId"  INTEGER NOT NULL,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubCategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubCategory_categoryId_name_key" ON "SubCategory" ("categoryId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "SubCategory_categoryId_slug_key" ON "SubCategory" ("categoryId", "slug");
CREATE INDEX IF NOT EXISTS "SubCategory_categoryId_isActive_sortOrder_idx"
  ON "SubCategory" ("categoryId", "isActive", "sortOrder");

-- ---------- CreatorRole enum ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CreatorRole') THEN
    CREATE TYPE "CreatorRole" AS ENUM ('CREATOR', 'AFFILIATE');
  END IF;
END $$;

-- ---------- Creator ----------
CREATE TABLE IF NOT EXISTS "Creator" (
  "id"                SERIAL PRIMARY KEY,
  "platformCreatorId" TEXT NOT NULL,
  "username"          TEXT,
  "displayName"       TEXT NOT NULL,
  "avatarUrl"         TEXT,
  "bio"               TEXT,
  "role"              "CreatorRole" NOT NULL DEFAULT 'CREATOR',
  "region"            TEXT NOT NULL DEFAULT 'VN',
  "followerCount"     BIGINT,
  "followingCount"    BIGINT,
  "likeCount"         BIGINT,
  "engagementRate"    DECIMAL(8, 4),
  "gmvTotal"          DECIMAL(20, 2),
  "soldCount"         BIGINT,
  "videoCount"        INTEGER,
  "firstSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Creator_platformCreatorId_key" ON "Creator" ("platformCreatorId");
CREATE UNIQUE INDEX IF NOT EXISTS "Creator_username_key" ON "Creator" ("username");
CREATE INDEX IF NOT EXISTS "Creator_region_gmvTotal_idx" ON "Creator" ("region", "gmvTotal");
CREATE INDEX IF NOT EXISTS "Creator_followerCount_idx" ON "Creator" ("followerCount");
CREATE INDEX IF NOT EXISTS "Creator_lastSeenAt_idx" ON "Creator" ("lastSeenAt");

-- ---------- ProductCreator ----------
CREATE TABLE IF NOT EXISTS "ProductCreator" (
  "id"             SERIAL PRIMARY KEY,
  "productId"      INTEGER NOT NULL,
  "creatorId"      INTEGER NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "gmvTotal"       DECIMAL(20, 2),
  "soldCount"      BIGINT,
  "videoCount"     INTEGER,
  "commissionRate" DECIMAL(8, 4),
  "firstSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCreator_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductCreator_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductCreator_productId_creatorId_key"
  ON "ProductCreator" ("productId", "creatorId");
CREATE INDEX IF NOT EXISTS "ProductCreator_creatorId_isActive_idx" ON "ProductCreator" ("creatorId", "isActive");
CREATE INDEX IF NOT EXISTS "ProductCreator_productId_isActive_idx" ON "ProductCreator" ("productId", "isActive");
CREATE INDEX IF NOT EXISTS "ProductCreator_creatorId_gmvTotal_idx" ON "ProductCreator" ("creatorId", "gmvTotal");

-- ---------- CreatorShop ----------
CREATE TABLE IF NOT EXISTS "CreatorShop" (
  "id"             SERIAL PRIMARY KEY,
  "creatorId"      INTEGER NOT NULL,
  "shopId"         INTEGER NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "gmvTotal"       DECIMAL(20, 2),
  "soldCount"      BIGINT,
  "videoCount"     INTEGER,
  "commissionRate" DECIMAL(8, 4),
  "firstSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorShop_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CreatorShop_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorShop_creatorId_shopId_key" ON "CreatorShop" ("creatorId", "shopId");
CREATE INDEX IF NOT EXISTS "CreatorShop_shopId_isActive_gmvTotal_idx"
  ON "CreatorShop" ("shopId", "isActive", "gmvTotal");
CREATE INDEX IF NOT EXISTS "CreatorShop_creatorId_isActive_idx" ON "CreatorShop" ("creatorId", "isActive");

-- ---------- CreatorSnapshot ----------
CREATE TABLE IF NOT EXISTS "CreatorSnapshot" (
  "id"             BIGSERIAL PRIMARY KEY,
  "creatorId"      INTEGER NOT NULL,
  "scrapeJobId"    INTEGER,
  "source"         TEXT NOT NULL,
  "capturedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bucketDate"     DATE NOT NULL,
  "followerCount"  BIGINT,
  "engagementRate" DECIMAL(8, 4),
  "gmvTotal"       DECIMAL(20, 2),
  "soldCount"      BIGINT,
  "videoCount"     INTEGER,
  "isEstimated"    BOOLEAN NOT NULL DEFAULT false,
  "rawData"        JSONB,
  CONSTRAINT "CreatorSnapshot_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorSnapshot_creatorId_source_bucketDate_key"
  ON "CreatorSnapshot" ("creatorId", "source", "bucketDate");
CREATE INDEX IF NOT EXISTS "CreatorSnapshot_creatorId_capturedAt_idx"
  ON "CreatorSnapshot" ("creatorId", "capturedAt");
CREATE INDEX IF NOT EXISTS "CreatorSnapshot_bucketDate_idx" ON "CreatorSnapshot" ("bucketDate");

-- ---------- ShopRevenueSnapshot ----------
CREATE TABLE IF NOT EXISTS "ShopRevenueSnapshot" (
  "id"             BIGSERIAL PRIMARY KEY,
  "shopId"         INTEGER NOT NULL,
  "scrapeJobId"    INTEGER,
  "source"         TEXT NOT NULL,
  "capturedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bucketDate"     DATE NOT NULL,
  "gmvVideo"       DECIMAL(20, 2),
  "gmvLive"        DECIMAL(20, 2),
  "gmvCart"        DECIMAL(20, 2),
  "gmvProductCard" DECIMAL(20, 2),
  "gmvTotal"       DECIMAL(20, 2),
  "isEstimated"    BOOLEAN NOT NULL DEFAULT false,
  "rawData"        JSONB,
  CONSTRAINT "ShopRevenueSnapshot_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopRevenueSnapshot_shopId_source_bucketDate_key"
  ON "ShopRevenueSnapshot" ("shopId", "source", "bucketDate");
CREATE INDEX IF NOT EXISTS "ShopRevenueSnapshot_shopId_capturedAt_idx"
  ON "ShopRevenueSnapshot" ("shopId", "capturedAt");
CREATE INDEX IF NOT EXISTS "ShopRevenueSnapshot_bucketDate_idx" ON "ShopRevenueSnapshot" ("bucketDate");

-- ---------- Product: seller/competitive metrics ----------
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "sellerCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "soldCount" BIGINT,
  ADD COLUMN IF NOT EXISTS "avgPrice" DECIMAL(18, 2);

CREATE INDEX IF NOT EXISTS "Product_sellerCount_idx" ON "Product" ("sellerCount");

-- ---------- ProductSnapshot: sellerCount ----------
ALTER TABLE "ProductSnapshot" ADD COLUMN IF NOT EXISTS "sellerCount" INTEGER;

-- ---------- Shop: followerCount ----------
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "followerCount" BIGINT;

-- ---------- TrendItem: link sản phẩm/creator ----------
ALTER TABLE "TrendItem"
  ADD COLUMN IF NOT EXISTS "productId" INTEGER,
  ADD COLUMN IF NOT EXISTS "creatorId" INTEGER,
  ADD COLUMN IF NOT EXISTS "bucketDate" DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TrendItem_productId_fkey'
  ) THEN
    ALTER TABLE "TrendItem" ADD CONSTRAINT "TrendItem_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TrendItem_creatorId_fkey'
  ) THEN
    ALTER TABLE "TrendItem" ADD CONSTRAINT "TrendItem_creatorId_fkey"
      FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TrendItem_productId_scrapedAt_idx" ON "TrendItem" ("productId", "scrapedAt");
CREATE INDEX IF NOT EXISTS "TrendItem_creatorId_scrapedAt_idx" ON "TrendItem" ("creatorId", "scrapedAt");
CREATE INDEX IF NOT EXISTS "TrendItem_bucketDate_idx" ON "TrendItem" ("bucketDate");

-- ---------- Backfill sellerCount từ ProductShop ----------
UPDATE "Product" p
SET "sellerCount" = counts."c"
FROM (
  SELECT "productId", COUNT(*)::int AS "c"
  FROM "ProductShop"
  WHERE "isActive" = true
  GROUP BY "productId"
) AS counts
WHERE p."id" = counts."productId"
  AND p."sellerCount" < counts."c";

-- ---------- Backfill soldCount/avgPrice từ snapshot mới nhất ----------
UPDATE "Product" p
SET
  "soldCount" = COALESCE(p."soldCount", latest."soldCountTotal"),
  "avgPrice"  = COALESCE(p."avgPrice", latest."price")
FROM (
  SELECT DISTINCT ON ("productId") "productId", "soldCountTotal", "price"
  FROM "ProductSnapshot"
  WHERE "soldCountTotal" IS NOT NULL OR "price" IS NOT NULL
  ORDER BY "productId", "capturedAt" DESC, "id" DESC
) AS latest
WHERE p."id" = latest."productId";
