import { gql } from 'graphql-tag'

export const typeDefs = gql`
  type Group {
    id: ID!
    name: String!
    contributionAmount: String!
    frequency: Int!
    maxMembers: Int!
    currentRound: Int!
    isActive: Boolean!
    createdAt: String!
    memberCount: Int
    members: [Member!]!
    contributions: [Contribution!]!
  }

  type Member {
    id: ID!
    groupId: ID!
    userId: String!
    joinedAt: String!
  }

  type Contribution {
    id: ID!
    groupId: ID!
    userId: String!
    amount: String!
    round: Int!
    txHash: String!
    createdAt: String!
  }

  type Payout {
    id: ID!
    groupId: ID!
    recipientId: String!
    amount: String!
    currency: String!
    cycleNumber: Int!
    transactionHash: String
    status: String!
    processedAt: String
    createdAt: String!
  }

  type Goal {
    id: ID!
    userId: String!
    title: String!
    description: String
    targetAmount: String!
    currentAmount: String!
    deadline: String!
    category: String!
    isPublic: Boolean!
    status: String!
    createdAt: String!
  }

  type Reward {
    id: ID!
    userId: String!
    type: String!
    status: String!
    earnedAt: String!
  }

  """
  Dispute state stored in Redis (see disputeService) rather than Postgres —
  there is no Prisma-backed pagination/dataloader story for it, matching REST.
  """
  type Dispute {
    id: ID!
    groupId: ID!
    filedBy: String!
    type: String!
    summary: String
    evidence: [EvidenceItem!]!
    status: String!
    createdAt: String!
    votingDeadline: String
    decision: String
    resolvedBy: String
    adminDecision: String
  }

  type EvidenceItem {
    id: ID!
    type: String!
    content: String!
    uploadedAt: String!
  }

  type InsurancePool {
    balance: String!
    totalPayouts: String!
    pendingClaimsCount: Int!
  }

  """
  Result of an on-chain write. Two-phase client-signs flow: a response with
  only unsignedXdr means the caller must sign and resubmit; txHash means
  it was already submitted (mirrors REST's soroban write-endpoint shape).
  """
  type TransactionResult {
    success: Boolean
    txHash: String
    unsignedXdr: String
  }

  type GamificationProfile {
    points: Int!
    level: String!
    contributionStreak: Int!
    loginStreak: Int!
    totalInvites: Int!
    groupsCompleted: Int!
  }

  type Achievement {
    id: ID!
    name: String!
    description: String!
    icon: String!
    category: String!
    points: Int!
    unlockedAt: String!
  }

  type ChallengeProgress {
    id: ID!
    name: String!
    description: String!
    type: String!
    points: Int!
    progress: Int!
    target: Int!
  }

  type GamificationStats {
    gamification: GamificationProfile
    achievements: [Achievement!]!
    challenges: [ChallengeProgress!]!
  }

  type LeaderboardEntry {
    userId: String!
    walletAddress: String!
    points: Int!
    level: String!
    contributionStreak: Int!
    rank: Int!
  }

  type ActivityFeedItem {
    id: ID!
    type: String!
    title: String!
    description: String!
    createdAt: String!
  }

  type PaginationInfo {
    page: Int!
    limit: Int!
    total: Int
    totalPages: Int
  }

  type GroupsResult {
    data: [Group!]!
    pagination: PaginationInfo!
  }

  type PayoutsResult {
    data: [Payout!]!
    pagination: PaginationInfo!
  }

  type RewardHistoryResult {
    history: [Reward!]!
    totalEarned: Int!
    totalRedeemed: Int!
  }

  type Query {
    groups(page: Int, limit: Int): GroupsResult!
    group(id: ID!): Group
    goals(userId: String!): [Goal!]!
    goal(id: ID!): Goal
    rewards(userId: String!, status: String, type: String): [Reward!]!
    rewardHistory(userId: String!): RewardHistoryResult!

    payouts(groupId: ID!, page: Int, limit: Int): PayoutsResult!

    dispute(id: ID!): Dispute
    disputesByGroup(groupId: ID!): [Dispute!]!

    insurancePool(tokenAddress: String!): InsurancePool!

    """Requires auth; always resolves the caller's own stats (matches REST /api/gamification/stats)."""
    gamificationStats: GamificationStats
    leaderboard(limit: Int, offset: Int): [LeaderboardEntry!]!
    """Requires auth; always resolves the caller's own feed (matches REST /api/gamification/activity)."""
    activityFeed(limit: Int, offset: Int): [ActivityFeedItem!]!
  }

  type Mutation {
    createGoal(
      title: String!
      description: String
      targetAmount: String!
      deadline: String!
      category: String!
      isPublic: Boolean
    ): Goal!

    updateGoal(
      id: ID!
      title: String
      description: String
      targetAmount: String
      deadline: String
      category: String
      isPublic: Boolean
      status: String
    ): Goal!

    deleteGoal(id: ID!): Boolean!

    redeemReward(rewardId: ID!): Reward

    fileDispute(
      groupId: ID!
      type: String!
      summary: String
      evidence: [EvidenceItemInput!]
    ): Dispute!

    voteOnDispute(id: ID!, vote: String!): Dispute!

    fileInsuranceClaim(
      groupId: String!
      cycle: Int!
      defaulter: String!
      amount: String!
      signedXdr: String
    ): TransactionResult!

    processInsuranceClaim(claimId: ID!, approved: Boolean!, signedXdr: String): TransactionResult!
  }

  input EvidenceItemInput {
    type: String!
    content: String!
  }

  type Subscription {
    groupUpdated(groupId: ID!): Group
    contributionAdded(groupId: ID!): ContributionEvent
  }

  type ContributionEvent {
    groupId: ID!
    userId: String!
    amount: String!
    txHash: String!
    timestamp: String!
  }
`
