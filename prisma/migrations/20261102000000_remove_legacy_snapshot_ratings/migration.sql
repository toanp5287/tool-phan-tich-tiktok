-- Legacy installations may still contain these fields even though they are not
-- part of the analytics contract anymore. Keep this migration idempotent so it
-- can be deployed against both old and fresh databases.
ALTER TABLE "ProductSnapshot" DROP COLUMN IF EXISTS "rating";
ALTER TABLE "ProductSnapshot" DROP COLUMN IF EXISTS "reviewCount";
