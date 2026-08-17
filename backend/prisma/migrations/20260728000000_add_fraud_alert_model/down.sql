-- Rollback: Remove FraudAlert table and all related indexes
-- This reverses the migration: 20260728000000_add_fraud_alert_model
-- 
-- NOTE: This migration removes the FraudAlert table entirely.
-- Data loss is permanent and cannot be recovered from this database state alone.
-- See docs/database-migration-strategy.md for emergency rollback procedures.

-- Drop indexes first (reverse order)
DROP INDEX IF EXISTS "FraudAlert_createdAt_idx" CASCADE;
DROP INDEX IF EXISTS "FraudAlert_alertType_idx" CASCADE;
DROP INDEX IF EXISTS "FraudAlert_severity_idx" CASCADE;
DROP INDEX IF EXISTS "FraudAlert_status_idx" CASCADE;
DROP INDEX IF EXISTS "FraudAlert_userId_idx" CASCADE;
DROP INDEX IF EXISTS "FraudAlert_fraudFlagId_key" CASCADE;

-- Drop table
DROP TABLE IF EXISTS "FraudAlert" CASCADE;
