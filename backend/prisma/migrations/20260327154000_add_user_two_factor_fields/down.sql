-- Rollback: Remove 2FA fields from User table
-- This reverses the migration: 20260327154000_add_user_two_factor_fields
-- 
-- NOTE: This migration removes 2FA configuration columns.
-- Any user 2FA settings will be permanently lost if this rollback is executed.
-- See docs/database-migration-strategy.md for emergency rollback procedures.

-- AlterTable - Remove 2FA columns from User table
ALTER TABLE "User"
DROP COLUMN IF EXISTS "twoFactorEnabledAt",
DROP COLUMN IF EXISTS "twoFactorSecret",
DROP COLUMN IF EXISTS "twoFactorEnabled";
