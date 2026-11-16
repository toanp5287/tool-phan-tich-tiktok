-- Additive: daily metric snapshots for 90-day history accumulation.
-- Does not alter existing data; captures real observed values from today forward.
CREATE TABLE "MetricSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DECIMAL(30,4),
    "currency" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "bucketDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL,
    "confidence" INTEGER,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetricSnapshot_entityType_entityId_metric_bucketDate_source_key"
ON "MetricSnapshot"("entityType", "entityId", "metric", "bucketDate", "source");
CREATE INDEX "MetricSnapshot_entityType_entityId_metric_bucketDate_idx"
ON "MetricSnapshot"("entityType", "entityId", "metric", "bucketDate");
CREATE INDEX "MetricSnapshot_bucketDate_idx" ON "MetricSnapshot"("bucketDate");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MetricSnapshot" TO tiktok_dataset_app;
GRANT USAGE, SELECT ON SEQUENCE "MetricSnapshot_id_seq" TO tiktok_dataset_app;
