CREATE TABLE "MarketGapAiReport" (
    "id" BIGSERIAL NOT NULL,
    "marketGapAnalysisId" BIGINT NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "report" JSONB,
    "evidenceFingerprint" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DECIMAL(20,8),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "MarketGapAiReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketGapAiReport_marketGapAnalysisId_nicheKey_requestedAt_idx"
ON "MarketGapAiReport"("marketGapAnalysisId", "nicheKey", "requestedAt");
CREATE INDEX "MarketGapAiReport_evidenceFingerprint_idx"
ON "MarketGapAiReport"("evidenceFingerprint");
ALTER TABLE "MarketGapAiReport" ADD CONSTRAINT "MarketGapAiReport_marketGapAnalysisId_fkey"
FOREIGN KEY ("marketGapAnalysisId") REFERENCES "MarketGapAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MarketGapAiReport" TO tiktok_dataset_app;
GRANT USAGE, SELECT ON SEQUENCE "MarketGapAiReport_id_seq" TO tiktok_dataset_app;
