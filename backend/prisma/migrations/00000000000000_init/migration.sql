-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetAmount" BIGINT NOT NULL,
    "currentAmount" BIGINT NOT NULL DEFAULT 0,
    "deadline" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalMember" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contributionAmount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "GoalMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contributionAmount" BIGINT NOT NULL,
    "frequency" INTEGER NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "round" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "eventData" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMetrics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalContributed" BIGINT NOT NULL DEFAULT 0,
    "totalReceived" BIGINT NOT NULL DEFAULT 0,
    "groupsJoined" INTEGER NOT NULL DEFAULT 0,
    "groupsCompleted" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "churnScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ltv" BIGINT NOT NULL DEFAULT 0,
    "predictedChurn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMetrics" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "totalContributions" BIGINT NOT NULL DEFAULT 0,
    "totalPayouts" BIGINT NOT NULL DEFAULT 0,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "completedRounds" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defaultRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgContributionTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "predictedSuccess" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CohortAnalysis" (
    "id" TEXT NOT NULL,
    "cohortDate" TIMESTAMP(3) NOT NULL,
    "cohortSize" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "activeUsers" INTEGER NOT NULL,
    "retentionRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CohortAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "variants" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ABTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "exportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "filePath" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGamification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL DEFAULT 'BRONZE',
    "contributionStreak" INTEGER NOT NULL DEFAULT 0,
    "loginStreak" INTEGER NOT NULL DEFAULT 0,
    "lastContribution" TIMESTAMP(3),
    "lastLogin" TIMESTAMP(3),
    "totalInvites" INTEGER NOT NULL DEFAULT 0,
    "groupsCompleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGamification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "requirement" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFollow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityFeed" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonalEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "rewards" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiSigConfig" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "totalSigners" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiSigConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignerConfig" (
    "id" TEXT NOT NULL,
    "multiSigId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "SignerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionProposal" (
    "id" TEXT NOT NULL,
    "multiSigId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "transactionXdr" TEXT NOT NULL,
    "metadata" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requiredSigs" INTEGER NOT NULL,
    "currentSigs" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "executedTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalSignature" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "discountPercent" INTEGER,
    "tokenAmount" BIGINT,
    "featureId" TEXT,
    "nftMetadata" TEXT,
    "txHash" TEXT,
    "nftTokenId" TEXT,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "metadata" TEXT,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudFlag" (
    "id" TEXT NOT NULL,
    "referralId" TEXT,
    "userId" TEXT,
    "flagType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "FraudFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardCache" (
    "id" TEXT NOT NULL,
    "leaderboardType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "score" BIGINT NOT NULL,
    "metadata" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "RewardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "GoalMember_goalId_userId_key" ON "GoalMember"("goalId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_txHash_key" ON "Contribution"("txHash");

-- CreateIndex
CREATE INDEX "Contribution_groupId_round_idx" ON "Contribution"("groupId", "round");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_timestamp_idx" ON "AnalyticsEvent"("eventType", "timestamp");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_timestamp_idx" ON "AnalyticsEvent"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_groupId_timestamp_idx" ON "AnalyticsEvent"("groupId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "UserMetrics_userId_key" ON "UserMetrics"("userId");

-- CreateIndex
CREATE INDEX "UserMetrics_predictedChurn_idx" ON "UserMetrics"("predictedChurn");

-- CreateIndex
CREATE INDEX "UserMetrics_churnScore_idx" ON "UserMetrics"("churnScore");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMetrics_groupId_key" ON "GroupMetrics"("groupId");

-- CreateIndex
CREATE INDEX "GroupMetrics_predictedSuccess_idx" ON "GroupMetrics"("predictedSuccess");

-- CreateIndex
CREATE INDEX "GroupMetrics_riskScore_idx" ON "GroupMetrics"("riskScore");

-- CreateIndex
CREATE INDEX "CohortAnalysis_cohortDate_idx" ON "CohortAnalysis"("cohortDate");

-- CreateIndex
CREATE UNIQUE INDEX "CohortAnalysis_cohortDate_period_key" ON "CohortAnalysis"("cohortDate", "period");

-- CreateIndex
CREATE INDEX "ABTest_status_idx" ON "ABTest"("status");

-- CreateIndex
CREATE INDEX "DataExport_userId_status_idx" ON "DataExport"("userId", "status");

-- CreateIndex
CREATE INDEX "DataExport_status_idx" ON "DataExport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserGamification_userId_key" ON "UserGamification"("userId");

-- CreateIndex
CREATE INDEX "UserGamification_points_idx" ON "UserGamification"("points" DESC);

-- CreateIndex
CREATE INDEX "UserGamification_level_idx" ON "UserGamification"("level");

-- CreateIndex
CREATE INDEX "UserGamification_userId_idx" ON "UserGamification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_name_key" ON "Achievement"("name");

-- CreateIndex
CREATE INDEX "Achievement_category_idx" ON "Achievement"("category");

-- CreateIndex
CREATE INDEX "Achievement_isActive_idx" ON "Achievement"("isActive");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_idx" ON "UserAchievement"("userId");

-- CreateIndex
CREATE INDEX "UserAchievement_achievementId_idx" ON "UserAchievement"("achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "Challenge_type_idx" ON "Challenge"("type");

-- CreateIndex
CREATE INDEX "Challenge_isActive_idx" ON "Challenge"("isActive");

-- CreateIndex
CREATE INDEX "Challenge_startDate_endDate_idx" ON "Challenge"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "UserChallenge_userId_idx" ON "UserChallenge"("userId");

-- CreateIndex
CREATE INDEX "UserChallenge_challengeId_idx" ON "UserChallenge"("challengeId");

-- CreateIndex
CREATE INDEX "UserChallenge_completed_idx" ON "UserChallenge"("completed");

-- CreateIndex
CREATE UNIQUE INDEX "UserChallenge_userId_challengeId_key" ON "UserChallenge"("userId", "challengeId");

-- CreateIndex
CREATE INDEX "UserFollow_followerId_idx" ON "UserFollow"("followerId");

-- CreateIndex
CREATE INDEX "UserFollow_followingId_idx" ON "UserFollow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFollow_followerId_followingId_key" ON "UserFollow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "ActivityFeed_userId_createdAt_idx" ON "ActivityFeed"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityFeed_type_idx" ON "ActivityFeed"("type");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonalEvent_name_key" ON "SeasonalEvent"("name");

-- CreateIndex
CREATE INDEX "SeasonalEvent_isActive_idx" ON "SeasonalEvent"("isActive");

-- CreateIndex
CREATE INDEX "SeasonalEvent_startDate_endDate_idx" ON "SeasonalEvent"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "PointTransaction_userId_idx" ON "PointTransaction"("userId");

-- CreateIndex
CREATE INDEX "PointTransaction_referenceId_referenceType_idx" ON "PointTransaction"("referenceId", "referenceType");

-- CreateIndex
CREATE INDEX "PointTransaction_createdAt_idx" ON "PointTransaction"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_userId_referenceId_referenceType_key" ON "PointTransaction"("userId", "referenceId", "referenceType");

-- CreateIndex
CREATE INDEX "RewardHistory_userId_idx" ON "RewardHistory"("userId");

-- CreateIndex
CREATE INDEX "RewardHistory_rewardType_idx" ON "RewardHistory"("rewardType");

-- CreateIndex
CREATE INDEX "RewardHistory_createdAt_idx" ON "RewardHistory"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RewardHistory_userId_rewardType_rewardId_key" ON "RewardHistory"("userId", "rewardType", "rewardId");

-- CreateIndex
CREATE UNIQUE INDEX "MultiSigConfig_groupId_key" ON "MultiSigConfig"("groupId");

-- CreateIndex
CREATE INDEX "MultiSigConfig_groupId_idx" ON "MultiSigConfig"("groupId");

-- CreateIndex
CREATE INDEX "MultiSigConfig_isActive_idx" ON "MultiSigConfig"("isActive");

-- CreateIndex
CREATE INDEX "SignerConfig_multiSigId_idx" ON "SignerConfig"("multiSigId");

-- CreateIndex
CREATE INDEX "SignerConfig_walletAddress_idx" ON "SignerConfig"("walletAddress");

-- CreateIndex
CREATE INDEX "SignerConfig_isActive_idx" ON "SignerConfig"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SignerConfig_multiSigId_walletAddress_key" ON "SignerConfig"("multiSigId", "walletAddress");

-- CreateIndex
CREATE INDEX "TransactionProposal_multiSigId_idx" ON "TransactionProposal"("multiSigId");

-- CreateIndex
CREATE INDEX "TransactionProposal_proposerId_idx" ON "TransactionProposal"("proposerId");

-- CreateIndex
CREATE INDEX "TransactionProposal_status_idx" ON "TransactionProposal"("status");

-- CreateIndex
CREATE INDEX "TransactionProposal_expiresAt_idx" ON "TransactionProposal"("expiresAt");

-- CreateIndex
CREATE INDEX "TransactionProposal_createdAt_idx" ON "TransactionProposal"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProposalSignature_proposalId_idx" ON "ProposalSignature"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalSignature_signerId_idx" ON "ProposalSignature"("signerId");

-- CreateIndex
CREATE INDEX "ProposalSignature_signedAt_idx" ON "ProposalSignature"("signedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProposalSignature_proposalId_signerId_key" ON "ProposalSignature"("proposalId", "signerId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Referral_referralCode_idx" ON "Referral"("referralCode");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_refereeId_key" ON "Referral"("refereeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_userId_key" ON "ReferralCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralCode_code_idx" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "Reward_userId_status_idx" ON "Reward"("userId", "status");

-- CreateIndex
CREATE INDEX "Reward_type_idx" ON "Reward"("type");

-- CreateIndex
CREATE INDEX "Reward_source_sourceId_idx" ON "Reward"("source", "sourceId");

-- CreateIndex
CREATE INDEX "Reward_expiresAt_idx" ON "Reward"("expiresAt");

-- CreateIndex
CREATE INDEX "FraudFlag_referralId_idx" ON "FraudFlag"("referralId");

-- CreateIndex
CREATE INDEX "FraudFlag_userId_idx" ON "FraudFlag"("userId");

-- CreateIndex
CREATE INDEX "FraudFlag_status_idx" ON "FraudFlag"("status");

-- CreateIndex
CREATE INDEX "FraudFlag_severity_idx" ON "FraudFlag"("severity");

-- CreateIndex
CREATE INDEX "LeaderboardCache_leaderboardType_period_rank_idx" ON "LeaderboardCache"("leaderboardType", "period", "rank");

-- CreateIndex
CREATE INDEX "LeaderboardCache_updatedAt_idx" ON "LeaderboardCache"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardCache_leaderboardType_period_userId_key" ON "LeaderboardCache"("leaderboardType", "period", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardConfig_name_key" ON "RewardConfig"("name");

-- CreateIndex
CREATE INDEX "RewardConfig_isActive_idx" ON "RewardConfig"("isActive");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalMember" ADD CONSTRAINT "GoalMember_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalMember" ADD CONSTRAINT "GoalMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMetrics" ADD CONSTRAINT "UserMetrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMetrics" ADD CONSTRAINT "GroupMetrics_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGamification" ADD CONSTRAINT "UserGamification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserChallenge" ADD CONSTRAINT "UserChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserChallenge" ADD CONSTRAINT "UserChallenge_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFollow" ADD CONSTRAINT "UserFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityFeed" ADD CONSTRAINT "ActivityFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardHistory" ADD CONSTRAINT "RewardHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiSigConfig" ADD CONSTRAINT "MultiSigConfig_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignerConfig" ADD CONSTRAINT "SignerConfig_multiSigId_fkey" FOREIGN KEY ("multiSigId") REFERENCES "MultiSigConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionProposal" ADD CONSTRAINT "TransactionProposal_multiSigId_fkey" FOREIGN KEY ("multiSigId") REFERENCES "MultiSigConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalSignature" ADD CONSTRAINT "ProposalSignature_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TransactionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalSignature" ADD CONSTRAINT "ProposalSignature_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "SignerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardCache" ADD CONSTRAINT "LeaderboardCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("walletAddress") ON DELETE CASCADE ON UPDATE CASCADE;

