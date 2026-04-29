export type HealthRating = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface GroupHealthInput {
  totalMembers: number;
  activeMembers: number;
  /** Contributions made on time in the last cycle */
  onTimeContributions: number;
  /** Total contributions expected in the last cycle */
  expectedContributions: number;
  /** Number of missed payments across all members */
  missedPayments: number;
  /** Number of completed payout cycles */
  completedCycles: number;
  /** Number of total planned cycles */
  totalCycles: number;
  /** Number of disputes filed */
  disputes: number;
}

export interface GroupHealthScore {
  score: number; // 0–100
  rating: HealthRating;
  breakdown: {
    contributionRate: number;
    memberActivity: number;
    payoutProgress: number;
    penaltyImpact: number;
  };
  warnings: string[];
}

export function calculateGroupHealth(input: GroupHealthInput): GroupHealthScore {
  const {
    totalMembers,
    activeMembers,
    onTimeContributions,
    expectedContributions,
    missedPayments,
    completedCycles,
    totalCycles,
    disputes,
  } = input;

  // Contribution rate (0–100)
  const contributionRate =
    expectedContributions > 0
      ? Math.round((onTimeContributions / expectedContributions) * 100)
      : 100;

  // Member activity (0–100)
  const memberActivity =
    totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 100;

  // Payout progress (0–100)
  const payoutProgress =
    totalCycles > 0 ? Math.round((completedCycles / totalCycles) * 100) : 0;

  // Penalty impact: deduct 5 per missed payment, 10 per dispute, floor 0
  const penaltyDeduction = missedPayments * 5 + disputes * 10;
  const penaltyImpact = Math.max(0, 100 - penaltyDeduction);

  // Weighted composite score
  const score = Math.round(
    contributionRate * 0.4 +
      memberActivity * 0.25 +
      payoutProgress * 0.2 +
      penaltyImpact * 0.15
  );

  const rating: HealthRating =
    score >= 85
      ? 'excellent'
      : score >= 70
      ? 'good'
      : score >= 50
      ? 'fair'
      : score >= 30
      ? 'poor'
      : 'critical';

  const warnings: string[] = [];
  if (contributionRate < 70) warnings.push('Low contribution rate — risk of group failure');
  if (memberActivity < 60) warnings.push('High member inactivity detected');
  if (missedPayments > 2) warnings.push(`${missedPayments} missed payments this cycle`);
  if (disputes > 0) warnings.push(`${disputes} active dispute(s) affecting group health`);

  return {
    score,
    rating,
    breakdown: { contributionRate, memberActivity, payoutProgress, penaltyImpact },
    warnings,
  };
}
