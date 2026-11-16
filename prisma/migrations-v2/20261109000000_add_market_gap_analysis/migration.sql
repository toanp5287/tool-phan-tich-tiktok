CREATE TABLE "MarketGapAnalysis" (
    "id" BIGSERIAL NOT NULL,
    "market" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "subCategoryId" INTEGER,
    "currency" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "dataWatermark" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "MarketGapAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketGapAnalysis_fingerprint_key" ON "MarketGapAnalysis"("fingerprint");
CREATE INDEX "MarketGapAnalysis_categoryId_subCategoryId_currency_days_idx" ON "MarketGapAnalysis"("categoryId", "subCategoryId", "currency", "days");
CREATE INDEX "MarketGapAnalysis_expiresAt_idx" ON "MarketGapAnalysis"("expiresAt");
CREATE INDEX "MarketGapAnalysis_requestedAt_idx" ON "MarketGapAnalysis"("requestedAt");
CREATE INDEX "ProductCategory_category_subCategory_primary_verified_idx"
ON "ProductCategory" ("categoryId", "subCategoryId", "productId")
WHERE "isPrimary" = true AND "verificationStatus" = 'VERIFIED';
CREATE INDEX "ProductShop_active_verified_product_shop_idx"
ON "ProductShop" ("productId", "shopId")
WHERE "isActive" = true AND "verificationStatus" = 'VERIFIED';

ALTER TABLE "MarketGapAnalysis" ADD CONSTRAINT "MarketGapAnalysis_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketGapAnalysis" ADD CONSTRAINT "MarketGapAnalysis_subCategoryId_fkey"
FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION validate_market_gap_analysis_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW."subCategoryId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "SubCategory" WHERE id = NEW."subCategoryId" AND "categoryId" = NEW."categoryId"
  ) THEN RAISE EXCEPTION 'market gap subcategory parent mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MarketGapAnalysis_scope" BEFORE INSERT OR UPDATE ON "MarketGapAnalysis"
FOR EACH ROW EXECUTE FUNCTION validate_market_gap_analysis_scope();
