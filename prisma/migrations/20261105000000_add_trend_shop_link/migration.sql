-- Gắn video xu hướng trực tiếp với shop để trang Cửa hàng hiển thị
-- "Top Trend Video" đúng phạm vi thương mại, không cần join qua sản phẩm.
ALTER TABLE "TrendItem" ADD COLUMN IF NOT EXISTS "shopId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TrendItem_shopId_fkey'
  ) THEN
    ALTER TABLE "TrendItem"
      ADD CONSTRAINT "TrendItem_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TrendItem_shopId_scrapedAt_idx" ON "TrendItem" ("shopId", "scrapedAt");
CREATE INDEX IF NOT EXISTS "Shop_region_gmvTotal_idx" ON "Shop" ("region", "gmvTotal");
