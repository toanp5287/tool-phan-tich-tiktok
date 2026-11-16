-- Phân cấp ngành hàng: bổ sung ngành con cho sản phẩm
ALTER TABLE "Product" ADD COLUMN "subCategory" TEXT;

CREATE INDEX "Product_category_subCategory_idx" ON "Product" ("category", "subCategory");
