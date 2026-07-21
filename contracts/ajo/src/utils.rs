use soroban_sdk::{Address, Env, Vec};

use crate::types::{Group, GroupMilestone, GroupTemplate, MemberAchievement, PayoutOrder, PayoutOrderingStrategy, TemplateConfig};
use crate::errors::AjoError;

/// Returns `true` if `address` appears in the group's `members` list.
///
/// Performs a linear scan since Soroban's `Vec` does not support O(1) lookup.
/// For groups capped at 100 members this is acceptable.
///
/// # Arguments
/// * `members` - The ordered member list to search
/// * `address` - The address to look for
///
/// # Returns
/// `true` if the address is found in the members list, `false` otherwise
#[inline]
pub fn is_member(members: &Vec<Address>, address: &Address) -> bool {
    members.iter().any(|m| m == *address)
}

/// Returns `true` if every member of the group has contributed in the current cycle.
///
/// Iterates over all members and short-circuits on the first missing contribution.
/// This is called by [`execute_payout`](crate::contract::AjoContract::execute_payout)
/// to gate payout execution — a payout cannot proceed until this returns `true`.
///
/// # Arguments
/// * `env` - The contract environment (needed for storage reads)
/// * `group` - The group whose current cycle contributions are being verified
///
/// # Returns
/// `true` if all members have contributed, `false` otherwise
#[inline]
pub fn all_members_contributed(env: &Env, group: &Group) -> bool {
    let group_id = group.id;
    let cycle = group.current_cycle;
    
    group.members.iter().all(|member| {
        crate::storage::has_contributed(env, group_id, cycle, &member)
    })
}

/// Calculates the total payout amount for a single cycle.
///
/// The payout equals each member's fixed contribution multiplied by the total
/// number of members. This ensures the recipient receives the full pool of contributions.
///
/// # Arguments
/// * `group` - The group whose payout is being calculated
///
/// # Returns
/// Total payout in stroops (`contribution_amount × member_count`)
#[inline]
pub fn calculate_payout_amount(group: &Group) -> i128 {
    let member_count = group.members.len() as i128;
    group.contribution_amount * member_count
}

/// Returns the current ledger timestamp in seconds since Unix epoch.
///
/// Wraps `env.ledger().timestamp()` for testability and to provide a
/// single consistent source of time across the contract.
///
/// # Arguments
/// * `env` - The contract environment used to access the ledger
///
/// # Returns
/// Current Unix timestamp in seconds
#[inline]
pub fn get_current_timestamp(env: &Env) -> u64 {
    env.ledger().timestamp()
}

/// Validates that group creation parameters meet business rules.
///
/// Called at the start of [`create_group`](crate::contract::AjoContract::create_group)
/// before any state is written. All three parameters are validated together
/// so callers receive a specific error identifying which constraint failed.
///
/// # Arguments
/// * `amount` - Proposed contribution amount in stroops; must be > 0
/// * `duration` - Proposed cycle duration in seconds; must be > 0
/// * `max_members` - Proposed member cap; must be between 2 and 100 inclusive
///
/// # Returns
/// `Ok(())` if all parameters are valid
///
/// # Errors
/// * [`ContributionAmountZero`](crate::errors::AjoError::ContributionAmountZero) — if `amount == 0`
/// * [`ContributionAmountNegative`](crate::errors::AjoError::ContributionAmountNegative) — if `amount < 0`
/// * [`CycleDurationZero`](crate::errors::AjoError::CycleDurationZero) — if `duration == 0`
/// * [`MaxMembersBelowMinimum`](crate::errors::AjoError::MaxMembersBelowMinimum) — if `max_members < 2`
/// * [`MaxMembersAboveLimit`](crate::errors::AjoError::MaxMembersAboveLimit) — if `max_members > 100`
pub fn validate_group_params(
    amount: i128,
    duration: u64,
    max_members: u32,
) -> Result<(), crate::errors::AjoError> {
    const MAX_MEMBERS_LIMIT: u32 = 100;

    // Amounts must be positive

    // Amounts must be positive
    if amount == 0 {
        return Err(crate::errors::AjoError::ContributionAmountZero);
    } else if amount < 0 {
        return Err(crate::errors::AjoError::ContributionAmountNegative);
    }

    // Time stops for no one - especially not a zero duration esusu

    // Time stops for no one - especially not a zero duration esusu
    if duration == 0 {
        return Err(crate::errors::AjoError::CycleDurationZero);
    }

    // We need at least two people to rotate money

    // We need at least two people to rotate money
    if max_members < 2 {
        return Err(crate::errors::AjoError::MaxMembersBelowMinimum);
    }

    // Reasonable upper limit to prevent gas issues

    // Reasonable upper limit to prevent gas issues
    if max_members > MAX_MEMBERS_LIMIT {
        return Err(crate::errors::AjoError::MaxMembersAboveLimit);
    }

    Ok(())
}

/// Validates grace period and penalty rate parameters used when creating a group.
///
/// * `grace_period` - must be <= 7 days (604800 seconds)
/// * `penalty_rate` - must be between 0 and 100 inclusive
pub fn validate_penalty_params(
    grace_period: u64,
    penalty_rate: u32,
) -> Result<(), crate::errors::AjoError> {
    const MAX_GRACE: u64 = 604_800; // 7 days
    if grace_period > MAX_GRACE {
        return Err(crate::errors::AjoError::InvalidGracePeriod);
    }
    if penalty_rate > 100 {
        return Err(crate::errors::AjoError::InvalidPenaltyRate);
    }
    Ok(())
}

/// Returns the unix timestamp (seconds) when the current cycle's grace period ends.
/// Calculated as `cycle_start_time + cycle_duration + grace_period`.
pub fn get_grace_period_end(group: &crate::types::Group) -> u64 {
    group.cycle_start_time + group.cycle_duration + group.grace_period
}

/// Returns `true` if the provided `current_time` falls after the cycle end
/// and before or at the grace period end.
pub fn is_within_grace_period(group: &crate::types::Group, current_time: u64) -> bool {
    let cycle_end = group.cycle_start_time + group.cycle_duration;
    let grace_end = get_grace_period_end(group);
    current_time > cycle_end && current_time <= grace_end
}

// ── Dynamic payout ordering ───────────────────────────────────────────────────

/// Determines and records the next payout recipient according to the group's
/// [`PayoutOrderingStrategy`].
///
/// For [`Sequential`](PayoutOrderingStrategy::Sequential) this reproduces the
/// original join-order behaviour using `group.payout_index` directly.
/// For all other strategies it queries eligible members (those who have not yet
/// received a payout) and applies the relevant selection algorithm.
///
/// The result is committed to persistent storage as a [`PayoutOrder`] and
/// returned so the caller can execute the token transfer immediately.
///
/// # Errors
/// * [`AjoError::NoEligibleMembers`] — all members have already been paid, or
///   the internal members list is empty.
/// * [`AjoError::NoMembers`] — used only for Sequential when `payout_index`
///   points beyond the members list (should never happen in practice).
pub fn determine_next_recipient(env: &Env, group: &Group) -> Result<Address, AjoError> {
    let recipient = preview_next_recipient(env, group)?;

    // Persist the determined order for audit / transparency
    let order = PayoutOrder {
        group_id: group.id,
        cycle: group.current_cycle,
        recipient: recipient.clone(),
        selection_method: group.payout_strategy,
        determined_at: get_current_timestamp(env),
    };
    crate::storage::store_payout_order(env, group.id, group.current_cycle, &order);

    Ok(recipient)
}

/// Computes the next recipient using the group's payout strategy without
/// writing any storage side effects.
pub fn preview_next_recipient(env: &Env, group: &Group) -> Result<Address, AjoError> {
    match group.payout_strategy {
        PayoutOrderingStrategy::Sequential => select_sequential(group),
        PayoutOrderingStrategy::Random => select_random(env, group),
        PayoutOrderingStrategy::VotingBased | PayoutOrderingStrategy::NeedBased => {
            select_by_votes(env, group)
        }
        PayoutOrderingStrategy::ContributionBased => select_by_contribution(env, group),
    }
}

/// Selects the next recipient by join order (current `payout_index`).
fn select_sequential(group: &Group) -> Result<Address, AjoError> {
    group
        .members
        .get(group.payout_index)
        .ok_or(AjoError::NoMembers)
}

/// Selects a random eligible member using ledger sequence and timestamp as
/// entropy.  This is *verifiable* but not unpredictable by validators —
/// acceptable for informal savings groups.
///
/// Entropy is mixed with a 64-bit multiplicative hash constant to improve
/// distribution when the raw seed values are small.
fn select_random(env: &Env, group: &Group) -> Result<Address, AjoError> {
    let eligible = get_eligible_members(env, group)?;
    let len = eligible.len() as u64;

    // Combine ledger sequence and timestamp, then mix bits
    let raw = (env.ledger().sequence() as u64)
        .wrapping_add(env.ledger().timestamp())
        .wrapping_mul(0x9e3779b97f4a7c15_u64); // Fibonacci-hashing constant
    let index = (raw % len) as u32;

    eligible.get(index).ok_or(AjoError::NoEligibleMembers)
}

/// Selects the eligible member who received the most votes this cycle.
/// In the event of a tie the candidate who appears first in `group.members`
/// wins (deterministic tiebreaker).  If no votes have been cast the
/// function falls back to the first eligible member in join order so that a
/// payout can always be executed.
fn select_by_votes(env: &Env, group: &Group) -> Result<Address, AjoError> {
    let eligible = get_eligible_members(env, group)?;

    let mut best: Option<Address> = None;
    let mut best_count: u32 = 0;

    // Iterate over eligible candidates and count votes in O(n²).
    // Acceptable for groups capped at 100 members.
    for candidate in eligible.iter() {
        let mut count: u32 = 0;
        for voter in group.members.iter() {
            if let Some(vote) =
                crate::storage::get_payout_vote(env, group.id, group.current_cycle, &voter)
            {
                if vote.nominee == candidate {
                    count += 1;
                }
            }
        }
        // Strict greater-than preserves first-encountered candidate on ties.
        if count > best_count {
            best_count = count;
            best = Some(candidate);
        }
    }

    // Fall back to first eligible member when nobody has voted yet.
    best.or_else(|| eligible.get(0)).ok_or(AjoError::NoEligibleMembers)
}

/// Selects the eligible member with the highest reliability score
/// (fewest late payments).  In the event of a tie the member who appears
/// first in `group.members` wins.
fn select_by_contribution(env: &Env, group: &Group) -> Result<Address, AjoError> {
    let eligible = get_eligible_members(env, group)?;

    let mut best: Option<Address> = None;
    let mut best_score: u32 = 0;

    for member in eligible.iter() {
        let score = crate::storage::get_member_penalty(env, group.id, &member)
            .map(|r| r.reliability_score)
            .unwrap_or(100_u32); // 100 = perfect — no penalty record yet

        // Strict greater-than: first member wins ties (preserves join-order fairness).
        if score > best_score || best.is_none() {
            best_score = score;
            best = Some(member);
        }
    }

    best.ok_or(AjoError::NoEligibleMembers)
}

/// Returns the subset of group members who have **not** yet received a payout.
///
/// Preserves the original join order of `group.members`.
fn get_eligible_members(env: &Env, group: &Group) -> Result<Vec<Address>, AjoError> {
    let mut eligible = Vec::new(env);
    for member in group.members.iter() {
        if !crate::storage::has_received_payout(env, group.id, &member) {
            eligible.push_back(member);
        }
    }
    if eligible.is_empty() {
        return Err(AjoError::NoEligibleMembers);
    }
    Ok(eligible)
}

// ── Milestone & achievement detection ─────────────────────────────────────

/// Checks which group milestones have been newly achieved based on group state.
pub fn check_group_milestones(env: &Env, group: &Group) -> Vec<GroupMilestone> {
    let mut milestones = Vec::new(env);

    let total_cycles = group.members.len() as u32;
    let completed_cycles = group.payout_index;

    // First payout
    if completed_cycles == 1 {
        milestones.push_back(GroupMilestone::FirstPayout);
    }

    // Halfway complete
    if total_cycles >= 2 && completed_cycles == total_cycles / 2 {
        milestones.push_back(GroupMilestone::HalfwayComplete);
    }

    // Three quarters complete
    if total_cycles >= 4 && completed_cycles == (total_cycles * 3) / 4 {
        milestones.push_back(GroupMilestone::ThreeQuartersComplete);
    }

    // Fully completed
    if group.is_complete {
        milestones.push_back(GroupMilestone::FullyCompleted);

        // Check for perfect attendance (all members on-time every cycle)
        if check_perfect_attendance(env, group) {
            milestones.push_back(GroupMilestone::PerfectAttendance);
        }

        // Check for zero penalties
        if check_zero_penalties(env, group) {
            milestones.push_back(GroupMilestone::ZeroPenalties);
        }
    }

    milestones
}

/// Returns true if all members contributed on time every cycle (no late contributions).
fn check_perfect_attendance(env: &Env, group: &Group) -> bool {
    for member in group.members.iter() {
        if let Some(penalty) = crate::storage::get_member_penalty(env, group.id, &member) {
            if penalty.late_count > 0 {
                return false;
            }
        }
    }
    true
}

/// Returns true if no penalties were incurred across all cycles.
fn check_zero_penalties(env: &Env, group: &Group) -> bool {
    let total_cycles = group.members.len() as u32;
    for cycle in 1..=total_cycles {
        let pool = crate::storage::get_cycle_penalty_pool(env, group.id, cycle);
        if pool > 0 {
            return false;
        }
    }
    true
}

/// Checks which member achievements have been newly earned.
pub fn check_member_achievements(
    env: &Env,
    _member: &Address,
    stats: &crate::types::MemberStats,
) -> Vec<MemberAchievement> {
    let mut achievements = Vec::new(env);

    // First contribution
    if stats.total_contributions == 1 {
        achievements.push_back(MemberAchievement::FirstContribution);
    }

    // Reliable (95%+ on-time rate)
    if stats.total_contributions >= 5 {
        let on_time_rate = (stats.on_time_contributions * 100) / stats.total_contributions;
        if on_time_rate >= 95 {
            achievements.push_back(MemberAchievement::Reliable);
        }
    }

    // Veteran (5+ completed groups)
    if stats.total_groups_completed >= 5 {
        achievements.push_back(MemberAchievement::Veteran);
    }

    // High roller (1M+ XLM = 10^13 stroops contributed)
    if stats.total_amount_contributed >= 10_000_000_000_000 {
        achievements.push_back(MemberAchievement::HighRoller);
    }

    // Perfect attendance check (no late contributions ever)
    if stats.total_contributions >= 10 && stats.late_contributions == 0 {
        achievements.push_back(MemberAchievement::PerfectAttendance);
    }

    achievements
}

/// Initializes default MemberStats for a new member.
pub fn default_member_stats(env: &Env, member: &Address) -> crate::types::MemberStats {
    crate::types::MemberStats {
        member: member.clone(),
        total_groups_joined: 0,
        total_groups_completed: 0,
        total_contributions: 0,
        on_time_contributions: 0,
        late_contributions: 0,
        qualifying_contributions: 0,
        qualifying_on_time_contributions: 0,
        qualifying_groups_completed: 0,
        qualifying_amount_contributed: 0,
        total_amount_contributed: 0,
        achievements: Vec::new(env),
    }
}

// ── Multi-token helpers ───────────────────────────────────────────────────

/// Validates an accepted-token list for multi-token group creation.
///
/// Checks:
/// 1. List is non-empty
/// 2. List does not exceed [`MAX_ACCEPTED_TOKENS`]
/// 3. Every weight is > 0
/// 4. No duplicate token addresses
pub fn validate_token_list(
    _env: &Env,
    tokens: &Vec<crate::types::TokenConfig>,
) -> Result<(), AjoError> {
    use crate::types::MAX_ACCEPTED_TOKENS;

    if tokens.is_empty() {
        return Err(AjoError::InvalidMultiTokenConfig);
    }
    if tokens.len() > MAX_ACCEPTED_TOKENS {
        return Err(AjoError::InvalidMultiTokenConfig);
    }

    // Validate weights and check for duplicates with an O(n²) scan.
    // Acceptable because MAX_ACCEPTED_TOKENS is small (10).
    let len = tokens.len();
    for i in 0..len {
        let tc = tokens.get(i).unwrap();
        if tc.weight == 0 {
            return Err(AjoError::InvalidMultiTokenConfig);
        }
        for j in (i + 1)..len {
            let other = tokens.get(j).unwrap();
            if tc.address == other.address {
                return Err(AjoError::InvalidMultiTokenConfig);
            }
        }
    }

    Ok(())
}

/// Locates a token in the multi-token config and returns its config plus the
/// primary token's weight (needed for equivalence calculation).
///
/// # Returns
/// `(matched_token_config, primary_weight)`
///
/// # Errors
/// * `TokenNotAccepted` – the address is not in the accepted list
pub fn find_token_config(
    config: &crate::types::MultiTokenConfig,
    token_address: &Address,
) -> Result<(crate::types::TokenConfig, u32), AjoError> {
    let primary_weight = config.accepted_tokens.get(0).unwrap().weight;

    for i in 0..config.accepted_tokens.len() {
        let tc = config.accepted_tokens.get(i).unwrap();
        if tc.address == *token_address {
            return Ok((tc, primary_weight));
        }
    }

    Err(AjoError::TokenNotAccepted)
}

/// Calculates the equivalent contribution amount in a secondary token.
///
/// Formula: `base_amount × primary_weight / token_weight`
///
/// If the member contributes in the primary token (`token_weight ==
/// primary_weight`) the result equals `base_amount` exactly.
pub fn calculate_equivalent_amount(
    base_amount: i128,
    primary_weight: u32,
    token_weight: u32,
) -> i128 {
    (base_amount * (primary_weight as i128)) / (token_weight as i128)
}

/// Returns `true` if `address` is either the complainant or defendant in a dispute.
pub fn is_dispute_member(dispute: &crate::types::Dispute, address: &Address) -> bool {
    dispute.complainant == *address || dispute.defendant == *address
}

// ── Group templates ───────────────────────────────────────────────────────

/// Returns the pre-configured [`TemplateConfig`] for the given [`GroupTemplate`].
///
/// All duration values are in seconds; all amounts are in stroops
/// (1 XLM = 10_000_000 stroops).
pub fn get_template_config(template: GroupTemplate) -> TemplateConfig {
    match template {
        GroupTemplate::MonthlySavings => TemplateConfig {
            template_type: GroupTemplate::MonthlySavings,
            default_cycle_duration: 2_592_000,       // 30 days
            default_grace_period: 86_400,             // 1 day
            default_penalty_rate: 5,
            suggested_contribution_min: 10_000_000,   // 1 XLM
            suggested_contribution_max: 1_000_000_000, // 100 XLM
            suggested_max_members: 12,
        },
        GroupTemplate::WeeklySavings => TemplateConfig {
            template_type: GroupTemplate::WeeklySavings,
            default_cycle_duration: 604_800,          // 7 days
            default_grace_period: 43_200,             // 12 hours
            default_penalty_rate: 10,
            suggested_contribution_min: 1_000_000,    // 0.1 XLM
            suggested_contribution_max: 100_000_000,  // 10 XLM
            suggested_max_members: 10,
        },
        GroupTemplate::EmergencyFund => TemplateConfig {
            template_type: GroupTemplate::EmergencyFund,
            default_cycle_duration: 1_209_600,        // 14 days
            default_grace_period: 172_800,            // 2 days
            default_penalty_rate: 3,
            suggested_contribution_min: 50_000_000,   // 5 XLM
            suggested_contribution_max: 5_000_000_000, // 500 XLM
            suggested_max_members: 8,
        },
        GroupTemplate::InvestmentClub => TemplateConfig {
            template_type: GroupTemplate::InvestmentClub,
            default_cycle_duration: 7_776_000,         // 90 days
            default_grace_period: 604_800,             // 7 days
            default_penalty_rate: 2,
            suggested_contribution_min: 100_000_000,   // 10 XLM
            suggested_contribution_max: 10_000_000_000, // 1000 XLM
            suggested_max_members: 20,
        },
        GroupTemplate::Custom => TemplateConfig {
            template_type: GroupTemplate::Custom,
            default_cycle_duration: 2_592_000,
            default_grace_period: 86_400,
            default_penalty_rate: 5,
            suggested_contribution_min: 1_000_000,
            suggested_contribution_max: 10_000_000_000,
            suggested_max_members: 50,
        },
    }
}
