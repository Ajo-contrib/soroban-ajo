-- CreateTable: FraudAlert
-- This model stores alerts raised by the ML/statistical anomaly-detection layer.
-- It complements FraudFlag (rule-based referral fraud) and is the second pillar of
-- the unified fraud-detection architecture (FraudOrchestrator).

CREATE TABLE "FraudAlert" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "alertType"   TEXT NOT NULL,
    "severity"    TEXT NOT NULL,
    "score"       DOUBLE PRECISION NOT NULL,
    "details"     TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'OPEN',
    "source"      TEXT NOT NULL DEFAULT 'ML',
    "fraudFlagId" TEXT,
    "resolution"  TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt"  TIMESTAMP(3),
    "reviewedBy"  TEXT,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FraudAlert_fraudFlagId_key" ON "FraudAlert"("fraudFlagId");
CREATE INDEX "FraudAlert_userId_idx" ON "FraudAlert"("userId");
CREATE INDEX "FraudAlert_status_idx" ON "FraudAlert"("status");
CREATE INDEX "FraudAlert_severity_idx" ON "FraudAlert"("severity");
CREATE INDEX "FraudAlert_alertType_idx" ON "FraudAlert"("alertType");
CREATE INDEX "FraudAlert_createdAt_idx" ON "FraudAlert"("createdAt" DESC);
