CREATE TABLE "ProductVideo" (
  "id" SERIAL PRIMARY KEY, "productId" INTEGER NOT NULL, "trendItemId" INTEGER NOT NULL,
  "source" TEXT NOT NULL, "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductVideo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductVideo_trendItemId_fkey" FOREIGN KEY ("trendItemId") REFERENCES "TrendItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductVideo_productId_trendItemId_source_key" ON "ProductVideo"("productId", "trendItemId", "source");
CREATE INDEX "ProductVideo_trendItemId_idx" ON "ProductVideo"("trendItemId");
CREATE TABLE "IntelligenceObservation" (
  "id" BIGSERIAL PRIMARY KEY, "productId" INTEGER NOT NULL, "scrapeJobId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL, "externalId" TEXT NOT NULL, "source" TEXT NOT NULL DEFAULT 'echotik',
  "capturedAt" TIMESTAMP(3) NOT NULL, "rawRequestKeys" JSONB NOT NULL, "data" JSONB NOT NULL,
  CONSTRAINT "IntelligenceObservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "IntelligenceObservation_scrapeJobId_fkey" FOREIGN KEY ("scrapeJobId") REFERENCES "ScrapeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntelligenceObservation_scrapeJobId_kind_externalId_key" ON "IntelligenceObservation"("scrapeJobId", "kind", "externalId");
CREATE INDEX "IntelligenceObservation_productId_capturedAt_idx" ON "IntelligenceObservation"("productId", "capturedAt");
