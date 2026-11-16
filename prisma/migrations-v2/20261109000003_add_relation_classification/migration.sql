-- Additive relation-state migration. No data is dropped, truncated or re-keyed.
-- Adds explicit 3-tier relation status (CONFIRMED / INFERRED / PROVISIONAL / REJECTED),
-- per-entity processing state, confidence + reason on links, and grants so the
-- application role can create semantic links. Existing rows are backfilled by mapping
-- the legacy VerificationStatus enum, never overwritten.

CREATE TYPE "RelationStatus" AS ENUM ('CONFIRMED', 'INFERRED', 'PROVISIONAL', 'REJECTED');
CREATE TYPE "EntityState" AS ENUM ('LINKED', 'INFERRED', 'PROVISIONAL', 'PARTIALLY_LINKED', 'UNRESOLVED', 'NEEDS_DATA');

-- RelationEvidence: canonical link record with evidence + timestamps.
ALTER TABLE "RelationEvidence" ADD COLUMN "status" "RelationStatus" NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "RelationEvidence" ADD COLUMN "confidence" INTEGER;
ALTER TABLE "RelationEvidence" ADD COLUMN "reason" TEXT;
ALTER TABLE "RelationEvidence" ADD COLUMN "source" TEXT;
ALTER TABLE "RelationEvidence" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RelationEvidence" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ProductCategory / CreatorCategory / VideoCategory link rows carry their own tier.
ALTER TABLE "ProductCategory" ADD COLUMN "status" "RelationStatus" NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "ProductCategory" ADD COLUMN "confidence" INTEGER;
ALTER TABLE "ProductCategory" ADD COLUMN "reason" TEXT;
ALTER TABLE "ProductCategory" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ProductCategory" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CreatorCategory" ADD COLUMN "status" "RelationStatus" NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "CreatorCategory" ADD COLUMN "confidence" INTEGER;
ALTER TABLE "CreatorCategory" ADD COLUMN "reason" TEXT;
ALTER TABLE "CreatorCategory" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CreatorCategory" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "VideoCategory" ADD COLUMN "status" "RelationStatus" NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "VideoCategory" ADD COLUMN "confidence" INTEGER;
ALTER TABLE "VideoCategory" ADD COLUMN "reason" TEXT;
ALTER TABLE "VideoCategory" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "VideoCategory" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Per-entity processing state (section 8).
ALTER TABLE "Product" ADD COLUMN "processingState" "EntityState" NOT NULL DEFAULT 'NEEDS_DATA';
ALTER TABLE "Product" ADD COLUMN "lastClassifiedAt" TIMESTAMP(3);

ALTER TABLE "Shop" ADD COLUMN "processingState" "EntityState" NOT NULL DEFAULT 'NEEDS_DATA';
ALTER TABLE "Shop" ADD COLUMN "lastClassifiedAt" TIMESTAMP(3);

ALTER TABLE "CreatorChannel" ADD COLUMN "processingState" "EntityState" NOT NULL DEFAULT 'NEEDS_DATA';
ALTER TABLE "CreatorChannel" ADD COLUMN "lastClassifiedAt" TIMESTAMP(3);

ALTER TABLE "Video" ADD COLUMN "processingState" "EntityState" NOT NULL DEFAULT 'NEEDS_DATA';
ALTER TABLE "Video" ADD COLUMN "lastClassifiedAt" TIMESTAMP(3);

-- Backfill relation status from legacy VerificationStatus (read-only mapping).
UPDATE "RelationEvidence" SET "status" = (CASE "verificationStatus"
  WHEN 'VERIFIED' THEN 'CONFIRMED' WHEN 'SUGGESTED' THEN 'INFERRED' ELSE 'PROVISIONAL' END)::"RelationStatus";
UPDATE "ProductCategory" SET "status" = (CASE "verificationStatus"
  WHEN 'VERIFIED' THEN 'CONFIRMED' WHEN 'SUGGESTED' THEN 'INFERRED' ELSE 'PROVISIONAL' END)::"RelationStatus";
UPDATE "CreatorCategory" SET "status" = (CASE "verificationStatus"
  WHEN 'VERIFIED' THEN 'CONFIRMED' WHEN 'SUGGESTED' THEN 'INFERRED' ELSE 'PROVISIONAL' END)::"RelationStatus";
UPDATE "VideoCategory" SET "status" = (CASE "verificationStatus"
  WHEN 'VERIFIED' THEN 'CONFIRMED' WHEN 'SUGGESTED' THEN 'INFERRED' ELSE 'PROVISIONAL' END)::"RelationStatus";

-- Entity processing state backfill from already-present links.
UPDATE "Product" SET "processingState" = (CASE
  WHEN EXISTS (SELECT 1 FROM "ProductCategory" pc WHERE pc."productId" = "Product"."id" AND pc."isPrimary") THEN 'LINKED'
  ELSE 'NEEDS_DATA' END)::"EntityState";
UPDATE "Shop" SET "processingState" = (CASE
  WHEN EXISTS (SELECT 1 FROM "ProductShop" ps WHERE ps."shopId" = "Shop"."id") THEN 'LINKED'
  ELSE 'NEEDS_DATA' END)::"EntityState";
UPDATE "CreatorChannel" SET "processingState" = (CASE
  WHEN EXISTS (SELECT 1 FROM "CreatorCategory" cc WHERE cc."channelId" = "CreatorChannel"."id" OR cc."creatorId" = "CreatorChannel"."creatorId") THEN 'LINKED'
  ELSE 'NEEDS_DATA' END)::"EntityState";
UPDATE "Video" SET "processingState" = (CASE
  WHEN EXISTS (SELECT 1 FROM "VideoCategory" vc WHERE vc."videoId" = "Video"."id") THEN 'LINKED'
  ELSE 'NEEDS_DATA' END)::"EntityState";

-- Application role currently holds SELECT-only on these tables. Grant write access so
-- the linking/backfill service can persist semantic relations and states.
GRANT INSERT, UPDATE ON TABLE "RelationEvidence" TO tiktok_dataset_app;
GRANT INSERT, UPDATE ON TABLE "ProductCategory" TO tiktok_dataset_app;
GRANT INSERT, UPDATE ON TABLE "CreatorCategory" TO tiktok_dataset_app;
GRANT INSERT, UPDATE ON TABLE "VideoCategory" TO tiktok_dataset_app;
GRANT UPDATE ON TABLE "Product" TO tiktok_dataset_app;
GRANT UPDATE ON TABLE "Shop" TO tiktok_dataset_app;
GRANT UPDATE ON TABLE "CreatorChannel" TO tiktok_dataset_app;
GRANT UPDATE ON TABLE "Video" TO tiktok_dataset_app;

GRANT USAGE, SELECT ON SEQUENCE "RelationEvidence_id_seq" TO tiktok_dataset_app;
GRANT USAGE, SELECT ON SEQUENCE "ProductCategory_id_seq" TO tiktok_dataset_app;
GRANT USAGE, SELECT ON SEQUENCE "CreatorCategory_id_seq" TO tiktok_dataset_app;
GRANT USAGE, SELECT ON SEQUENCE "VideoCategory_id_seq" TO tiktok_dataset_app;
