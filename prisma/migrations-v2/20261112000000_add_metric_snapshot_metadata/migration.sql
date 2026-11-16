-- Additive: metadata column for MetricSnapshot provenance (simulation scenario, generation version, anchors).
-- Does not alter existing data; no reset/truncate.
ALTER TABLE "MetricSnapshot" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
