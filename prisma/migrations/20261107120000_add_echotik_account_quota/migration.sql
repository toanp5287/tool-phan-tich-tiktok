CREATE TABLE "EchoTikAccountQuota" (
    "id" SERIAL NOT NULL,
    "accountKey" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "requestType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EchoTikAccountQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EchoTikAccountQuota_accountKey_month_key" ON "EchoTikAccountQuota"("accountKey", "month");
CREATE INDEX "EchoTikAccountQuota_month_idx" ON "EchoTikAccountQuota"("month");

CREATE TABLE "EchoTikRawResponse" (
    "id" BIGSERIAL NOT NULL,
    "requestKey" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "page" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'echotik',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" JSONB NOT NULL,
    CONSTRAINT "EchoTikRawResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EchoTikRawResponse_requestKey_key" ON "EchoTikRawResponse"("requestKey");
CREATE INDEX "EchoTikRawResponse_endpoint_capturedAt_idx" ON "EchoTikRawResponse"("endpoint", "capturedAt");
CREATE INDEX "EchoTikRawResponse_source_capturedAt_idx" ON "EchoTikRawResponse"("source", "capturedAt");
