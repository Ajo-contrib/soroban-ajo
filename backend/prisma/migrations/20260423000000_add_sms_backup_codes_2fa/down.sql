-- Rollback: Remove SMS 2FA and backup codes fields from User table
-- This reverses the migration: 20260423000000_add_sms_backup_codes_2fa
-- 
-- NOTE: This migration removes SMS 2FA configuration and backup codes.
-- Any user SMS OTP settings and backup recovery codes will be permanently lost.
-- See docs/database-migration-strategy.md for emergency rollback procedures.

-- AlterTable - Remove SMS 2FA and backup codes columns from User table
ALTER TABLE "User"
DROP COLUMN IF EXISTS "backupCodes",
DROP COLUMN IF EXISTS "smsOtpExpiresAt",
DROP COLUMN IF EXISTS "smsOtpHash",
DROP COLUMN IF EXISTS "phoneNumber",
DROP COLUMN IF EXISTS "twoFactorMethod";
