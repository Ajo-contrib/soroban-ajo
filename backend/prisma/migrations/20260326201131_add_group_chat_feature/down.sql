-- Rollback: Remove Group Chat Feature tables and columns
-- This reverses the migration: 20260326201131_add_group_chat_feature
-- 
-- NOTE: This migration removes the entire group chat feature.
-- All chat rooms, messages, and participant records will be permanently lost.
-- Groups will no longer have chat functionality until this is restored.
-- See docs/database-migration-strategy.md for emergency rollback procedures.

-- Drop chat tables (with cascading foreign keys)
DROP TABLE IF EXISTS "ChatParticipant" CASCADE;
DROP TABLE IF EXISTS "ChatMessage" CASCADE;
DROP TABLE IF EXISTS "ChatRoom" CASCADE;

-- Remove chatRoomId column from Group table (added in forward migration)
ALTER TABLE "Group"
DROP COLUMN IF EXISTS "chatRoomId";
