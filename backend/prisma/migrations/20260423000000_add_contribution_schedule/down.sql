-- Rollback: Remove ContributionSchedule and PaymentWindow tables
-- This reverses the migration: 20260423000000_add_contribution_schedule
-- 
-- NOTE: This migration removes contribution scheduling infrastructure.
-- All scheduled payment windows and cycle scheduling will be permanently lost.
-- Groups will lose their contribution timing rules until this is restored.
-- See docs/database-migration-strategy.md for emergency rollback procedures.

-- Drop foreign key constraints first (cascading delete is configured)
-- Drop PaymentWindow first (references ContributionSchedule)
DROP TABLE IF EXISTS "PaymentWindow" CASCADE;

-- Drop ContributionSchedule
DROP TABLE IF EXISTS "ContributionSchedule" CASCADE;
