use soroban_sdk::{contracttype, Address, BytesN, Vec};

/// Strategy for determining payout order in a group.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PayoutOrderingStrategy {
    /// Members receive payouts in the order they joined (default).
    Sequential = 0,
    /// Verifiable random selection using ledger sequence and timestamp as entropy.
    Random = 1,
    /// Members vote each cycle; the nominee with the most votes receives payout.
    VotingBased = 2,
    /// Member with the best on-time contribution history is selected.
    ContributionBased = 3,
    /// Members vote on declared need; most-voted member receives payout.
    NeedBased = 4,
}

/// A single vote cast for the next payout recipient.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutVote {
    /// The group this vote belongs to.
    pub group_id: u64,
    /// The cycle number this vote applies to.
    pub cycle: u32,
    /// Address of the member casting the vote.
    pub voter: Address,
    /// Address nominated to receive the next payout.
    pub nominee: Address,
    /// Unix timestamp when the vote was cast.
    pub timestamp: u64,
}

/// Records the determined payout order for a specific cycle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutOrder {
    /// The group this payout order belongs to.
    pub group_id: u64,
    /// The cycle number this order applies to.
    pub cycle: u32,
    /// The address that will receive the payout.
    pub recipient: Address,
    /// The strategy used to select this recipient.
    pub selection_method: PayoutOrderingStrategy,
    /// Unix timestamp when the order was determined.
    pub determined_at: u64,
}

/// State of a group in its lifecycle.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GroupState {
    /// Group is active and accepting contributions.
    Active = 0,
    /// Group has been cancelled and refunds are being processed.
    Cancelled = 1,
    /// Group has completed all cycles successfully.
    Complete = 2,
}

/// Represents an Ajo group configuration and state.
///
/// An Ajo (also known as Esusu or Tontine) is a rotating savings group
/// where members contribute a fixed amount each cycle, and one member
/// receives the full pool each round until everyone has been paid out.
///
/// Fields are ordered by size for optimal memory alignment:
/// - 16 bytes: i128
/// - 32 bytes: Address
/// - Variable: Vec<Address>
/// - 8 bytes: u64 fields
/// - 4 bytes: u32 fields
/// - 1 byte: bool
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Group {
    /// Fixed contribution amount each member must pay per cycle, denominated in stroops.
    /// 1 XLM = 10,000,000 stroops.
    pub contribution_amount: i128,

    /// Address of the member who created the group.
    /// Automatically added as the first member on creation.
    pub creator: Address,

    /// Token contract address for contributions and payouts.
    /// Supports Stellar Asset Contract (SAC) tokens including XLM, USDC, and custom tokens.
    pub token_address: Address,

    /// Ordered list of member addresses.
    /// Members receive payouts in the order they appear in this list.
    pub members: Vec<Address>,

    /// Unique group identifier, auto-incremented from storage counter
    pub id: u64,

    /// Duration of each cycle in seconds.
    /// When a cycle ends, the next payout can be triggered.
    pub cycle_duration: u64,

    /// Unix timestamp (seconds) when the group was created.
    pub created_at: u64,

    /// Unix timestamp (seconds) when the current cycle started.
    /// Used together with `cycle_duration` to calculate when the cycle ends.
    pub cycle_start_time: u64,

    /// Maximum number of members allowed in the group.
    /// Must be between 2 and 100 (inclusive).
    pub max_members: u32,

    /// Current cycle number, starts at 1 and increments after each payout.
    pub current_cycle: u32,

    /// Zero-based index into `members` indicating who receives the next payout.
    /// When `payout_index == members.len()`, the group is complete.
    pub payout_index: u32,

    /// Whether the group has completed all payout cycles.
    /// Once `true`, no further contributions or payouts are accepted.
    pub is_complete: bool,

    /// Grace period duration in seconds after cycle ends.
    /// Members can still contribute during this period but will incur penalties.
    /// Default: 86400 seconds (24 hours)
    pub grace_period: u64,

    /// Penalty rate as a percentage (0-100) applied to late contributions.
    /// For example, 5 means 5% penalty on the contribution amount.
    /// Penalties are added to the group pool for the next recipient.
    pub penalty_rate: u32,

    /// Current state of the group (Active, Cancelled, or Complete).
    pub state: GroupState,

    /// Insurance configuration for the group.
    pub insurance_config: InsuranceConfig,

    /// Strategy used to determine payout order each cycle.
    /// Defaults to `Sequential` (join order) when created via `create_group`.
    pub payout_strategy: PayoutOrderingStrategy,

    /// Access control type for the group.
    /// Defaults to `Open` when created via `create_group`.
    pub access_type: GroupAccessType,
}

/// Comprehensive snapshot of a group's current state.
///
/// Returned by [`crate::contract::AjoContract::get_group_status`] to give callers a single
/// consolidated view without having to make multiple queries.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GroupStatus {
    /// The unique identifier of the group being described.
    pub group_id: u64,

    /// Current cycle number (1-based). Increments after each successful payout.
    pub current_cycle: u32,

    /// `true` if there is a valid next recipient (i.e., the group is not yet complete).
    /// When `false`, `next_recipient` is a placeholder and should be ignored.
    pub has_next_recipient: bool,

    /// Address of the member scheduled to receive the next payout.
    /// Only meaningful when `has_next_recipient` is `true`.
    pub next_recipient: Address,

    /// Number of members who have already contributed in the current cycle.
    pub contributions_received: u32,

    /// Total number of members currently in the group.
    pub total_members: u32,

    /// Addresses of members who have not yet contributed in the current cycle.
    pub pending_contributors: Vec<Address>,

    /// Whether the group has finished all cycles and is closed.
    pub is_complete: bool,

    /// Whether the current cycle window is still open for contributions.
    /// `false` means the cycle has expired and a payout can be triggered.
    pub is_cycle_active: bool,

    /// Unix timestamp (seconds) when the current cycle started.
    pub cycle_start_time: u64,

    /// Unix timestamp (seconds) when the current cycle ends (`cycle_start_time + cycle_duration`).
    pub cycle_end_time: u64,

    /// The ledger timestamp at the moment this status was queried.
    pub current_time: u64,

    /// Total penalties collected in the current cycle (in stroops).
    pub cycle_penalty_pool: i128,

    /// Whether the cycle is in grace period (after cycle end but before grace period expires).
    pub is_in_grace_period: bool,

    /// Unix timestamp when grace period ends.
    pub grace_period_end_time: u64,
}

/// Optional metadata for a group.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GroupMetadata {
    /// Name of the group.
    pub name: soroban_sdk::String,
    /// Description of the group purpose or goal.
    pub description: soroban_sdk::String,
    /// Custom rules or guidelines for members.
    pub rules: soroban_sdk::String,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DisputeType {
    NonPayment = 0,        // Member not contributing
    FraudulentClaim = 1,   // False insurance claim
    RuleViolation = 2,     // Breaking group rules
    PayoutDispute = 3,     // Disagreement on payout
    Other = 4,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DisputeStatus {
    Open = 0,
    UnderReview = 1,
    Voting = 2,
    Resolved = 3,
    Rejected = 4,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DisputeResolution {
    NoAction = 0,
    Warning = 1,
    Penalty = 2,
    Removal = 3,
    Refund = 4,
    GroupCancellation = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub id: u64,
    pub group_id: u64,
    pub dispute_type: DisputeType,
    pub complainant: Address,
    pub defendant: Address,
    pub description: soroban_sdk::String,
    pub evidence_hash: BytesN<32>, // Hash of off-chain evidence
    pub status: DisputeStatus,
    pub created_at: u64,
    pub voting_deadline: u64,
    pub votes_for_action: u32,
    pub votes_against_action: u32,
    pub proposed_resolution: DisputeResolution,
    pub final_resolution: Option<DisputeResolution>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeVote {
    pub dispute_id: u64,
    pub voter: Address,
    pub supports_action: bool,
    pub timestamp: u64,
}

pub const MAX_NAME_LENGTH: u32 = 50;
pub const MAX_DESCRIPTION_LENGTH: u32 = 250;
pub const MAX_RULES_LENGTH: u32 = 1000;
pub const VOTING_PERIOD: u64 = 604_800;
pub const DISPUTE_VOTING_PERIOD: u64 = 604_800; // 7 days for disputes
pub const REFUND_APPROVAL_THRESHOLD: u32 = 51;
pub const DISPUTE_APPROVAL_THRESHOLD: u32 = 66;

/// Tracks a refund request initiated by a member.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundRequest {
    /// The group this refund request is for.
    pub group_id: u64,

    /// Address of the member who initiated the request.
    pub requester: Address,

    /// Unix timestamp when the request was created.
    pub created_at: u64,

    /// Unix timestamp when voting ends.
    pub voting_deadline: u64,

    /// Number of votes in favor of the refund.
    pub votes_for: u32,

    /// Number of votes against the refund.
    pub votes_against: u32,

    /// Whether the request has been executed.
    pub executed: bool,

    /// Whether the request was approved.
    pub approved: bool,
}

/// Records a member's vote on a refund request.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundVote {
    /// The group this vote is for.
    pub group_id: u64,

    /// Address of the member who voted.
    pub voter: Address,

    /// Whether the vote is in favor (true) or against (false).
    pub in_favor: bool,

    /// Unix timestamp when the vote was cast.
    pub timestamp: u64,
}

/// Penalty statistics for a member within a group.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberPenaltyRecord {
    pub member: Address,
    pub group_id: u64,
    pub late_count: u32,
    pub on_time_count: u32,
    pub total_penalties: i128,
    pub reliability_score: u32,
}

/// Records a refund transaction.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundRecord {
    /// The group this refund is for.
    pub group_id: u64,

    /// Address of the member receiving the refund.
    pub member: Address,

    /// Amount refunded in stroops.
    pub amount: i128,

    /// Unix timestamp when the refund was processed.
    pub timestamp: u64,

    /// Reason for the refund (cancellation, emergency, vote).
    pub reason: RefundReason,
}

/// Reason for a refund.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RefundReason {
    /// Group was cancelled by creator before first payout.
    CreatorCancellation = 0,
    /// Refund approved by member vote.
    MemberVote = 1,
    /// Emergency refund by admin.
    EmergencyRefund = 2,
    /// Dispute resolution refund.
    DisputeRefund = 3,
}

/// Detailed record of a member's contribution for a specific cycle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionRecord {
    pub group_id: u64,
    pub cycle: u32,
    pub member: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub is_late: bool,
    pub penalty_amount: i128,
}


/// Records that a member has received their payout for a given cycle.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutRecord {
    pub group_id: u64,
    pub member: Address,
    pub amount: i128,
    pub timestamp: u64,
}

/// Insurance configuration for a group.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InsuranceConfig {
    /// Insurance rate in basis points (1 bp = 0.01%).
    /// A value of 100 means 1% of each contribution goes to the insurance pool.
    pub rate_bps: u32,
    /// Whether insurance is enabled for this group.
    pub is_enabled: bool,
}

/// Status of an insurance claim.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ClaimStatus {
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Paid = 3,
}

/// Information about an insurance claim filed for non-payment.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InsuranceClaim {
    /// The unique identifier for the claim.
    pub id: u64,
    /// The group the claim belongs to.
    pub group_id: u64,
    /// The cycle in which the default occurred.
    pub cycle: u32,
    /// The member who defaulted (did not pay).
    pub defaulter: Address,
    /// The member who is filing the claim (usually the cycle's recipient).
    pub claimant: Address,
    /// The amount being claimed.
    pub amount: i128,
    /// The current status of the claim.
    pub status: ClaimStatus,
    /// Unix timestamp when the claim was filed.
    pub created_at: u64,
}

/// Insurance fund balance tracking.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InsurancePool {
    /// Total balance available in the insurance pool for a specific token.
    pub balance: i128,
    /// Total amount paid out from the pool.
    pub total_payouts: i128,
    /// Total amount of claims filed.
    pub pending_claims_count: u32,
}

/// Classification of contribution reminders sent to members.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReminderType {
    /// Cycle is about to start; heads-up to prepare funds.
    CycleStarting = 0,
    /// Contribution deadline is approaching within the member's threshold.
    ContributionDue = 1,
    /// Cycle ended but member is still within the grace period.
    GracePeriod = 2,
    /// Past the grace period — contribution is overdue.
    Overdue = 3,
}

/// Per-member notification preferences stored on-chain.
///
/// Members opt-in to reminders by calling `set_notification_preferences`.
/// Off-chain services listen for reminder events and deliver notifications
/// according to these preferences.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberNotificationPreferences {
    /// The member these preferences belong to.
    pub member: Address,
    /// Master toggle — when `false`, no reminders are emitted for this member.
    pub enabled: bool,
    /// How many hours before the cycle deadline a `ContributionDue` reminder fires.
    pub reminder_hours_before: u64,
    /// Whether to send reminders during the grace period.
    pub grace_period_reminders: bool,
    /// Whether to notify the member about payout events.
    pub payout_notifications: bool,
}

/// On-chain record of a reminder that was triggered for a member.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReminderRecord {
    /// The group this reminder pertains to.
    pub group_id: u64,
    /// The cycle at the time the reminder was triggered.
    pub cycle: u32,
    /// The member who was reminded.
    pub member: Address,
    /// The kind of reminder that fired.
    pub reminder_type: ReminderType,
    /// Ledger timestamp when the reminder was created.
    pub triggered_at: u64,
    /// The contribution deadline the reminder relates to.
    pub deadline: u64,
}/// Group-level milestones that track progress through the savings cycle.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GroupMilestone {
    FirstPayout = 0,
    HalfwayComplete = 1,
    ThreeQuartersComplete = 2,
    FullyCompleted = 3,
    PerfectAttendance = 4,
    ZeroPenalties = 5,
}

/// Individual member achievements earned through participation.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MemberAchievement {
    FirstContribution = 0,
    PerfectAttendance = 1,
    EarlyBird = 2,
    Reliable = 3,
    Veteran = 4,
    HighRoller = 5,
}

/// Records a group milestone with context.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneRecord {
    pub group_id: u64,
    pub milestone: GroupMilestone,
    pub achieved_at: u64,
    pub cycle_number: u32,
}

/// Records a member achievement with context.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AchievementRecord {
    pub member: Address,
    pub achievement: MemberAchievement,
    pub earned_at: u64,
    pub group_id: u64,
}

/// Aggregated statistics for a member across all groups.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberStats {
    pub member: Address,
    pub total_groups_joined: u32,
    pub total_groups_completed: u32,
    pub total_contributions: u32,
    pub on_time_contributions: u32,
    pub late_contributions: u32,
    pub total_amount_contributed: i128,
    /// Contributions made in cycles where the group's per-cycle contribution
    /// amount met [`crate::reputation::MIN_REPUTATION_STAKE`]. Only these
    /// count toward the credit score's reliability/completion/volume
    /// components, so cheap dust-amount groups can't inflate a score.
    pub qualifying_contributions: u32,
    pub qualifying_on_time_contributions: u32,
    pub qualifying_groups_completed: u32,
    pub qualifying_amount_contributed: i128,
    pub achievements: Vec<MemberAchievement>,
}

// ── Group access control ──────────────────────────────────────────────────

/// Controls how new members can join a group.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GroupAccessType {
    /// Anyone can join directly.
    Open = 0,
    /// Members must be invited by the creator.
    InviteOnly = 1,
    /// Members must request access and be approved by the creator.
    ApprovalRequired = 2,
}

/// An invitation for a member to join an invite-only group.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GroupInvitation {
    pub group_id: u64,
    pub invitee: Address,
    pub invited_by: Address,
    pub created_at: u64,
    pub expires_at: u64,
    pub accepted: bool,
}

/// A request from a member to join an approval-required group.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JoinRequest {
    pub group_id: u64,
    pub requester: Address,
    pub created_at: u64,
    pub approved: bool,
}

// ── Multi-token support ───────────────────────────────────────────────────

/// Configuration for an accepted token within a multi-token group.
///
/// The `weight` field establishes relative value between tokens.  For example,
/// if USDC has weight 100 and XLM has weight 10, one USDC unit is treated as
/// equivalent to 10 XLM units when calculating contribution equivalence.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenConfig {
    /// Address of the token contract (SAC).
    pub address: Address,
    /// Relative weight used for equivalence calculations.
    /// Higher weight means each unit of this token satisfies more of the
    /// base contribution requirement.  Must be > 0.
    pub weight: u32,
}

/// Stored per group to track which tokens are accepted and their weights.
///
/// For single-token groups created via `create_group`, this record is **not**
/// stored — those groups continue to use the `Group.token_address` field
/// directly, preserving full backward compatibility.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiTokenConfig {
    /// The group this configuration belongs to.
    pub group_id: u64,
    /// Ordered list of accepted tokens with their weights.
    /// The first entry is considered the *primary* token and its weight is
    /// the baseline for equivalence calculations.
    pub accepted_tokens: Vec<TokenConfig>,
}

/// Records a member's token-specific contribution for a cycle.
///
/// This is stored alongside the normal contribution flag so existing
/// contribution queries remain unaffected.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenContribution {
    /// The contributing member's address.
    pub member: Address,
    /// The token used for this contribution.
    pub token: Address,
    /// The raw amount transferred (in the token's native units).
    pub amount: i128,
    /// The cycle this contribution belongs to.
    pub cycle: u32,
}

/// Maximum number of distinct tokens a multi-token group can accept.
pub const MAX_ACCEPTED_TOKENS: u32 = 10;

// ── Group templates ───────────────────────────────────────────────────────

/// Predefined group templates for common savings use cases.
///
/// Each variant maps to a [`TemplateConfig`] with sensible defaults that
/// callers can override when creating a group via
/// [`AjoContract::create_group_from_template`].
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GroupTemplate {
    /// 30-day cycles, moderate contribution amounts, up to 12 members.
    MonthlySavings = 0,
    /// 7-day cycles, smaller contribution amounts, up to 10 members.
    WeeklySavings = 1,
    /// 14-day cycles, higher contribution amounts, lower penalty rate.
    EmergencyFund = 2,
    /// 90-day cycles, larger contribution amounts, up to 20 members.
    InvestmentClub = 3,
    /// Fully customizable — no opinionated defaults beyond the minimums.
    Custom = 4,
}

/// Pre-configured defaults and suggested ranges for a [`GroupTemplate`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemplateConfig {
    /// The template this config belongs to.
    pub template_type: GroupTemplate,
    /// Default cycle duration in seconds.
    pub default_cycle_duration: u64,
    /// Default grace period in seconds.
    pub default_grace_period: u64,
    /// Default penalty rate as a percentage (0–100).
    pub default_penalty_rate: u32,
    /// Suggested minimum contribution amount in stroops.
    pub suggested_contribution_min: i128,
    /// Suggested maximum contribution amount in stroops.
    pub suggested_contribution_max: i128,
    /// Suggested maximum number of members.
    pub suggested_max_members: u32,
}

// ── Reputation system ─────────────────────────────────────────────────────

/// Reputation tier derived from a member's credit score.
///
/// Tiers are used for access control (e.g. InviteOnly groups can require
/// a minimum tier) and for UI display purposes.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationTier {
    /// No contribution history yet (score 0–199).
    Unrated = 0,
    /// Beginner member with limited history (score 200–399).
    Bronze = 1,
    /// Established member with decent track record (score 400–599).
    Silver = 2,
    /// Reliable member with strong history (score 600–799).
    Gold = 3,
    /// Highly trusted member (score 800–899).
    Platinum = 4,
    /// Elite member with near-perfect record (score 900–1000).
    Diamond = 5,
}

/// Reason a credit score snapshot was recorded.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ScoreChangeReason {
    /// Score recalculated after a contribution was made.
    ContributionMade = 0,
    /// Score recalculated after a payout was received.
    PayoutReceived = 1,
    /// Score recalculated after a group was completed.
    GroupCompleted = 2,
    /// Score recalculated after a late contribution.
    LateContribution = 3,
    /// Score recalculated after a penalty was applied.
    PenaltyApplied = 4,
}

/// Aggregated on-chain reputation record for a member.
///
/// Stored in persistent storage keyed by member address.
/// Updated automatically after every contribution, payout, and group completion.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationScore {
    /// The member this record belongs to.
    pub member: Address,

    /// Composite credit score in the range 0–1000.
    /// Higher is better.
    pub credit_score: u32,

    /// Derived tier based on `credit_score`.
    pub tier: ReputationTier,

    /// Total number of on-time contributions across all groups.
    pub total_on_time_payments: u32,

    /// Total number of late contributions (within grace period).
    pub total_late_payments: u32,

    /// Total number of missed contributions (past grace period, future use).
    pub total_missed_payments: u32,

    /// Number of groups the member has fully completed.
    pub groups_completed: u32,

    /// Number of groups the member has ever joined.
    pub groups_joined: u32,

    /// Cumulative amount contributed across all groups (in stroops).
    pub total_amount_contributed: i128,

    /// Unix timestamp of the last reputation update.
    pub last_updated: u64,

    /// Unix timestamp of the member's first recorded activity.
    pub first_activity_at: u64,
}

/// A point-in-time snapshot of a member's credit score.
///
/// Appended to the member's score history on every recalculation.
/// Provides an auditable trail of score changes over time.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreditScoreSnapshot {
    /// The credit score at the time of this snapshot.
    pub score: u32,
    /// Unix timestamp when this snapshot was recorded.
    pub recorded_at: u64,
    /// The event that triggered this recalculation.
    pub reason: ScoreChangeReason,
}

/// A single entry in a member's payment history.
///
/// Recorded for every contribution and payout event.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentHistoryEntry {
    /// The group this payment belongs to.
    pub group_id: u64,
    /// The cycle number this payment was made in.
    pub cycle: u32,
    /// Amount in stroops (contribution or payout).
    pub amount: i128,
    /// Unix timestamp of the payment.
    pub timestamp: u64,
    /// Whether this contribution was made after the cycle deadline (late).
    pub is_late: bool,
    /// Whether this entry records a payout received (vs. a contribution made).
    pub is_payout: bool,
}

/// Maximum number of credit score snapshots retained per member.
/// Older entries are dropped when the cap is reached (FIFO).
pub const MAX_SCORE_HISTORY: u32 = 50;

/// Maximum number of payment history entries retained per member.
pub const MAX_PAYMENT_HISTORY: u32 = 100;
