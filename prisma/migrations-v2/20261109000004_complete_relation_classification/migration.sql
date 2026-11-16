-- Completes the relation/state classification migration (00000003): entity-state
-- backfill and write grants. The DDL and enum creation in 00000003 succeeded; the
-- enum-typed CASE updates and grants are applied here idempotently.

UPDATE "Product" SET "processingState" = CASE
  WHEN EXISTS (SELECT 1 FROM "ProductCategory" pc WHERE pc."productId" = "Product"."id" AND pc."isPrimary") THEN 'LINKED'::"EntityState"
  ELSE 'NEEDS_DATA'::"EntityState" END;

UPDATE "Shop" SET "processingState" = CASE
  WHEN EXISTS (SELECT 1 FROM "ProductShop" ps WHERE ps."shopId" = "Shop"."id") THEN 'LINKED'::"EntityState"
  ELSE 'NEEDS_DATA'::"EntityState" END;

UPDATE "CreatorChannel" SET "processingState" = CASE
  WHEN EXISTS (SELECT 1 FROM "CreatorCategory" cc WHERE cc."channelId" = "CreatorChannel"."id" OR cc."creatorId" = "CreatorChannel"."creatorId") THEN 'LINKED'::"EntityState"
  ELSE 'NEEDS_DATA'::"EntityState" END;

UPDATE "Video" SET "processingState" = CASE
  WHEN EXISTS (SELECT 1 FROM "VideoCategory" vc WHERE vc."videoId" = "Video"."id") THEN 'LINKED'::"EntityState"
  ELSE 'NEEDS_DATA'::"EntityState" END;

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
