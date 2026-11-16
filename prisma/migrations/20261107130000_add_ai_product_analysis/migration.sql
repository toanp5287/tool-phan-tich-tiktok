CREATE TABLE "AiAnalysisReport" (
  "id" BIGSERIAL NOT NULL,
  "productId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "report" JSONB,
  "dataQuality" JSONB,
  "dataWindowDays" INTEGER NOT NULL,
  "dataAsOf" TIMESTAMP(3),
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DECIMAL(18,8),
  "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAnalysisReport_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiUsageCounter" (
  "id" SERIAL NOT NULL,
  "scope" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DECIMAL(18,8),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiUsageCounter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiAnalysisReport_productId_createdAt_idx" ON "AiAnalysisReport"("productId", "createdAt");
CREATE INDEX "AiAnalysisReport_productId_status_createdAt_idx" ON "AiAnalysisReport"("productId", "status", "createdAt");
CREATE UNIQUE INDEX "AiUsageCounter_scope_bucket_key" ON "AiUsageCounter"("scope", "bucket");
CREATE INDEX "AiUsageCounter_bucket_idx" ON "AiUsageCounter"("bucket");
ALTER TABLE "AiAnalysisReport" ADD CONSTRAINT "AiAnalysisReport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
