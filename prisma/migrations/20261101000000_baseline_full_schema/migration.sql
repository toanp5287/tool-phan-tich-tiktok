-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ScrapeJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "TrendItem" (
    "id" SERIAL NOT NULL,
    "author" TEXT,
    "content" TEXT NOT NULL,
    "keywords" TEXT[],
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "platformProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "productUrl" TEXT,
    "category" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "region" TEXT NOT NULL DEFAULT 'VN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" SERIAL NOT NULL,
    "platformShopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "shopUrl" TEXT,
    "region" TEXT NOT NULL DEFAULT 'VN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductShop" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "shopId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "scrapeJobId" INTEGER,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" DECIMAL(18,2),
    "soldCountTotal" BIGINT,
    "soldCount1d" BIGINT,
    "soldCount7d" BIGINT,
    "soldCount30d" BIGINT,
    "gmvTotal" DECIMAL(20,2),
    "gmv1d" DECIMAL(20,2),
    "gmv7d" DECIMAL(20,2),
    "gmv30d" DECIMAL(20,2),
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB,

    CONSTRAINT "ProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopProductSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "productShopId" INTEGER NOT NULL,
    "scrapeJobId" INTEGER,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" DECIMAL(18,2),
    "soldCountTotal" BIGINT,
    "soldCount1d" BIGINT,
    "soldCount7d" BIGINT,
    "soldCount30d" BIGINT,
    "gmvTotal" DECIMAL(20,2),
    "gmv1d" DECIMAL(20,2),
    "gmv7d" DECIMAL(20,2),
    "gmv30d" DECIMAL(20,2),
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB,

    CONSTRAINT "ShopProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeJob" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'VN',
    "status" "ScrapeJobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsSaved" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrendItem_scrapedAt_idx" ON "TrendItem"("scrapedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_platformProductId_key" ON "Product"("platformProductId");

-- CreateIndex
CREATE INDEX "Product_region_category_idx" ON "Product"("region", "category");

-- CreateIndex
CREATE INDEX "Product_lastSeenAt_idx" ON "Product"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_platformShopId_key" ON "Shop"("platformShopId");

-- CreateIndex
CREATE INDEX "Shop_region_name_idx" ON "Shop"("region", "name");

-- CreateIndex
CREATE INDEX "Shop_lastSeenAt_idx" ON "Shop"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ProductShop_shopId_isActive_idx" ON "ProductShop"("shopId", "isActive");

-- CreateIndex
CREATE INDEX "ProductShop_productId_isActive_idx" ON "ProductShop"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProductShop_productId_shopId_key" ON "ProductShop"("productId", "shopId");

-- CreateIndex
CREATE INDEX "ProductSnapshot_productId_capturedAt_idx" ON "ProductSnapshot"("productId", "capturedAt");

-- CreateIndex
CREATE INDEX "ProductSnapshot_source_capturedAt_idx" ON "ProductSnapshot"("source", "capturedAt");

-- CreateIndex
CREATE INDEX "ShopProductSnapshot_productShopId_capturedAt_idx" ON "ShopProductSnapshot"("productShopId", "capturedAt");

-- CreateIndex
CREATE INDEX "ShopProductSnapshot_source_capturedAt_idx" ON "ShopProductSnapshot"("source", "capturedAt");

-- CreateIndex
CREATE INDEX "ScrapeJob_status_createdAt_idx" ON "ScrapeJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScrapeJob_source_createdAt_idx" ON "ScrapeJob"("source", "createdAt");

-- CreateIndex
CREATE INDEX "ScrapeJob_jobType_region_createdAt_idx" ON "ScrapeJob"("jobType", "region", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductShop" ADD CONSTRAINT "ProductShop_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductShop" ADD CONSTRAINT "ProductShop_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSnapshot" ADD CONSTRAINT "ProductSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSnapshot" ADD CONSTRAINT "ProductSnapshot_scrapeJobId_fkey" FOREIGN KEY ("scrapeJobId") REFERENCES "ScrapeJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProductSnapshot" ADD CONSTRAINT "ShopProductSnapshot_productShopId_fkey" FOREIGN KEY ("productShopId") REFERENCES "ProductShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProductSnapshot" ADD CONSTRAINT "ShopProductSnapshot_scrapeJobId_fkey" FOREIGN KEY ("scrapeJobId") REFERENCES "ScrapeJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
