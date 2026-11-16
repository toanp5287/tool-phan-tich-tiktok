-- Additive simulation provenance. Existing real entities/relations remain unchanged.
-- Synthetic data is isolated by `isSimulated`, stable `simulationKey`, and metadata.

ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "isSimulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "simulationKey" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "simulationMetadata" JSONB;

ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "isSimulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "simulationKey" TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "simulationMetadata" JSONB;

ALTER TABLE "ProductShop" ADD COLUMN IF NOT EXISTS "isSimulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductShop" ADD COLUMN IF NOT EXISTS "simulationMetadata" JSONB;

ALTER TABLE "ProductCreator" ADD COLUMN IF NOT EXISTS "isSimulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductCreator" ADD COLUMN IF NOT EXISTS "simulationMetadata" JSONB;

ALTER TABLE "CreatorShop" ADD COLUMN IF NOT EXISTS "isSimulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CreatorShop" ADD COLUMN IF NOT EXISTS "simulationMetadata" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "Shop_simulationKey_key" ON "Shop"("simulationKey");
CREATE INDEX IF NOT EXISTS "Shop_isSimulated_idx" ON "Shop"("isSimulated");
CREATE UNIQUE INDEX IF NOT EXISTS "Creator_simulationKey_key" ON "Creator"("simulationKey");
CREATE INDEX IF NOT EXISTS "Creator_isSimulated_idx" ON "Creator"("isSimulated");
CREATE INDEX IF NOT EXISTS "ProductShop_isSimulated_idx" ON "ProductShop"("isSimulated");
CREATE INDEX IF NOT EXISTS "ProductCreator_isSimulated_idx" ON "ProductCreator"("isSimulated");
CREATE INDEX IF NOT EXISTS "CreatorShop_isSimulated_idx" ON "CreatorShop"("isSimulated");
