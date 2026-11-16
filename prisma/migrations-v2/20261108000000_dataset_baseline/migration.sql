-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'SUGGESTED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "DataSource" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usageRestriction" TEXT NOT NULL,
    "licenseNote" TEXT,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetFile" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatasetFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawRecord" (
    "id" BIGSERIAL NOT NULL,
    "datasetFileId" INTEGER NOT NULL,
    "recordNumber" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "normalized" JSONB,
    "issues" JSONB NOT NULL,
    "state" TEXT NOT NULL,
    "normalizerVersion" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingRun" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "mappingVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsSaved" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "recordsQuarantined" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubCategory" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "SubCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThirdLevelCategory" (
    "id" SERIAL NOT NULL,
    "subCategoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "ThirdLevelCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryMapping" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "categoryId" INTEGER,
    "subCategoryId" INTEGER,
    "thirdLevelCategoryId" INTEGER,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "CategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "productUrl" TEXT,
    "imageUrl" TEXT,
    "market" TEXT,
    "currency" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "platformSkuId" TEXT NOT NULL,
    "name" TEXT,
    "attributes" JSONB NOT NULL,
    "price" DECIMAL(20,4),
    "originalPrice" DECIMAL(20,4),
    "currency" TEXT,
    "stock" INTEGER,
    "isAvailable" BOOLEAN,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "shopUrl" TEXT,
    "avatarUrl" TEXT,
    "market" TEXT,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" SERIAL NOT NULL,
    "displayName" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorChannel" (
    "id" SERIAL NOT NULL,
    "creatorId" INTEGER,
    "platform" TEXT NOT NULL,
    "platformUserId" TEXT,
    "username" TEXT,
    "profileUrl" TEXT NOT NULL,
    "displayName" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "market" TEXT,
    "isVerified" BOOLEAN,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "CreatorChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" SERIAL NOT NULL,
    "channelId" INTEGER,
    "caption" TEXT,
    "postType" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "durationSeconds" DECIMAL(12,3),
    "postUrl" TEXT,
    "coverUrl" TEXT,
    "market" TEXT,
    "hashtags" TEXT[],

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" SERIAL NOT NULL,
    "namespace" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "productId" INTEGER,
    "shopId" INTEGER,
    "creatorId" INTEGER,
    "channelId" INTEGER,
    "videoId" INTEGER,
    "rawRecordId" BIGINT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductShop" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "shopId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "ProductShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCreator" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "ProductCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorShop" (
    "id" SERIAL NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "shopId" INTEGER NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "CreatorShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVideo" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "videoId" INTEGER NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "ProductVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "subCategoryId" INTEGER,
    "thirdLevelCategoryId" INTEGER,
    "isPrimary" BOOLEAN NOT NULL,
    "method" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorCategory" (
    "id" SERIAL NOT NULL,
    "creatorId" INTEGER,
    "channelId" INTEGER,
    "categoryId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "CreatorCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoCategory" (
    "id" SERIAL NOT NULL,
    "videoId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,

    CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationEvidence" (
    "id" BIGSERIAL NOT NULL,
    "rawRecordId" BIGINT NOT NULL,
    "productShopId" INTEGER,
    "productCreatorId" INTEGER,
    "creatorShopId" INTEGER,
    "productVideoId" INTEGER,
    "productCategoryId" INTEGER,
    "creatorCategoryId" INTEGER,
    "videoCategoryId" INTEGER,
    "verificationStatus" "VerificationStatus" NOT NULL,
    "method" TEXT NOT NULL,
    "evidencePath" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "RelationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductObservation" (
    "id" BIGSERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "rawRecordId" BIGINT NOT NULL,
    "observedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" DECIMAL(20,4),
    "originalPrice" DECIMAL(20,4),
    "currency" TEXT,
    "soldCount" BIGINT,
    "ratingScore" DECIMAL(4,2),
    "ratingCount" BIGINT,
    "isAvailable" BOOLEAN,
    "quality" JSONB NOT NULL,

    CONSTRAINT "ProductObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopObservation" (
    "id" BIGSERIAL NOT NULL,
    "shopId" INTEGER NOT NULL,
    "rawRecordId" BIGINT NOT NULL,
    "observedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followerCount" BIGINT,
    "productCount" INTEGER,
    "ratingScore" DECIMAL(4,2),
    "quality" JSONB NOT NULL,

    CONSTRAINT "ShopObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorChannelObservation" (
    "id" BIGSERIAL NOT NULL,
    "channelId" INTEGER NOT NULL,
    "rawRecordId" BIGINT NOT NULL,
    "observedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followerCount" BIGINT,
    "likeCount" BIGINT,
    "viewCount" BIGINT,
    "quality" JSONB NOT NULL,

    CONSTRAINT "CreatorChannelObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoObservation" (
    "id" BIGSERIAL NOT NULL,
    "videoId" INTEGER NOT NULL,
    "rawRecordId" BIGINT NOT NULL,
    "observedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playCount" BIGINT,
    "diggCount" BIGINT,
    "shareCount" BIGINT,
    "commentCount" BIGINT,
    "collectCount" BIGINT,
    "quality" JSONB NOT NULL,

    CONSTRAINT "VideoObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetedShop" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "platformShopId" TEXT,
    "displayName" TEXT,
    "category" TEXT,
    "note" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'TOP100',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "scrapeConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetedShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysisReport" (
    "id" BIGSERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "report" JSONB,
    "dataQuality" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiAnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageCounter" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionBudget" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "reconciledUsed" INTEGER,
    "reserved" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CollectionBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_code_key" ON "DataSource"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetFile_sourceId_sha256_key" ON "DatasetFile"("sourceId", "sha256");

-- CreateIndex
CREATE INDEX "RawRecord_state_idx" ON "RawRecord"("state");

-- CreateIndex
CREATE UNIQUE INDEX "RawRecord_datasetFileId_recordNumber_key" ON "RawRecord"("datasetFileId", "recordNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategory_categoryId_name_key" ON "SubCategory"("categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategory_categoryId_slug_key" ON "SubCategory"("categoryId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdLevelCategory_subCategoryId_name_key" ON "ThirdLevelCategory"("subCategoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdLevelCategory_subCategoryId_slug_key" ON "ThirdLevelCategory"("subCategoryId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryMapping_sourceId_sourcePath_key" ON "CategoryMapping"("sourceId", "sourcePath");

-- CreateIndex
CREATE INDEX "Product_market_currency_idx" ON "Product"("market", "currency");

-- CreateIndex
CREATE INDEX "Product_title_idx" ON "Product"("title");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_platformSkuId_key" ON "ProductVariant"("productId", "platformSkuId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorChannel_profileUrl_key" ON "CreatorChannel"("profileUrl");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorChannel_platform_platformUserId_key" ON "CreatorChannel"("platform", "platformUserId");

-- CreateIndex
CREATE INDEX "Video_publishedAt_idx" ON "Video"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_namespace_externalId_key" ON "ExternalIdentity"("namespace", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductShop_productId_shopId_key" ON "ProductShop"("productId", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCreator_productId_creatorId_key" ON "ProductCreator"("productId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorShop_creatorId_shopId_key" ON "CreatorShop"("creatorId", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVideo_productId_videoId_key" ON "ProductVideo"("productId", "videoId");

-- CreateIndex
CREATE INDEX "ProductCategory_categoryId_idx" ON "ProductCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorCategory_channelId_categoryId_key" ON "CreatorCategory"("channelId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoCategory_videoId_categoryId_key" ON "VideoCategory"("videoId", "categoryId");

-- CreateIndex
CREATE INDEX "RelationEvidence_rawRecordId_idx" ON "RelationEvidence"("rawRecordId");

-- CreateIndex
CREATE INDEX "ProductObservation_productId_observedAt_idx" ON "ProductObservation"("productId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductObservation_productId_rawRecordId_key" ON "ProductObservation"("productId", "rawRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopObservation_shopId_rawRecordId_key" ON "ShopObservation"("shopId", "rawRecordId");

-- CreateIndex
CREATE INDEX "CreatorChannelObservation_channelId_observedAt_idx" ON "CreatorChannelObservation"("channelId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorChannelObservation_channelId_rawRecordId_key" ON "CreatorChannelObservation"("channelId", "rawRecordId");

-- CreateIndex
CREATE INDEX "VideoObservation_videoId_observedAt_idx" ON "VideoObservation"("videoId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoObservation_videoId_rawRecordId_key" ON "VideoObservation"("videoId", "rawRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "TargetedShop_username_key" ON "TargetedShop"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageCounter_scope_bucket_key" ON "AiUsageCounter"("scope", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionBudget_provider_accountKey_period_key" ON "CollectionBudget"("provider", "accountKey", "period");

-- AddForeignKey
ALTER TABLE "DatasetFile" ADD CONSTRAINT "DatasetFile_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawRecord" ADD CONSTRAINT "RawRecord_datasetFileId_fkey" FOREIGN KEY ("datasetFileId") REFERENCES "DatasetFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCategory" ADD CONSTRAINT "SubCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThirdLevelCategory" ADD CONSTRAINT "ThirdLevelCategory_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_thirdLevelCategoryId_fkey" FOREIGN KEY ("thirdLevelCategoryId") REFERENCES "ThirdLevelCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorChannel" ADD CONSTRAINT "CreatorChannel_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CreatorChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CreatorChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductShop" ADD CONSTRAINT "ProductShop_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductShop" ADD CONSTRAINT "ProductShop_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCreator" ADD CONSTRAINT "ProductCreator_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCreator" ADD CONSTRAINT "ProductCreator_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorShop" ADD CONSTRAINT "CreatorShop_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorShop" ADD CONSTRAINT "CreatorShop_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVideo" ADD CONSTRAINT "ProductVideo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVideo" ADD CONSTRAINT "ProductVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_thirdLevelCategoryId_fkey" FOREIGN KEY ("thirdLevelCategoryId") REFERENCES "ThirdLevelCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorCategory" ADD CONSTRAINT "CreatorCategory_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorCategory" ADD CONSTRAINT "CreatorCategory_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CreatorChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorCategory" ADD CONSTRAINT "CreatorCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoCategory" ADD CONSTRAINT "VideoCategory_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoCategory" ADD CONSTRAINT "VideoCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_productShopId_fkey" FOREIGN KEY ("productShopId") REFERENCES "ProductShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_productCreatorId_fkey" FOREIGN KEY ("productCreatorId") REFERENCES "ProductCreator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_creatorShopId_fkey" FOREIGN KEY ("creatorShopId") REFERENCES "CreatorShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_productVideoId_fkey" FOREIGN KEY ("productVideoId") REFERENCES "ProductVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_creatorCategoryId_fkey" FOREIGN KEY ("creatorCategoryId") REFERENCES "CreatorCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_videoCategoryId_fkey" FOREIGN KEY ("videoCategoryId") REFERENCES "VideoCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductObservation" ADD CONSTRAINT "ProductObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductObservation" ADD CONSTRAINT "ProductObservation_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopObservation" ADD CONSTRAINT "ShopObservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopObservation" ADD CONSTRAINT "ShopObservation_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorChannelObservation" ADD CONSTRAINT "CreatorChannelObservation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CreatorChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorChannelObservation" ADD CONSTRAINT "CreatorChannelObservation_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoObservation" ADD CONSTRAINT "VideoObservation_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoObservation" ADD CONSTRAINT "VideoObservation_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysisReport" ADD CONSTRAINT "AiAnalysisReport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_one_target" CHECK (num_nonnulls("productId","shopId","creatorId","channelId","videoId")=1);
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_one_target" CHECK (num_nonnulls("categoryId","subCategoryId","thirdLevelCategoryId")=1);
ALTER TABLE "CreatorCategory" ADD CONSTRAINT "CreatorCategory_one_subject" CHECK (num_nonnulls("creatorId","channelId")=1);
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_one_target" CHECK (num_nonnulls("productShopId","productCreatorId","creatorShopId","productVideoId","productCategoryId","creatorCategoryId","videoCategoryId")=1);
CREATE UNIQUE INDEX "ProductCategory_primary" ON "ProductCategory"("productId") WHERE "isPrimary";
CREATE FUNCTION validate_product_category() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."subCategoryId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SubCategory" WHERE id=NEW."subCategoryId" AND "categoryId"=NEW."categoryId") THEN RAISE EXCEPTION 'subcategory parent mismatch'; END IF;
 IF NEW."thirdLevelCategoryId" IS NOT NULL AND (NEW."subCategoryId" IS NULL OR NOT EXISTS (SELECT 1 FROM "ThirdLevelCategory" WHERE id=NEW."thirdLevelCategoryId" AND "subCategoryId"=NEW."subCategoryId")) THEN RAISE EXCEPTION 'third-level parent mismatch'; END IF; RETURN NEW; END $$;
CREATE TRIGGER "ProductCategory_parent" BEFORE INSERT OR UPDATE ON "ProductCategory" FOR EACH ROW EXECUTE FUNCTION validate_product_category();
DO $$ DECLARE r record; BEGIN FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP EXECUTE format('ALTER SEQUENCE %I RESTART WITH 1000000000',r.sequencename); END LOOP; END $$;
COMMENT ON SCHEMA public IS 'TikTok dataset database v2; no legacy data';
