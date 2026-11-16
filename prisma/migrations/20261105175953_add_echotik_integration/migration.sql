-- DropIndex
DROP INDEX "Product_ratingScore_idx";

-- DropIndex
DROP INDEX "Product_stockTotal_idx";

-- DropIndex
DROP INDEX "Shop_gmvTotal_idx";

-- DropIndex
DROP INDEX "ShopProductSnapshot_productShopId_bucketDate_idx";

-- CreateTable
CREATE TABLE "ThirdLevelCategory" (
    "id" SERIAL NOT NULL,
    "subCategoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThirdLevelCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategorySnapshot" (
    "id" BIGSERIAL NOT NULL,
    "categoryId" INTEGER,
    "scrapeJobId" INTEGER,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bucketDate" DATE NOT NULL,
    "gmvTotal" DECIMAL(20,2),
    "soldCountTotal" BIGINT,
    "productCount" INTEGER,
    "sellerCount" INTEGER,
    "avgPrice" DECIMAL(18,2),
    "avgRating" DECIMAL(4,2),
    "topProducts" JSONB,
    "topSellers" JSONB,
    "isEstimated" BOOLEAN NOT NULL DEFAULT true,
    "rawData" JSONB,

    CONSTRAINT "CategorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EchoTikQuotaLog" (
    "id" SERIAL NOT NULL,
    "requestType" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "resetDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EchoTikQuotaLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThirdLevelCategory_subCategoryId_isActive_sortOrder_idx" ON "ThirdLevelCategory"("subCategoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdLevelCategory_subCategoryId_name_key" ON "ThirdLevelCategory"("subCategoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdLevelCategory_subCategoryId_slug_key" ON "ThirdLevelCategory"("subCategoryId", "slug");

-- CreateIndex
CREATE INDEX "CategorySnapshot_categoryId_capturedAt_idx" ON "CategorySnapshot"("categoryId", "capturedAt");

-- CreateIndex
CREATE INDEX "CategorySnapshot_source_capturedAt_idx" ON "CategorySnapshot"("source", "capturedAt");

-- CreateIndex
CREATE INDEX "CategorySnapshot_bucketDate_idx" ON "CategorySnapshot"("bucketDate");

-- CreateIndex
CREATE UNIQUE INDEX "CategorySnapshot_categoryId_source_bucketDate_key" ON "CategorySnapshot"("categoryId", "source", "bucketDate");

-- CreateIndex
CREATE UNIQUE INDEX "EchoTikQuotaLog_month_key" ON "EchoTikQuotaLog"("month");

-- CreateIndex
CREATE INDEX "EchoTikQuotaLog_month_idx" ON "EchoTikQuotaLog"("month");

-- CreateIndex
CREATE INDEX "Creator_username_idx" ON "Creator"("username");

-- AddForeignKey
ALTER TABLE "ThirdLevelCategory" ADD CONSTRAINT "ThirdLevelCategory_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSnapshot" ADD CONSTRAINT "CreatorSnapshot_scrapeJobId_fkey" FOREIGN KEY ("scrapeJobId") REFERENCES "ScrapeJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopRevenueSnapshot" ADD CONSTRAINT "ShopRevenueSnapshot_scrapeJobId_fkey" FOREIGN KEY ("scrapeJobId") REFERENCES "ScrapeJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorySnapshot" ADD CONSTRAINT "CategorySnapshot_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorySnapshot" ADD CONSTRAINT "CategorySnapshot_scrapeJobId_fkey" FOREIGN KEY ("scrapeJobId") REFERENCES "ScrapeJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
