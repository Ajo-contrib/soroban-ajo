ALTER TABLE "FraudAlert" DROP CONSTRAINT IF EXISTS "FraudAlert_modelVersionId_fkey";
DROP INDEX IF EXISTS "FraudAlert_modelVersionId_idx";
DROP INDEX IF EXISTS "FraudModelVersion_status_idx";
DROP INDEX IF EXISTS "FraudModelVersion_createdAt_idx";
DROP TABLE IF EXISTS "FraudModelVersion";
ALTER TABLE "FraudAlert" DROP COLUMN IF EXISTS "modelVersionId";