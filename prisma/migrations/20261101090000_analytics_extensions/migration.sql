-- ============================================================
-- Mở rộng schema cho analytics nâng cao
-- 1. Thêm bucketDate (mốc ngày) + tách cột tương tác video
-- 2. Backfill dữ liệu cũ và dedupe trước khi tạo UNIQUE INDEX
-- ============================================================

-- ---------- ProductSnapshot ----------
ALTER TABLE "ProductSnapshot"
  ADD COLUMN "bucketDate" DATE,
  ADD COLUMN "commentCount" BIGINT,
  ADD COLUMN "diggCount" BIGINT,
  ADD COLUMN "playCount" BIGINT,
  ADD COLUMN "shareCount" BIGINT;

UPDATE "ProductSnapshot"
SET "bucketDate" = ("capturedAt" AT TIME ZONE 'UTC')::date
WHERE "bucketDate" IS NULL;

-- Giữ lại bản ghi mới nhất (id lớn nhất) cho mỗi (productId, source, ngày)
DELETE FROM "ProductSnapshot" ps
USING "ProductSnapshot" newer
WHERE ps."productId" = newer."productId"
  AND ps."source" = newer."source"
  AND ps."bucketDate" = newer."bucketDate"
  AND ps."id" < newer."id";

ALTER TABLE "ProductSnapshot" ALTER COLUMN "bucketDate" SET NOT NULL;

-- ---------- ShopProductSnapshot ----------
ALTER TABLE "ShopProductSnapshot"
  ADD COLUMN "bucketDate" DATE,
  ADD COLUMN "commentCount" BIGINT,
  ADD COLUMN "diggCount" BIGINT,
  ADD COLUMN "playCount" BIGINT,
  ADD COLUMN "shareCount" BIGINT;

UPDATE "ShopProductSnapshot"
SET "bucketDate" = ("capturedAt" AT TIME ZONE 'UTC')::date
WHERE "bucketDate" IS NULL;

DELETE FROM "ShopProductSnapshot" sps
USING "ShopProductSnapshot" newer
WHERE sps."productShopId" = newer."productShopId"
  AND sps."source" = newer."source"
  AND sps."bucketDate" = newer."bucketDate"
  AND sps."id" < newer."id";

ALTER TABLE "ShopProductSnapshot" ALTER COLUMN "bucketDate" SET NOT NULL;

-- ---------- ScrapeJob ----------
ALTER TABLE "ScrapeJob"
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "recordsFailed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'manual';

-- ---------- TrendItem ----------
ALTER TABLE "TrendItem"
  ADD COLUMN "commentCount" BIGINT,
  ADD COLUMN "diggCount" BIGINT,
  ADD COLUMN "platformVideoId" TEXT,
  ADD COLUMN "playCount" BIGINT,
  ADD COLUMN "scrapeJobId" INTEGER,
  ADD COLUMN "shareCount" BIGINT,
  ADD COLUMN "videoUrl" TEXT,
  ALTER COLUMN "keywords" SET DEFAULT ARRAY[]::TEXT[];

-- ---------- Indexes ----------
CREATE INDEX "Product_title_idx" ON "Product"("title");
CREATE INDEX "Shop_username_idx" ON "Shop"("username");

CREATE INDEX "ProductSnapshot_bucketDate_idx" ON "ProductSnapshot"("bucketDate");
CREATE UNIQUE INDEX "ProductSnapshot_productId_source_bucketDate_key"
  ON "ProductSnapshot"("productId", "source", "bucketDate");

CREATE INDEX "ShopProductSnapshot_bucketDate_idx" ON "ShopProductSnapshot"("bucketDate");
CREATE UNIQUE INDEX "ShopProductSnapshot_productShopId_source_bucketDate_key"
  ON "ShopProductSnapshot"("productShopId", "source", "bucketDate");

CREATE UNIQUE INDEX "TrendItem_platformVideoId_key" ON "TrendItem"("platformVideoId");
CREATE INDEX "TrendItem_author_idx" ON "TrendItem"("author");
