-- Persist versioned statistical fraud-model parameters and validation metrics.
ALTER TABLE "FraudAlert" ADD COLUMN "modelVersionId" TEXT;

CREATE TABLE "FraudModelVersion" (
    "id" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "parameters" TEXT NOT NULL,
    "trainingExamples" INTEGER NOT NULL,
    "validationExamples" INTEGER NOT NULL,
    "validationPrecision" DOUBLE PRECISION NOT NULL,
    "validationRecall" DOUBLE PRECISION NOT NULL,
    "validationF1" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    CONSTRAINT "FraudModelVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FraudAlert_modelVersionId_idx" ON "FraudAlert"("modelVersionId");
CREATE INDEX "FraudModelVersion_status_idx" ON "FraudModelVersion"("status");
CREATE INDEX "FraudModelVersion_createdAt_idx" ON "FraudModelVersion"("createdAt" DESC);

ALTER TABLE "FraudAlert"
  ADD CONSTRAINT "FraudAlert_modelVersionId_fkey"
  FOREIGN KEY ("modelVersionId") REFERENCES "FraudModelVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;