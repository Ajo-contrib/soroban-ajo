-- Migration: catch_up_schema_drift
--
-- `schema.prisma` had drifted well ahead of the committed migration history:
-- several models/columns were added directly to the schema file (most likely
-- via `prisma db push` in individual dev environments) without ever
-- generating the corresponding migration. Running `prisma migrate deploy`
-- against a fresh database applied every existing migration successfully but
-- still left the resulting schema out of sync with `schema.prisma` — the
-- application's Prisma Client expects tables/columns this never created.
--
-- This migration closes that gap in one pass, generated via
-- `prisma migrate diff --from-url <fully-migrated db> --to-schema-datamodel
-- prisma/schema.prisma --script` against the (now-fixed) migration chain.
--
-- ⚠️  DESTRUCTIVE STATEMENT: the very first statement below drops
-- `"Group"."chatRoomId"`. The 1:1 Group<->ChatRoom relation is now modeled
-- the other way around (`ChatRoom.groupId @unique`, added by
-- `20260326201131_add_group_chat_feature`), so the scalar column on `Group`
-- is redundant under the current schema — but if any environment has real
-- data in `chatRoomId` that was never backfilled into `ChatRoom.groupId`,
-- verify and migrate that data across BEFORE applying this migration there.

-- AlterTable
ALTER TABLE "Group" DROP COLUMN "chatRoomId";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL,
    "backupType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "storagePath" TEXT NOT NULL,
    "s3Key" TEXT,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "encryptionKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "textContent" TEXT,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complaintAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unsubscribe" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT,
    "unsubscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unsubscribe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "listId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMetrics" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "unsubscribeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBSCRIBED',
    "metadata" JSONB,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "BackupRecord_backupType_status_idx" ON "BackupRecord"("backupType", "status");

-- CreateIndex
CREATE INDEX "BackupRecord_startedAt_idx" ON "BackupRecord"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "BackupRecord_status_idx" ON "BackupRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_active_idx" ON "ApiKey"("active");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_name_key" ON "EmailTemplate"("name");

-- CreateIndex
CREATE INDEX "EmailTemplate_isActive_idx" ON "EmailTemplate"("isActive");

-- CreateIndex
CREATE INDEX "EmailDelivery_templateId_idx" ON "EmailDelivery"("templateId");

-- CreateIndex
CREATE INDEX "EmailDelivery_recipientEmail_idx" ON "EmailDelivery"("recipientEmail");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_idx" ON "EmailDelivery"("status");

-- CreateIndex
CREATE INDEX "EmailDelivery_createdAt_idx" ON "EmailDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Unsubscribe_email_key" ON "Unsubscribe"("email");

-- CreateIndex
CREATE INDEX "Unsubscribe_email_idx" ON "Unsubscribe"("email");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_idx" ON "MarketingCampaign"("status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_createdAt_idx" ON "MarketingCampaign"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMetrics_campaignId_key" ON "CampaignMetrics"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignEvent_campaignId_idx" ON "CampaignEvent"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignEvent_email_idx" ON "CampaignEvent"("email");

-- CreateIndex
CREATE INDEX "CampaignEvent_eventType_idx" ON "CampaignEvent"("eventType");

-- CreateIndex
CREATE INDEX "CampaignEvent_occurredAt_idx" ON "CampaignEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContact_email_key" ON "MarketingContact"("email");

-- CreateIndex
CREATE INDEX "MarketingContact_email_idx" ON "MarketingContact"("email");

-- CreateIndex
CREATE INDEX "MarketingContact_status_idx" ON "MarketingContact"("status");

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

-- CreateIndex
CREATE INDEX "Goal_isPublic_status_idx" ON "Goal"("isPublic", "status");

-- CreateIndex
CREATE INDEX "Goal_deadline_idx" ON "Goal"("deadline");

-- CreateIndex
CREATE INDEX "Group_isActive_createdAt_idx" ON "Group"("isActive", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Group_name_idx" ON "Group"("name");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember"("groupId");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetrics" ADD CONSTRAINT "CampaignMetrics_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
