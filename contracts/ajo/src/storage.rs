use soroban_sdk::{symbol_short, Address, Env, IntoVal, Symbol, Val, Vec};

use crate::errors::AjoError;

// ── TTL policy ─────────────────────────────────────────────────────────────
//
// Soroban never auto-renews storage TTLs; every persistent (and instance)
// entry must be re-extended by the contract or it becomes inaccessible
// ("archived") once the ledger sequence passes its `live_until` — a hard
// error on read, not just a cost concern (see `check_if_entry_is_live` in
// soroban-env-host). Group cycles run up to 90 days plus a 7-day grace
// period (see `utils::GroupTemplate` durations), so any entry touched only
// once and never re-extended is a real expiry risk well within a single
// group's active lifecycle.
//
// ~5s average ledger close time on Stellar.
const LEDGERS_PER_DAY: u32 = 17_280;
/// Re-extend once fewer than this many ledgers of TTL remain.
const PERSISTENT_TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
/// Push the TTL out this far when (re-)extending — comfortably longer than
/// the worst-case single-cycle gap between writes (90-day cycle + 7-day
/// grace) and well under the network's max entry TTL.
const PERSISTENT_TTL_EXTEND_TO: u32 = 120 * LEDGERS_PER_DAY;

/// Extends the TTL of a persistent entry using the contract-wide policy
/// above. Call after every persistent `set`, and after `get` for entries
/// that may be read many times between writes (e.g. `Group`, metadata).
fn extend_persistent_ttl<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

/// Extends the TTL of the shared instance-storage entry. Instance storage
/// backs the contract's own identity (admin, schema version, counters) — if
/// it expires the *entire contract* becomes unusable, a strictly worse
/// failure mode than losing one group's data. Called once per hot-path
/// entrypoint invocation (`contribute`, `execute_payout`).
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

/// Writes a persistent entry and extends its TTL in one step, so every
/// persistent write in this module automatically keeps its own entry alive
/// per the policy above.
fn persistent_set<K, V>(env: &Env, key: &K, value: &V)
where
    K: IntoVal<Env, Val>,
    V: IntoVal<Env, Val>,
{
    env.storage().persistent().set(key, value);
    extend_persistent_ttl(env, key);
}

/// Current persisted storage schema version supported by this Wasm.
///
/// Any future release that changes the serialized shape of persisted values in
/// `types.rs` must increment this value and provide an explicit migration before
/// reads are allowed to proceed. Additive-only releases can keep the version.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Logical storage key categories used by the Ajo contract.
///
/// Soroban storage uses raw key values; this enum documents the naming
/// conventions and composite key structures used throughout the contract.
/// Each variant maps to a specific `symbol_short!` or tuple key at the
/// call site.
pub enum StorageKey {
    /// Singleton key for the contract administrator address.
    /// Stored in instance storage under `"ADMIN"`.
    Admin,

    /// Singleton key for the persisted storage schema version.
    /// Stored in instance storage under `"SCHEMA"`.
    SchemaVersion,

    /// Monotonically increasing counter used to assign unique group IDs.
    /// Stored in instance storage under `"GCOUNTER"`.
    GroupCounter,

    /// Full group state keyed by its numeric ID.
    /// Stored in persistent storage under `("GROUP", group_id)`.
    Group(u64),

    /// Per-member contribution flag for a specific group and cycle.
    /// Stored in persistent storage under `("CONTRIB", group_id, cycle, member)`.
    /// Value is `bool` — `true` means the member has contributed.
    Contribution(u64, u32, Address),

    /// Records whether a member has received their payout for a group.
    /// Stored in persistent storage under `("PAYOUT", group_id, member)`.
    /// Value is `bool` — `true` means the payout has been distributed.
    PayoutReceived(u64, Address),

    /// Optional metadata for a group.
    /// Stored in persistent storage under `("METADATA", group_id)`.
    GroupMetadata(u64),

    /// Contribution record with penalty information.
    /// Stored in persistent storage under `("CONTREC", group_id, cycle, member)`.
    ContributionDetail(u64, u32, Address),

    /// Member penalty statistics for a group.
    /// Stored in persistent storage under `("PENALTY", group_id, member)`.
    MemberPenalty(u64, Address),

    /// Penalty pool for current cycle.
    /// Stored in persistent storage under `("PENPOOL", group_id, cycle)`.
    CyclePenaltyPool(u64, u32),

    /// Insurance pool for a specific token.
    /// Stored in instance storage under `("INSPOOL", token_address)`.
    InsurancePool(Address),

    /// Insurance claim keyed by ID.
    /// Stored in persistent storage under `("INSCLAIM", claim_id)`.
    InsuranceClaim(u64),

    /// Global insurance claim counter.
    /// Stored in instance storage under `"ICONT"`.
    ClaimCounter,

    /// Group milestones list.
    /// Stored in persistent storage under `("GMILE", group_id)`.
    GroupMilestones(u64),

    /// Member achievements list.
    /// Stored in persistent storage under `("MACHIEV", member)`.
    MemberAchievements(Address),

    /// Aggregated member statistics.
    /// Stored in persistent storage under `("MSTATS", member)`.
    MemberStatsData(Address),

    /// Aggregated reputation record for a member.
    /// Stored in persistent storage under `("MREP", member)`.
    MemberReputation(Address),

    /// Ordered list of credit score snapshots for a member.
    /// Stored in persistent storage under `("MREPSNAP", member)`.
    MemberReputationSnapshots(Address),

    /// Ordered list of payment history entries for a member.
    /// Stored in persistent storage under `("MPAYHIST", member)`.
    MemberPaymentHistory(Address),
}

impl StorageKey {
    /// Returns the short [`Symbol`] prefix associated with this key variant.
    ///
    /// This method extracts the symbol portion of a storage key. Note that composite
    /// keys (e.g., [`StorageKey::Group`]) pair this symbol with additional fields
    /// in a tuple at the storage call site; this method returns only the symbol portion.
    ///
    /// # Arguments
    /// * `_env` - The contract environment (reserved for future use)
    ///
    /// # Returns
    /// The [`Symbol`] corresponding to this key variant's prefix
    pub fn to_symbol(&self, _env: &Env) -> Symbol {
        match self {
            StorageKey::Admin => symbol_short!("ADMIN"),
            StorageKey::SchemaVersion => symbol_short!("SCHEMA"),
            StorageKey::GroupCounter => symbol_short!("GCOUNTER"),
            StorageKey::Group(_) => symbol_short!("GROUP"),
            StorageKey::Contribution(_, _, _) => symbol_short!("CONTRIB"),
            StorageKey::PayoutReceived(_, _) => symbol_short!("PAYOUT"),
            StorageKey::GroupMetadata(_) => symbol_short!("METADATA"),
            StorageKey::ContributionDetail(_, _, _) => symbol_short!("CONTREC"),
            StorageKey::MemberPenalty(_, _) => symbol_short!("PENALTY"),
            StorageKey::CyclePenaltyPool(_, _) => symbol_short!("PENPOOL"),
            StorageKey::InsurancePool(_) => symbol_short!("INSPOOL"),
            StorageKey::InsuranceClaim(_) => symbol_short!("INSCLAIM"),
            StorageKey::ClaimCounter => symbol_short!("ICONT"),
            StorageKey::GroupMilestones(_) => symbol_short!("GMILE"),
            StorageKey::MemberAchievements(_) => symbol_short!("MACHIEV"),
            StorageKey::MemberStatsData(_) => symbol_short!("MSTATS"),
            StorageKey::MemberReputation(_) => symbol_short!("MREP"),
            StorageKey::MemberReputationSnapshots(_) => symbol_short!("MREPSNAP"),
            StorageKey::MemberPaymentHistory(_) => symbol_short!("MPAYHIST"),
        }
    }
}


/// Returns the next available group ID and atomically increments the counter.

///
/// The counter starts at 0 and is stored in instance storage. Each call
/// increments it by 1 and returns the new value, so the first group
/// ever created receives ID `1`.
///
/// # Arguments
/// * `env` - The contract environment used to access instance storage
///
/// # Returns
/// The next available group ID (starting from 1)
pub fn get_next_group_id(env: &Env) -> u64 {
    let key = symbol_short!("GCOUNTER");
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&key, &next);
    next
}

/// Persists a [`Group`](crate::types::Group) to persistent ledger storage.
///
/// This function writes or overwrites the group data for the given `group_id`.
/// Call this any time the group's mutable fields (members, cycle, payout index, etc.) change.
///
/// # Arguments
/// * `env` - The contract environment used to access persistent storage
/// * `group_id` - The unique identifier for the group
/// * `group` - The group data to store
pub fn store_group(env: &Env, group_id: u64, group: &crate::types::Group) {
    set_schema_version_if_unset(env);
    let key = (symbol_short!("GROUP"), group_id);
    persistent_set(env, &key, group);
}

/// Retrieves a [`Group`](crate::types::Group) from persistent ledger storage.
///
/// Returns `None` if no group exists for the given `group_id`. Callers
/// typically convert this to [`AjoError::GroupNotFound`](crate::errors::AjoError::GroupNotFound)
/// via `.ok_or(...)`.
///
/// # Arguments
/// * `env` - The contract environment used to access persistent storage
/// * `group_id` - The unique identifier for the group to retrieve
///
/// # Returns
/// `Some(Group)` if the group exists, `None` otherwise
pub fn get_group(env: &Env, group_id: u64) -> Option<crate::types::Group> {
    if ensure_supported_schema(env).is_err() {
        return None;
    }
    let key = (symbol_short!("GROUP"), group_id);
    let group = env.storage().persistent().get(&key);
    if group.is_some() {
        // Refresh on read too: a group can be queried many times between
        // cycle writes without ever going stale.
        extend_persistent_ttl(env, &key);
    }
    group
}

/// Returns the stored schema version, defaulting legacy empty instances to v1.
pub fn get_schema_version(env: &Env) -> u32 {
    let key = symbol_short!("SCHEMA");
    env.storage().instance().get(&key).unwrap_or(CURRENT_SCHEMA_VERSION)
}

/// Records the schema version after initialization or a successful migration.
pub fn store_schema_version(env: &Env, version: u32) {
    let key = symbol_short!("SCHEMA");
    env.storage().instance().set(&key, &version);
}

/// Initializes the schema version for legacy-compatible v1 state.
pub fn set_schema_version_if_unset(env: &Env) {
    let key = symbol_short!("SCHEMA");
    if !env.storage().instance().has(&key) {
        env.storage().instance().set(&key, &CURRENT_SCHEMA_VERSION);
    }
}

/// Fails closed when this Wasm does not understand the stored schema.
pub fn ensure_supported_schema(env: &Env) -> Result<(), AjoError> {
    if get_schema_version(env) == CURRENT_SCHEMA_VERSION {
        Ok(())
    } else {
        Err(AjoError::SchemaUnsupported)
    }
}

/// Removes a group's record from persistent storage.
///
/// This is a destructive, irreversible operation. Use with caution as it
/// permanently deletes the group data. Primarily intended for administrative
/// cleanup or future migration paths.
///
/// # Arguments
/// * `env` - The contract environment used to access persistent storage
/// * `group_id` - The unique identifier for the group to remove
pub fn remove_group(env: &Env, group_id: u64) {
    let key = (symbol_short!("GROUP"), group_id);
    env.storage().persistent().remove(&key);
}

/// Records whether a member has paid their contribution for a given cycle.
///
/// The composite key `(group_id, cycle, member)` ensures that contribution
/// records are scoped per-group and per-cycle. A member's contribution in
/// cycle 1 does not affect their status in cycle 2.
///
/// # Arguments
/// * `env` - The contract environment used to access persistent storage
/// * `group_id` - The group the contribution belongs to
/// * `cycle` - The cycle number being recorded
/// * `member` - The contributing member's address
/// * `paid` - `true` to mark as paid; `false` to reset (rarely needed)
pub fn store_contribution(env: &Env, group_id: u64, cycle: u32, member: &Address, paid: bool) {
    let key = (symbol_short!("CONTRIB"), group_id, cycle, member);
    persistent_set(env, &key, &paid);
}

/// Returns `true` if the given member has contributed during the specified cycle.
///
/// Defaults to `false` if no record exists, meaning the member has not yet contributed.
///
/// # Arguments
/// * `env` - The contract environment used to access persistent storage
/// * `group_id` - The group to check
/// * `cycle` - The cycle number to check
/// * `member` - The member address to check
///
/// # Returns
/// `true` if the member has contributed, `false` otherwise
pub fn has_contributed(env: &Env, group_id: u64, cycle: u32, member: &Address) -> bool {
    let key = (symbol_short!("CONTRIB"), group_id, cycle, member);
    env.storage().persistent().get(&key).unwrap_or(false)
}

/// Records that the given member has received their payout for a group.
///
/// This flag is set after `execute_payout` successfully distributes funds.
/// It can be used for audit purposes and to prevent any future duplicate payouts.
///
/// # Arguments
/// * `env` - The contract environment used to access persistent storage
/// * `group_id` - The group the payout belongs to
/// * `member` - The address that received the payout
pub fn mark_payout_received(env: &Env, group_id: u64, member: &Address) {
    let key = (symbol_short!("PAYOUT"), group_id, member);
    persistent_set(env, &key, &true);
}

/// Returns contribution status for every member in a cycle as an ordered vector.
///
/// Iterates through `members` in order and looks up each one's contribution
/// flag for the given cycle. The returned vector preserves member order and
/// pairs each address with a `bool` indicating whether they have contributed.
///
/// # Arguments
/// * `env` - The contract environment used to access persistent storage
/// * `group_id` - The group to query
/// * `cycle` - The cycle number to query
/// * `members` - The ordered member list from the group (use `group.members`)
///
/// # Returns
/// A `Vec<(Address, bool)>` with members in original order, `true` = has contributed
pub fn get_cycle_contributions(
    env: &Env,
    group_id: u64,
    cycle: u32,
    members: &Vec<Address>,
) -> Vec<(Address, bool)> {
    let _capacity = members.len() as u32;
    let mut results = Vec::new(env);

    for member in members.iter() {
        let paid = has_contributed(env, group_id, cycle, &member);
        results.push_back((member, paid));
    }
    results
}

/// Stores the contract administrator address in instance storage.
///
/// Should only be called once during [`AjoContract::initialize`](crate::contract::AjoContract::initialize).
/// Subsequent calls will overwrite the existing admin. Access control is enforced
/// at the contract level to prevent unauthorized changes.
///
/// # Arguments
/// * `env` - The contract environment used to access instance storage
/// * `admin` - The address of the contract administrator
pub fn store_admin(env: &Env, admin: &Address) {
    set_schema_version_if_unset(env);
    let key = symbol_short!("ADMIN");
    env.storage().instance().set(&key, admin);
}

/// Retrieves the contract administrator address from instance storage.
///
/// Returns `None` if the contract has not yet been initialized.
/// Callers typically use `.ok_or(AjoError::Unauthorized)` to enforce authorization checks.
///
/// # Arguments
/// * `env` - The contract environment used to access instance storage
///
/// # Returns
/// `Some(Address)` containing the admin address if initialized, `None` otherwise
pub fn get_admin(env: &Env) -> Option<Address> {
    let key = symbol_short!("ADMIN");
    env.storage().instance().get(&key)
}

/// Stores metadata for a group in persistent storage.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The unique identifier for the group
/// * `metadata` - The metadata struct to store
pub fn store_group_metadata(env: &Env, group_id: u64, metadata: &crate::types::GroupMetadata) {
    let key = (symbol_short!("METADATA"), group_id);
    persistent_set(env, &key, metadata);
}

/// Retrieves metadata for a group from persistent storage.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The unique identifier for the group
///
/// # Returns
/// `Some(GroupMetadata)` if it exists, `None` otherwise
pub fn get_group_metadata(env: &Env, group_id: u64) -> Option<crate::types::GroupMetadata> {
    let key = (symbol_short!("METADATA"), group_id);
    let metadata = env.storage().persistent().get(&key);
    if metadata.is_some() {
        extend_persistent_ttl(env, &key);
    }
    metadata
}

/// Checks if metadata exists for a group.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The unique identifier for the group
///
/// # Returns
/// `true` if metadata exists, `false` otherwise
pub fn has_group_metadata(env: &Env, group_id: u64) -> bool {
    let key = (symbol_short!("METADATA"), group_id);
    env.storage().persistent().has(&key)
}

/// Stores detailed contribution record with penalty information.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group the contribution belongs to
/// * `cycle` - The cycle number
/// * `member` - The contributing member's address
/// * `record` - The contribution record with penalty details
pub fn store_contribution_detail(
    env: &Env,
    group_id: u64,
    cycle: u32,
    member: &Address,
    record: &crate::types::ContributionRecord,
) {
    let key = (symbol_short!("CONTREC"), group_id, cycle, member);
    persistent_set(env, &key, record);
}

/// Retrieves detailed contribution record.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group to check
/// * `cycle` - The cycle number
/// * `member` - The member address
///
/// # Returns
/// `Some(ContributionRecord)` if exists, `None` otherwise
pub fn get_contribution_detail(
    env: &Env,
    group_id: u64,
    cycle: u32,
    member: &Address,
) -> Option<crate::types::ContributionRecord> {
    let key = (symbol_short!("CONTREC"), group_id, cycle, member);
    env.storage().persistent().get(&key)
}

/// Stores or updates member penalty statistics.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group the member belongs to
/// * `member` - The member's address
/// * `record` - The penalty record
pub fn store_member_penalty(
    env: &Env,
    group_id: u64,
    member: &Address,
    record: &crate::types::MemberPenaltyRecord,
) {
    let key = (symbol_short!("PENALTY"), group_id, member);
    persistent_set(env, &key, record);
}

/// Retrieves member penalty statistics.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group to check
/// * `member` - The member address
///
/// # Returns
/// `Some(MemberPenaltyRecord)` if exists, `None` otherwise
pub fn get_member_penalty(
    env: &Env,
    group_id: u64,
    member: &Address,
) -> Option<crate::types::MemberPenaltyRecord> {
    let key = (symbol_short!("PENALTY"), group_id, member);
    env.storage().persistent().get(&key)
}

/// Stores the penalty pool for a cycle.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `cycle` - The cycle number
/// * `amount` - Total penalties collected in this cycle
pub fn store_cycle_penalty_pool(env: &Env, group_id: u64, cycle: u32, amount: i128) {
    let key = (symbol_short!("PENPOOL"), group_id, cycle);
    persistent_set(env, &key, &amount);
}

/// Retrieves the penalty pool for a cycle.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `cycle` - The cycle number
///
/// # Returns
/// Total penalties collected, defaults to 0 if not set
pub fn get_cycle_penalty_pool(env: &Env, group_id: u64, cycle: u32) -> i128 {
    let key = (symbol_short!("PENPOOL"), group_id, cycle);
    env.storage().persistent().get(&key).unwrap_or(0)
}

/// Adds a penalty amount to the cycle's penalty pool.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `cycle` - The cycle number
/// * `penalty` - Penalty amount to add
pub fn add_to_penalty_pool(env: &Env, group_id: u64, cycle: u32, penalty: i128) {
    let current = get_cycle_penalty_pool(env, group_id, cycle);
    store_cycle_penalty_pool(env, group_id, cycle, current + penalty);
}

/// Stores a refund request for a group.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group the refund request is for
/// * `request` - The refund request data
pub fn store_refund_request(env: &Env, group_id: u64, request: &crate::types::RefundRequest) {
    let key = (symbol_short!("REFREQ"), group_id);
    persistent_set(env, &key, request);
}

/// Retrieves a refund request for a group.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group to check
///
/// # Returns
/// `Some(RefundRequest)` if exists, `None` otherwise
pub fn get_refund_request(env: &Env, group_id: u64) -> Option<crate::types::RefundRequest> {
    let key = (symbol_short!("REFREQ"), group_id);
    env.storage().persistent().get(&key)
}

/// Checks if a refund request exists for a group.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group to check
///
/// # Returns
/// `true` if a refund request exists, `false` otherwise
pub fn has_refund_request(env: &Env, group_id: u64) -> bool {
    let key = (symbol_short!("REFREQ"), group_id);
    env.storage().persistent().has(&key)
}

/// Removes a refund request from storage.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group to remove the request for
pub fn remove_refund_request(env: &Env, group_id: u64) {
    let key = (symbol_short!("REFREQ"), group_id);
    env.storage().persistent().remove(&key);
}

/// Stores a member's vote on a refund request.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `member` - The voting member's address
/// * `vote` - The vote record
pub fn store_refund_vote(
    env: &Env,
    group_id: u64,
    member: &Address,
    vote: &crate::types::RefundVote,
) {
    let key = (symbol_short!("REFVOTE"), group_id, member);
    persistent_set(env, &key, vote);
}

/// Retrieves a member's vote on a refund request.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `member` - The member's address
///
/// # Returns
/// `Some(RefundVote)` if the member has voted, `None` otherwise
pub fn get_refund_vote(
    env: &Env,
    group_id: u64,
    member: &Address,
) -> Option<crate::types::RefundVote> {
    let key = (symbol_short!("REFVOTE"), group_id, member);
    env.storage().persistent().get(&key)
}

/// Checks if a member has voted on a refund request.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `member` - The member's address
///
/// # Returns
/// `true` if the member has voted, `false` otherwise
pub fn has_voted(env: &Env, group_id: u64, member: &Address) -> bool {
    let key = (symbol_short!("REFVOTE"), group_id, member);
    env.storage().persistent().has(&key)
}

/// Stores a refund record.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `member` - The member receiving the refund
/// * `record` - The refund record
pub fn store_refund_record(
    env: &Env,
    group_id: u64,
    member: &Address,
    record: &crate::types::RefundRecord,
) {
    let key = (symbol_short!("REFUND"), group_id, member);
    persistent_set(env, &key, record);
}

/// Retrieves a refund record for a member.
///
/// # Arguments
/// * `env` - The contract environment
/// * `group_id` - The group
/// * `member` - The member's address
///
/// # Returns
/// `Some(RefundRecord)` if exists, `None` otherwise
pub fn get_refund_record(
    env: &Env,
    group_id: u64,
    member: &Address,
) -> Option<crate::types::RefundRecord> {
    let key = (symbol_short!("REFUND"), group_id, member);
    env.storage().persistent().get(&key)
}

/// Stores the insurance pool for a token.
///
/// Per-token, unboundedly growing data — persistent, not instance (see
/// `get_insurance_pool` for why this used to be instance storage and how
/// any pre-existing instance-stored pool is picked up transparently).
pub fn store_insurance_pool(env: &Env, token: &Address, pool: &crate::types::InsurancePool) {
    let key = (symbol_short!("INSPOOL"), token);
    persistent_set(env, &key, pool);
}

/// Gets the fraud risk profile for a member
pub fn get_fraud_risk_profile(env: &Env, member: &Address) -> Option<crate::types::FraudRiskProfile> {
    let key = (symbol_short!("FRDPROF"), member);
    env.storage().persistent().get(&key)
}

/// Stores the fraud risk profile for a member
pub fn store_fraud_risk_profile(env: &Env, member: &Address, profile: &crate::types::FraudRiskProfile) {
    let key = (symbol_short!("FRDPROF"), member);
    persistent_set(env, &key, profile);
}

/// Gets the group risk assessment
pub fn get_group_risk_assessment(env: &Env, group_id: u64) -> Option<crate::types::GroupRiskAssessment> {
    let key = (symbol_short!("GRPRISK"), group_id);
    env.storage().persistent().get(&key)
}

/// Stores the group risk assessment
pub fn store_group_risk_assessment(env: &Env, group_id: u64, assessment: &crate::types::GroupRiskAssessment) {
    let key = (symbol_short!("GRPRISK"), group_id);
    persistent_set(env, &key, assessment);
}

/// Retrieves the insurance pool for a token.
///
/// `InsurancePool` used to live in instance storage — a single shared
/// ledger entry read/written on every contract invocation that touches
/// *any* instance key, which taxes every call (not just insurance-enabled
/// ones) as more tokens/groups accumulate. It now lives in persistent
/// storage, keyed the same way. Any pool already written under the old
/// instance key (from before this change) is still readable via the
/// fallback below and is transparently migrated forward the next time
/// `store_insurance_pool` is called for that token.
pub fn get_insurance_pool(env: &Env, token: &Address) -> Option<crate::types::InsurancePool> {
    let key = (symbol_short!("INSPOOL"), token);
    if let Some(pool) = env.storage().persistent().get(&key) {
        return Some(pool);
    }
    env.storage().instance().get(&key)
}

/// Returns next available claim ID.
pub fn get_next_claim_id(env: &Env) -> u64 {
    let key = symbol_short!("ICONT");
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&key, &next);
    next
}

/// Stores an insurance claim.
pub fn store_insurance_claim(env: &Env, claim_id: u64, claim: &crate::types::InsuranceClaim) {
    let key = (symbol_short!("INSCLAIM"), claim_id);
    persistent_set(env, &key, claim);
}

/// Retrieves an insurance claim.
pub fn get_insurance_claim(env: &Env, claim_id: u64) -> Option<crate::types::InsuranceClaim> {
    let key = (symbol_short!("INSCLAIM"), claim_id);
    env.storage().persistent().get(&key)
}

// ── Payout-ordering helpers ───────────────────────────────────────────────────

/// Returns `true` if the given member has already received their payout for a group.
///
/// This is the read-side counterpart of [`mark_payout_received`].
pub fn has_received_payout(env: &Env, group_id: u64, member: &Address) -> bool {
    let key = (symbol_short!("PAYOUT"), group_id, member);
    env.storage().persistent().get(&key).unwrap_or(false)
}

/// Stores a payout vote cast by `voter` for `nominee` in `cycle`.
///
/// Keyed per voter so each member can cast at most one vote per cycle.
pub fn store_payout_vote(
    env: &Env,
    group_id: u64,
    cycle: u32,
    voter: &Address,
    vote: &crate::types::PayoutVote,
) {
    let key = (symbol_short!("PVOTE"), group_id, cycle, voter);
    persistent_set(env, &key, vote);
}

/// Retrieves the payout vote cast by `voter` for `cycle`, if any.
pub fn get_payout_vote(
    env: &Env,
    group_id: u64,
    cycle: u32,
    voter: &Address,
) -> Option<crate::types::PayoutVote> {
    let key = (symbol_short!("PVOTE"), group_id, cycle, voter);
    env.storage().persistent().get(&key)
}

/// Returns `true` if `voter` has already submitted a payout vote for `cycle`.
pub fn has_voted_for_payout(env: &Env, group_id: u64, cycle: u32, voter: &Address) -> bool {
    let key = (symbol_short!("PVOTE"), group_id, cycle, voter);
    env.storage().persistent().has(&key)
}

/// Persists the determined [`PayoutOrder`](crate::types::PayoutOrder) for a cycle.
pub fn store_payout_order(env: &Env, group_id: u64, cycle: u32, order: &crate::types::PayoutOrder) {
    let key = (symbol_short!("PORDER"), group_id, cycle);
    persistent_set(env, &key, order);
}

/// Retrieves the committed payout order for a cycle, if one has been recorded.
pub fn get_payout_order(env: &Env, group_id: u64, cycle: u32) -> Option<crate::types::PayoutOrder> {
    let key = (symbol_short!("PORDER"), group_id, cycle);
    env.storage().persistent().get(&key)
}

// ── Contribution reminder helpers ─────────────────────────────────────────────

/// Stores a member's notification preferences in persistent storage.
///
/// Keyed by member address so each member has exactly one preferences record
/// that applies across all groups.
pub fn store_notification_preferences(
    env: &Env,
    member: &Address,
    prefs: &crate::types::MemberNotificationPreferences,
) {
    let key = (symbol_short!("NOTPREF"), member);
    persistent_set(env, &key, prefs);
}

/// Retrieves a member's notification preferences, if set.
pub fn get_notification_preferences(
    env: &Env,
    member: &Address,
) -> Option<crate::types::MemberNotificationPreferences> {
    let key = (symbol_short!("NOTPREF"), member);
    env.storage().persistent().get(&key)
}

/// Stores a reminder record for a specific group, cycle, and member.
///
/// Uses a composite key so the latest reminder per member per cycle is retained.
pub fn store_reminder_record(
    env: &Env,
    group_id: u64,
    cycle: u32,
    member: &Address,
    record: &crate::types::ReminderRecord,
) {
    let key = (symbol_short!("REMIND"), group_id, cycle, member);
    persistent_set(env, &key, record);
}

/// Retrieves the most recent reminder record for a member in a given cycle.
pub fn get_reminder_record(
    env: &Env,
    group_id: u64,
    cycle: u32,
    member: &Address,
) -> Option<crate::types::ReminderRecord> {
    let key = (symbol_short!("REMIND"), group_id, cycle, member);
    env.storage().persistent().get(&key)
}
// ── Milestone & achievement storage ───────────────────────────────────────

/// Stores group milestones list.
pub fn store_group_milestones(
    env: &Env,
    group_id: u64,
    milestones: &Vec<crate::types::MilestoneRecord>,
) {
    let key = (symbol_short!("GMILE"), group_id);
    persistent_set(env, &key, milestones);
}

/// Retrieves group milestones.
pub fn get_group_milestones(
    env: &Env,
    group_id: u64,
) -> Option<Vec<crate::types::MilestoneRecord>> {
    let key = (symbol_short!("GMILE"), group_id);
    env.storage().persistent().get(&key)
}

/// Adds a single milestone to a group's milestone list.
pub fn add_group_milestone(env: &Env, group_id: u64, record: &crate::types::MilestoneRecord) {
    let mut milestones = get_group_milestones(env, group_id).unwrap_or_else(|| Vec::new(env));
    milestones.push_back(record.clone());
    store_group_milestones(env, group_id, &milestones);
}

/// Stores member achievements list.
pub fn store_member_achievements(
    env: &Env,
    member: &Address,
    achievements: &Vec<crate::types::AchievementRecord>,
) {
    let key = (symbol_short!("MACHIEV"), member);
    persistent_set(env, &key, achievements);
}

/// Retrieves member achievements.
pub fn get_member_achievements(
    env: &Env,
    member: &Address,
) -> Option<Vec<crate::types::AchievementRecord>> {
    let key = (symbol_short!("MACHIEV"), member);
    env.storage().persistent().get(&key)
}

/// Adds a single achievement to a member's list.
pub fn add_member_achievement(
    env: &Env,
    member: &Address,
    record: &crate::types::AchievementRecord,
) {
    let mut achievements = get_member_achievements(env, member).unwrap_or_else(|| Vec::new(env));
    achievements.push_back(record.clone());
    store_member_achievements(env, member, &achievements);
}

/// Stores aggregated member statistics.
pub fn store_member_stats(env: &Env, member: &Address, stats: &crate::types::MemberStats) {
    let key = (symbol_short!("MSTATS"), member);
    persistent_set(env, &key, stats);
}

/// Retrieves aggregated member statistics.
pub fn get_member_stats(env: &Env, member: &Address) -> Option<crate::types::MemberStats> {
    let key = (symbol_short!("MSTATS"), member);
    env.storage().persistent().get(&key)
}

// ── Group access control storage ──────────────────────────────────────────

/// Stores an invitation for a member to join a group.
pub fn store_invitation(
    env: &Env,
    group_id: u64,
    invitee: &Address,
    invitation: &crate::types::GroupInvitation,
) {
    let key = (symbol_short!("INVITE"), group_id, invitee);
    persistent_set(env, &key, invitation);
}

/// Retrieves an invitation for a member to join a group.
pub fn get_invitation(
    env: &Env,
    group_id: u64,
    invitee: &Address,
) -> Option<crate::types::GroupInvitation> {
    let key = (symbol_short!("INVITE"), group_id, invitee);
    env.storage().persistent().get(&key)
}

// ── Multi-token storage ───────────────────────────────────────────────────

/// Stores the multi-token configuration for a group.
pub fn store_multi_token_config(
    env: &Env,
    group_id: u64,
    config: &crate::types::MultiTokenConfig,
) {
    let key = (symbol_short!("MTCONF"), group_id);
    persistent_set(env, &key, config);
}

/// Retrieves the multi-token configuration for a group.
///
/// Returns `None` for single-token groups (those created via `create_group`).
pub fn get_multi_token_config(
    env: &Env,
    group_id: u64,
) -> Option<crate::types::MultiTokenConfig> {
    let key = (symbol_short!("MTCONF"), group_id);
    env.storage().persistent().get(&key)
}

/// Returns `true` if a group has multi-token configuration.
pub fn is_multi_token_group(env: &Env, group_id: u64) -> bool {
    let key = (symbol_short!("MTCONF"), group_id);
    env.storage().persistent().has(&key)
}

/// Stores a token-specific contribution record for a member in a cycle.
pub fn store_token_contribution(
    env: &Env,
    group_id: u64,
    cycle: u32,
    member: &Address,
    record: &crate::types::TokenContribution,
) {
    let key = (symbol_short!("TKCONT"), group_id, cycle, member);
    persistent_set(env, &key, record);
}

/// Retrieves the token-specific contribution record for a member in a cycle.
pub fn get_token_contribution(
    env: &Env,
    group_id: u64,
    cycle: u32,
    member: &Address,
) -> Option<crate::types::TokenContribution> {
    let key = (symbol_short!("TKCONT"), group_id, cycle, member);
    env.storage().persistent().get(&key)
}

/// Tracks per-token balance accumulated in a group for a given cycle.
///
/// This is used during payout to know how much of each token is available.
pub fn add_group_token_balance(
    env: &Env,
    group_id: u64,
    cycle: u32,
    token: &Address,
    amount: i128,
) {
    let key = (symbol_short!("GTBAL"), group_id, cycle, token);
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    persistent_set(env, &key, &(current + amount));
}

/// Retrieves the accumulated token balance for a group in a given cycle.
pub fn get_group_token_balance(
    env: &Env,
    group_id: u64,
    cycle: u32,
    token: &Address,
) -> i128 {
    let key = (symbol_short!("GTBAL"), group_id, cycle, token);
    env.storage().persistent().get(&key).unwrap_or(0)
}

// ── Dispute storage ───────────────────────────────────────────────────────

/// Returns the next dispute ID and increments the counter.
pub fn get_next_dispute_id(env: &Env) -> u64 {
    let key = symbol_short!("DCOUNTER");
    let id: u64 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(id + 1));
    id
}

/// Stores a dispute.
pub fn store_dispute(env: &Env, id: u64, dispute: &crate::types::Dispute) {
    let key = (symbol_short!("DISPUTE"), id);
    persistent_set(env, &key, dispute);
}

/// Retrieves a dispute by ID.
pub fn get_dispute(env: &Env, id: u64) -> Option<crate::types::Dispute> {
    let key = (symbol_short!("DISPUTE"), id);
    env.storage().persistent().get(&key)
}

/// Records that a voter has voted on a dispute.
pub fn store_dispute_vote(env: &Env, dispute_id: u64, voter: &Address, vote: &crate::types::DisputeVote) {
    let key = (symbol_short!("DISPVOTE"), dispute_id, voter);
    persistent_set(env, &key, vote);
}

/// Returns `true` if the voter has already voted on this dispute.
pub fn has_voted_on_dispute(env: &Env, dispute_id: u64, voter: &Address) -> bool {
    let key = (symbol_short!("DISPVOTE"), dispute_id, voter);
    env.storage().persistent().has(&key)
}

/// Stores the list of dispute IDs for a group.
pub fn store_group_dispute_ids(env: &Env, group_id: u64, ids: &Vec<u64>) {
    let key = (symbol_short!("DISPGIDS"), group_id);
    persistent_set(env, &key, ids);
}

/// Retrieves the list of dispute IDs for a group.
pub fn get_group_dispute_ids(env: &Env, group_id: u64) -> Vec<u64> {
    let key = (symbol_short!("DISPGIDS"), group_id);
    env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env))
}

// ── Reputation storage ────────────────────────────────────────────────────

/// Stores the aggregated reputation record for a member.
pub fn store_reputation(env: &Env, member: &Address, rep: &crate::types::ReputationScore) {
    let key = (symbol_short!("MREP"), member);
    persistent_set(env, &key, rep);
}

/// Retrieves the aggregated reputation record for a member.
pub fn get_reputation(env: &Env, member: &Address) -> Option<crate::types::ReputationScore> {
    let key = (symbol_short!("MREP"), member);
    env.storage().persistent().get(&key)
}

/// Appends a credit score snapshot to the member's history.
///
/// Enforces a rolling cap of [`MAX_SCORE_HISTORY`](crate::types::MAX_SCORE_HISTORY)
/// entries by dropping the oldest entry when the cap is reached.
pub fn append_credit_snapshot(
    env: &Env,
    member: &Address,
    snapshot: &crate::types::CreditScoreSnapshot,
) {
    let key = (symbol_short!("MREPSNAP"), member);
    let mut history: Vec<crate::types::CreditScoreSnapshot> =
        env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));

    // Enforce rolling cap
    while history.len() >= crate::types::MAX_SCORE_HISTORY {
        history.remove(0);
    }
    history.push_back(snapshot.clone());
    persistent_set(env, &key, &history);
}

/// Retrieves the credit score snapshot history for a member.
pub fn get_credit_snapshots(
    env: &Env,
    member: &Address,
) -> Option<Vec<crate::types::CreditScoreSnapshot>> {
    let key = (symbol_short!("MREPSNAP"), member);
    env.storage().persistent().get(&key)
}

/// Appends a payment history entry for a member.
///
/// Enforces a rolling cap of [`MAX_PAYMENT_HISTORY`](crate::types::MAX_PAYMENT_HISTORY)
/// entries by dropping the oldest entry when the cap is reached.
pub fn append_payment_history(
    env: &Env,
    member: &Address,
    entry: &crate::types::PaymentHistoryEntry,
) {
    let key = (symbol_short!("MPAYHIST"), member);
    let mut history: Vec<crate::types::PaymentHistoryEntry> =
        env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env));

    // Enforce rolling cap
    while history.len() >= crate::types::MAX_PAYMENT_HISTORY {
        history.remove(0);
    }
    history.push_back(entry.clone());
    persistent_set(env, &key, &history);
}

/// Retrieves the payment history for a member.
pub fn get_payment_history(
    env: &Env,
    member: &Address,
) -> Option<Vec<crate::types::PaymentHistoryEntry>> {
    let key = (symbol_short!("MPAYHIST"), member);
    env.storage().persistent().get(&key)
}
