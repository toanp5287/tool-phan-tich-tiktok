-- Bổ sung ảnh trực quan: banner cửa hàng và ảnh bìa video xu hướng.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "bannerUrl" TEXT;
ALTER TABLE "TrendItem" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT;
