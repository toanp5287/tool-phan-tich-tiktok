-- Bổ sung lượt bán theo từng biến thể (SKU) để bóc tách dữ liệu sâu hơn.
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "soldCount" INTEGER;
