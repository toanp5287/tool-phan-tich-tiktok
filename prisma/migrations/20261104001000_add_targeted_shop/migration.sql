-- Bổ sung bảng TargetedShop (mục tiêu cào Top Shop) — trước đây có trong schema
-- nhưng chưa được tạo bởi migration baseline.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShopPriority') THEN
    CREATE TYPE "ShopPriority" AS ENUM ('TOP10', 'TOP50', 'TOP100');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TargetedShop" (
  "id"             SERIAL PRIMARY KEY,
  "username"       TEXT NOT NULL,
  "platformShopId" TEXT,
  "displayName"    TEXT,
  "category"       TEXT,
  "note"           TEXT,
  "priority"       "ShopPriority" NOT NULL DEFAULT 'TOP100',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "lastScrapedAt"  TIMESTAMP(3),
  "scrapeCount"    INTEGER NOT NULL DEFAULT 0,
  "failCount"      INTEGER NOT NULL DEFAULT 0,
  "scrapeConfig"   JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "TargetedShop_username_key" ON "TargetedShop" ("username");
CREATE INDEX IF NOT EXISTS "TargetedShop_isActive_priority_idx" ON "TargetedShop" ("isActive", "priority");
CREATE INDEX IF NOT EXISTS "TargetedShop_category_isActive_idx" ON "TargetedShop" ("category", "isActive");
CREATE INDEX IF NOT EXISTS "TargetedShop_lastScrapedAt_idx" ON "TargetedShop" ("lastScrapedAt");
