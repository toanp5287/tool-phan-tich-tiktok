-- FK trực tiếp Product.shopId -> Shop.id (nhà bán đại diện của sản phẩm).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Product_shopId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Product_shopId_idx" ON "Product" ("shopId");

-- Backfill: gán shopId cho sản phẩm từ ProductShop đang active (chọn shop mới nhất).
UPDATE "Product" p
SET "shopId" = sub."shopId"
FROM (
  SELECT DISTINCT ON ("productId") "productId", "shopId"
  FROM "ProductShop"
  WHERE "isActive" = true
  ORDER BY "productId", "lastSeenAt" DESC
) sub
WHERE p."id" = sub."productId" AND p."shopId" IS NULL;
