-- ============================================================
-- Phân khúc giá đa biến thể (SKUs/Variants)
-- 1. Thêm khoảng giá + số lượng biến thể trên Product
-- 2. Bảng ProductVariant lưu từng SKU
-- 3. Backfill khoảng giá từ snapshot hiện có để không vỡ dữ liệu cũ
-- ============================================================

-- ---------- Product: cột khoảng giá ----------
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "minPrice" DECIMAL(18, 2),
  ADD COLUMN IF NOT EXISTS "maxPrice" DECIMAL(18, 2),
  ADD COLUMN IF NOT EXISTS "variantCount" INTEGER NOT NULL DEFAULT 0;

-- ---------- ProductVariant ----------
CREATE TABLE IF NOT EXISTS "ProductVariant" (
  "id"            SERIAL PRIMARY KEY,
  "productId"     INTEGER NOT NULL,
  "platformSkuId" TEXT NOT NULL,
  "name"          TEXT,
  "price"         DECIMAL(18, 2),
  "stock"         INTEGER,
  "attributes"    JSONB,
  "firstSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductVariant_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_platformSkuId_key"
  ON "ProductVariant" ("productId", "platformSkuId");

CREATE INDEX IF NOT EXISTS "ProductVariant_productId_price_idx"
  ON "ProductVariant" ("productId", "price");

-- ---------- Index cho Product ----------
CREATE INDEX IF NOT EXISTS "Product_minPrice_idx" ON "Product" ("minPrice");
CREATE INDEX IF NOT EXISTS "Product_maxPrice_idx" ON "Product" ("maxPrice");

-- ---------- Backfill: sản phẩm chưa có biến thể -> lấy giá snapshot mới nhất ----------
UPDATE "Product" p
SET
  "minPrice" = latest."price",
  "maxPrice" = latest."price"
FROM (
  SELECT DISTINCT ON ("productId") "productId", "price"
  FROM "ProductSnapshot"
  WHERE "price" IS NOT NULL
  ORDER BY "productId", "capturedAt" DESC, "id" DESC
) AS latest
WHERE p."id" = latest."productId"
  AND p."minPrice" IS NULL
  AND p."maxPrice" IS NULL;
