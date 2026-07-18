use soroban_sdk::contracterror;

/// Error codes for the Ajo contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AjoError {
    /// The specified group wasn't found in storage.
    GroupNotFound = 1,

    /// Can't join because the group is already at its member limit.
    MaxMembersExceeded = 2,

    /// This account is already part of the group.
    AlreadyMember = 3,

    /// Address isn't a member of the group.
    NotMember = 4,

    /// You've already made your contribution for this cycle.
    AlreadyContributed = 5,

    /// We can't move forward until everyone has contributed.
    IncompleteContributions = 6,

    /// Member has already been paid out.
    AlreadyReceivedPayout = 7,

    /// All cycles for this group are finished.
    GroupComplete = 8,

    /// Contribution amount can't be zero.
    ContributionAmountZero = 9,

    /// Cycle duration must be greater than zero.
    CycleDurationZero = 10,

    /// Groups need at least 2 members to work.
    MaxMembersBelowMinimum = 11,

    /// Max members exceeds reasonable limit.
    MaxMembersAboveLimit = 18,

    /// Member doesn't have enough balance.
    InsufficientBalance = 12,

    /// The token transfer didn't go through.
    TransferFailed = 13,

    /// This group has no members initialized.
    NoMembers = 14,

    /// Only the creator or authorized members can do this.
    Unauthorized = 15,

    /// Contribution outside active cycle window
    OutsideCycleWindow = 16,

    /// Negative amounts aren't allowed for contributions.
    ContributionAmountNegative = 17,

    /// This group has been cancelled by its creator.
    GroupCancelled = 19,

    /// The contract has already been initialized.
    AlreadyInitialized = 20,
    
    /// The contract is currently paused and cannot execute this operation.
    ContractPaused = 21,
    
    /// Only the admin can pause the contract.
    UnauthorizedPause = 22,
    
    /// Only the admin can unpause the contract.
    UnauthorizedUnpause = 23,

    /// Contribution is too late - grace period has expired.
    GracePeriodExpired = 24,

    /// Invalid grace period duration.
    InvalidGracePeriod = 25,

    /// Invalid penalty rate (must be 0-100).
    InvalidPenaltyRate = 26,

    /// Metadata field exceeds maximum length.
    MetadataTooLong = 27,

    /// Cannot cancel group after first payout.
    CannotCancelAfterPayout = 28,

    /// Only the group creator can cancel the group.
    OnlyCreatorCanCancel = 29,

    /// Refund request already exists for this group.
    RefundRequestExists = 30,

    /// No active refund request for this group.
    NoRefundRequest = 31,

    /// Member has already voted on this refund request.
    AlreadyVoted = 32,

    /// Voting period has not ended yet.
    VotingPeriodActive = 33,

    /// Voting period has ended.
    VotingPeriodEnded = 34,

    /// Refund request was not approved.
    RefundNotApproved = 35,

    /// Refund has already been executed.
    RefundAlreadyExecuted = 36,

    /// Cannot request refund before cycle deadline.
    CycleNotExpired = 37,

    /// Token contract address is invalid or not found.
    InvalidTokenAddress = 38,

    /// Contract has insufficient token balance for payout.
    InsufficientContractBalance = 39,

    /// Token allowance is insufficient for transfer.
    InsufficientAllowance = 40,

    /// Insurance claim not found or invalid.
    InvalidClaim = 41,

    /// Claim has already been processed (approved or rejected).
    ClaimAlreadyProcessed = 42,

    /// Insurance pool has insufficient balance for payout.
    InsufficientPoolBalance = 43,

    /// Insurance pool for token not found.
    PoolNotFound = 44,

    /// Invalid or unsupported payout ordering strategy.
    InvalidStrategy = 45,

    /// Voting is not open for this group's payout strategy.
    VotingNotOpen = 46,

    /// No eligible members remain for payout selection (all have been paid).
    NoEligibleMembers = 47,

    // ── Multi-token errors ────────────────────────────────────────────────

    /// The token is not in the group's accepted token list.
    TokenNotAccepted = 48,

    /// Invalid multi-token configuration (empty list, duplicates, zero weight,
    /// or too many tokens).
    InvalidMultiTokenConfig = 49,

    /// Group does not have multi-token configuration.
    NotMultiTokenGroup = 50,

    /// No notification preferences found for this member.
    PreferencesNotFound = 51,

    // ── Dispute errors ────────────────────────────────────────────────────

    /// The specified dispute was not found in storage.
    DisputeNotFound = 52,

    /// The dispute has already been resolved.
    DisputeAlreadyResolved = 53,

    /// This address has already voted on this dispute.
    AlreadyVotedOnDispute = 54,

    /// The voting period for this dispute has ended.
    VotingPeriodEndedDispute = 55,

    /// The caller is not a member of the dispute's group.
    NotDisputeMember = 56,

    // ── Reputation errors ─────────────────────────────────────────────────

    /// No reputation record found for this member.
    ReputationNotFound = 57,

    /// Member's credit score is below the group's minimum requirement.
    InsufficientCreditScore = 58,

    /// Stored schema version is not supported by this Wasm.
    SchemaUnsupported = 59,

    /// Requested upgrade does not declare compatibility with this storage schema.
    SchemaMismatch = 60,
}

