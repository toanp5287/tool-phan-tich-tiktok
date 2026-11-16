-- Add source tracking for Shop, Product, Creator to support multi-source data (Apify + EchoTik)

-- AlterTable Shop: Add source column and echotikMetadata
ALTER TABLE "Shop" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'apify';
ALTER TABLE "Shop" ADD COLUMN "echotikMetadata" JSONB;

-- Drop old unique constraint on Shop.platformShopId
ALTER TABLE "Shop" DROP CONSTRAINT "Shop_platformShopId_key";

-- Add new composite unique constraint
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_platformShopId_source_key" UNIQUE ("platformShopId", "source");

-- Add index on source column
CREATE INDEX "Shop_source_idx" ON "Shop"("source");

-- AlterTable Product: Add source column
ALTER TABLE "Product" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'apify';

-- Drop old unique constraint on Product.platformProductId
ALTER TABLE "Product" DROP CONSTRAINT "Product_platformProductId_key";

-- Add new composite unique constraint
ALTER TABLE "Product" ADD CONSTRAINT "Product_platformProductId_source_key" UNIQUE ("platformProductId", "source");

-- Add index on source column
CREATE INDEX "Product_source_idx" ON "Product"("source");

-- AlterTable Creator: Add source column
ALTER TABLE "Creator" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'apify';

-- Drop old unique constraints on Creator
ALTER TABLE "Creator" DROP CONSTRAINT "Creator_platformCreatorId_key";
ALTER TABLE "Creator" DROP CONSTRAINT "Creator_username_key";

-- Add new composite unique constraint for platformCreatorId
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_platformCreatorId_source_key" UNIQUE ("platformCreatorId", "source");

-- Add index on source column
CREATE INDEX "Creator_source_idx" ON "Creator"("source");

-- Create partial unique index for username (allow same username from different sources)
CREATE UNIQUE INDEX "Creator_username_source_key" ON "Creator"("username", "source") WHERE "username" IS NOT NULL;
