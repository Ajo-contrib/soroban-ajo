import { PrismaClient } from '@prisma/client';
import { RewardConfiguration, RewardDefinition, NFTMetadata } from './RewardConfigParser';
import { FraudDetector } from './FraudDetector';

// Local type alias since Reward model may not be in the generated Prisma client
type Reward = Record<string, any>;

/**
 * Interface satisfied by both FraudDetector (rule-only) and FraudOrchestrator
 * (ensemble). RewardEngine only needs shouldBlockReward.
 */
export interface RewardFraudGate {
  shouldBlockReward(userId: string): Promise<boolean>;
}

/**
 * Core engine for reward calculation, distribution, and management
 */
export class RewardEngine {
  private config: RewardConfiguration | null = null;

  constructor(
    private prisma: PrismaClient,
    private fraudDetector: RewardFraudGate
  ) {}

  /**
   * Loads a new reward configuration into the engine and persists it to the database.
   * Automatically deactivates any existing configurations with lower version numbers.
   * 
   * @param config - The validated RewardConfiguration object to activate
   * @returns Promise resolving when the configuration is successfully loaded and persisted
   */
  async loadConfiguration(config: RewardConfiguration): Promise<void> {
    this.config = config;

    // Store configuration in database
    await this.prisma.rewardConfig.create({
      data: {
        name: `config_v${config.version}`,
        version: config.version,
        config: JSON.stringify(config),
        isActive: true,
        activatedAt: new Date(),
      },
    });

    // Deactivate previous configurations
    await this.prisma.rewardConfig.updateMany({
      where: {
        version: { lt: config.version },
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
  }

  /**
   * Retrieves the currently active reward configuration.
   * If not cached in memory, it will be fetched from the database.
   * 
   * @returns Promise resolving to the active RewardConfiguration
   * @throws {Error} If no active configuration is found in the database
   */
  async getConfiguration(): Promise<RewardConfiguration> {
    if (this.config) {
      return this.config;
    }

    // Load from database
    const activeConfig = await this.prisma.rewardConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });

    if (!activeConfig) {
      throw new Error('No active reward configuration found');
    }

    this.config = JSON.parse(activeConfig.config) as RewardConfiguration;
    return this.config;
  }

  /**
   * Orchestrates the distribution of rewards for a successfully completed referral.
   * Checks for fraud blocks on both parties before granting defined rewards.
   * 
   * @param referrerId - Unique identifier of the user who made the referral
   * @param refereeId - Unique identifier of the user who was referred
   * @returns Promise resolving when rewards for both parties are processed
   */
  async distributeReferralReward(referrerId: string, refereeId: string): Promise<void> {
    // Check if rewards should be blocked
    if (await this.fraudDetector.shouldBlockReward(refereeId)) {
      // Rewards blocked for referee due to fraud flags
      return;
    }

    if (await this.fraudDetector.shouldBlockReward(referrerId)) {
      // Rewards blocked for referrer due to fraud flags
      return;
    }

    const config = await this.getConfiguration();

    // Grant rewards to referrer
    for (const rewardDef of config.referralRewards.referrer) {
      await this.grantReward(referrerId, rewardDef, 'REFERRAL', refereeId);
    }

    // Grant rewards to referee
    for (const rewardDef of config.referralRewards.referee) {
      await this.grantReward(refereeId, rewardDef, 'REFERRAL', referrerId);
    }
  }

  /**
   * Distributes rewards associated with a specific achievement that a user has unlocked.
   * 
   * @param userId - Unique identifier of the user who unlocked the achievement
   * @param achievementId - Programmatic name of the achievement
   * @returns Promise resolving when all associated rewards are granted
   * @throws {Error} If the specified achievement is not found in the current configuration
   */
  async distributeAchievementReward(userId: string, achievementId: string): Promise<void> {
    if (await this.fraudDetector.shouldBlockReward(userId)) {
      // Rewards blocked for user due to fraud flags
      return;
    }

    const config = await this.getConfiguration();
    const achievement = config.achievements[achievementId];

    if (!achievement) {
      throw new Error(`Achievement ${achievementId} not found in configuration`);
    }

    for (const rewardDef of achievement.rewards) {
      await this.grantReward(userId, rewardDef, 'ACHIEVEMENT', achievementId);
    }
  }

  /**
   * High-level dispatcher that grants a specific reward type based on its definition.
   * 
   * @param userId - Unique identifier of the recipient
   * @param rewardDef - Precise definition of the reward (type, amount, metadata)
   * @param source - The context of the reward (e.g., 'REFERRAL', 'ACHIEVEMENT')
   * @param sourceId - Related identifier for tracking (e.g., refereeId, achievementId)
   * @returns Promise resolving to the created Reward record
   * @throws {Error} If the reward type is unsupported
   * @internal
   */
  private async grantReward(
    userId: string,
    rewardDef: RewardDefinition,
    source: string,
    sourceId: string
  ): Promise<Reward> {
    const expiresAt = rewardDef.expirationDays
      ? new Date(Date.now() + rewardDef.expirationDays * 24 * 60 * 60 * 1000)
      : null;

    switch (rewardDef.type) {
      case 'FEE_DISCOUNT':
        return this.grantFeeDiscount(
          userId,
          Number(rewardDef.amount),
          expiresAt!,
          source,
          sourceId
        );

      case 'BONUS_TOKEN':
        return this.grantBonusTokens(
          userId,
          BigInt(rewardDef.amount!),
          source,
          sourceId
        );

      case 'PREMIUM_FEATURE':
        return this.grantPremiumFeature(
          userId,
          rewardDef.featureId!,
          expiresAt!,
          source,
          sourceId
        );

      case 'NFT_BADGE':
        return this.mintNFTBadge(
          userId,
          rewardDef.nftMetadata!,
          source,
          sourceId
        );

      default:
        throw new Error(`Unknown reward type: ${rewardDef.type}`);
    }
  }

  /**
   * Grants a percentage-based fee discount to a user for a specific duration.
   * 
   * @param userId - Unique identifier of the user
   * @param percent - The discount percentage (e.g., 10 for 10%)
   * @param expiresAt - Date when the discount becomes invalid
   * @param source - Contextual source of the discount
   * @param sourceId - Optional related identifier
   * @returns Promise resolving to the created Reward record
   */
  async grantFeeDiscount(
    userId: string,
    percent: number,
    expiresAt: Date,
    source: string = 'MANUAL',
    sourceId?: string
  ): Promise<Reward> {
    return this.prisma.reward.create({
      data: {
        userId,
        type: 'FEE_DISCOUNT',
        status: 'ACTIVE',
        source,
        sourceId,
        discountPercent: percent,
        expiresAt,
      },
    });
  }

  /**
   * Grants bonus tokens to a user. This initially creates a 'PENDING' record and
   * then triggers the blockchain transfer (mocked in current implementation).
   * 
   * @param userId - Unique identifier of the user
   * @param amount - Number of tokens to award (as bigint)
   * @param source - Contextual source of the award
   * @param sourceId - Optional related identifier
   * @returns Promise resolving to the activated Reward record
   */
  async grantBonusTokens(
    userId: string,
    amount: bigint,
    source: string = 'MANUAL',
    sourceId?: string
  ): Promise<Reward> {
    const reward = await this.prisma.reward.create({
      data: {
        userId,
        type: 'BONUS_TOKEN',
        status: 'PENDING',
        source,
        sourceId,
        tokenAmount: amount,
      },
    });

    // TODO: Integrate with blockchain service to transfer tokens
    // For now, mark as ACTIVE immediately
    // In production, this would be handled by RewardBlockchainService
    await this.prisma.reward.update({
      where: { id: reward.id },
      data: { status: 'ACTIVE' },
    });

    return reward;
  }

  /**
   * Grants temporary access to a premium feature.
   * 
   * @param userId - Unique identifier of the user
   * @param featureId - Identifier of the feature to enable
   * @param expiresAt - Date when access should be revoked
   * @param source - Contextual source of the access grant
   * @param sourceId - Optional related identifier
   * @returns Promise resolving to the created Reward record
   */
  async grantPremiumFeature(
    userId: string,
    featureId: string,
    expiresAt: Date,
    source: string = 'MANUAL',
    sourceId?: string
  ): Promise<Reward> {
    return this.prisma.reward.create({
      data: {
        userId,
        type: 'PREMIUM_FEATURE',
        status: 'ACTIVE',
        source,
        sourceId,
        featureId,
        expiresAt,
      },
    });
  }

  /**
   * Initiates the minting of an NFT badge for a user.
   * 
   * @param userId - Unique identifier of the recipient
   * @param metadata - NFT metadata (name, image URI, attributes)
   * @param source - Contextual source of the badge
   * @param sourceId - Optional related identifier
   * @returns Promise resolving to the activated Reward record
   */
  async mintNFTBadge(
    userId: string,
    metadata: NFTMetadata,
    source: string = 'MANUAL',
    sourceId?: string
  ): Promise<Reward> {
    const reward = await this.prisma.reward.create({
      data: {
        userId,
        type: 'NFT_BADGE',
        status: 'PENDING',
        source,
        sourceId,
        nftMetadata: JSON.stringify(metadata),
      },
    });

    // TODO: Integrate with NFT minting service
    // For now, mark as ACTIVE immediately
    // In production, this would be handled by NFTBadgeService
    await this.prisma.reward.update({
      where: { id: reward.id },
      data: { status: 'ACTIVE' },
    });

    return reward;
  }

  /**
   * Retrieves all rewards currently active and not expired for a user.
   * 
   * @param userId - Unique identifier of the user
   * @param type - Optional filter by reward type (e.g., 'FEE_DISCOUNT')
   * @returns Promise resolving to a list of active Reward records
   */
  async getActiveRewards(userId: string, type?: string): Promise<Reward[]> {
    return this.prisma.reward.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        ...(type && { type }),
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { earnedAt: 'desc' },
    });
  }

  /**
   * Marks a reward as 'REDEEMED', indicating it has been used by the user.
   * 
   * @param rewardId - Unique identifier of the reward to redeem
   * @returns Promise resolving when the status is updated
   * @throws {Error} If the reward is not found, not active, or has expired
   */
  async redeemReward(rewardId: string): Promise<void> {
    const reward = await this.prisma.reward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) {
      throw new Error('Reward not found');
    }

    if (reward.status !== 'ACTIVE') {
      throw new Error(`Cannot redeem reward with status: ${reward.status}`);
    }

    if (reward.expiresAt && reward.expiresAt < new Date()) {
      throw new Error('Reward has expired');
    }

    await this.prisma.reward.update({
      where: { id: rewardId },
      data: {
        status: 'REDEEMED',
        redeemedAt: new Date(),
      },
    });
  }

  /**
   * Periodic maintenance task that marks all rewards past their expiration date as 'EXPIRED'.
   * 
   * @returns Promise resolving to the number of rewards updated
   */
  async expireRewards(): Promise<number> {
    const result = await this.prisma.reward.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return result.count;
  }

  /**
   * Calculates the maximum applicable fee discount currently available to a user.
   * 
   * @param userId - Unique identifier of the user
   * @returns Promise resolving to the highest discount percentage found among active rewards
   */
  async getApplicableDiscount(userId: string): Promise<number> {
    const discounts = await this.getActiveRewards(userId, 'FEE_DISCOUNT');

    if (discounts.length === 0) {
      return 0;
    }

    // Return highest discount
    return Math.max(...discounts.map((d) => d.discountPercent || 0));
  }

  /**
   * Utility method to calculate the final fee value after applying a percentage discount.
   * 
   * @param originalFee - The base fee amount before discount
   * @param discountPercent - The discount percentage to apply
   * @returns The final discounted fee amount
   */
  calculateDiscountedFee(originalFee: number, discountPercent: number): number {
    return originalFee * (1 - discountPercent / 100);
  }

  /**
   * Checks if a user has valid, active access to a specific premium feature.
   * 
   * @param userId - Unique identifier of the user
   * @param featureId - Identifier of the premium feature
   * @returns Promise resolving to true if access is currently granted
   */
  async hasPremiumFeatureAccess(userId: string, featureId: string): Promise<boolean> {
    const features = await this.prisma.reward.findMany({
      where: {
        userId,
        type: 'PREMIUM_FEATURE',
        featureId,
        status: 'ACTIVE',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    return features.length > 0;
  }
}
