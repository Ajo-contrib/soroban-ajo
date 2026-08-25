//! Multi-signature proposal module for critical admin actions.
//!
//! # Overview
//! Provides secure multi-sig coordination for privileged operations. Proposals must be
//! signed by a threshold of authorized signers before execution.
//!
//! # CEI Ordering & Security (Issue #979)
//! **CRITICAL:** Functions that call `execute_proposal()` MUST follow strict CEI ordering:
//!
//! 1. **CHECKS Phase**: Validate proposal state, signatures, authorization
//! 2. **EFFECTS Phase**: Update all internal state BEFORE calling `execute_proposal()`
//! 3. **EXECUTE Phase**: Call `execute_proposal()` to mark proposal executed
//! 4. **INTERACTIONS Phase**: Only AFTER proposal is marked executed, perform external calls
//!
//! **Rationale**: If the underlying action fails after `execute_proposal()` is called,
//! the proposal becomes permanently stuck (marked executed but action never happened).
//! Soroban's atomicity ensures the entire transaction reverts on failure, preventing
//! inconsistent state.
//!
//! **Pattern Example**:
//! ```ignore
//! // ✅ CORRECT: Execute proposal at the END
//! let mut action_state = storage::get_action_state(...);
//! // Validate everything first
//! validate_action(&action_state)?;
//! // Update all internal state
//! action_state.some_field = new_value;
//! storage::store_action_state(..., &action_state)?;
//! // Emit events
//! env.events().publish(...);
//! // MARK EXECUTED LAST
//! execute_proposal(&env, proposal_id);  // <-- Last step
//! ```
//!
//! ```ignore
//! // ❌ WRONG: Execute proposal too early
//! execute_proposal(&env, proposal_id);  // <-- WRONG POSITION
//! let mut action_state = storage::get_action_state(...);
//! action_state.some_field = new_value;
//! storage::store_action_state(..., &action_state)?;
//! // If storage write fails, proposal is stuck as executed!
//! ```
//!
//! # Proposal Lifecycle
//! 1. `create_proposal()` - Create with initial state (executed=false)
//! 2. `sign_proposal()` - Collect signatures until threshold reached
//! 3. [Perform the underlying action]
//! 4. `execute_proposal()` - Mark as executed AFTER action succeeds
//! 5. On failure: Entire transaction reverts (atomicity), proposal remains unsigned

use soroban_sdk::{contracttype, Address, Env, Vec, Symbol, symbol_short, IntoVal};

/// On-chain multi-sig proposal for critical admin actions.
///
/// # Fields
/// - `id`: Unique proposal identifier
/// - `group_id`: Associated group (for audit/context)
/// - `action`: Type of action (Symbol for efficient encoding)
/// - `threshold`: Number of signatures required
/// - `signers`: Authorized signers for this proposal
/// - `signed_count`: Current signature count
/// - `executed`: Whether the underlying action was performed (set LAST in CEI ordering)
/// - `expires_at`: Ledger timestamp when proposal becomes invalid
/// - `created_at`: Ledger timestamp of proposal creation
///
/// # Security Note
/// The `executed` flag must be set AFTER the underlying action succeeds, never before.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiSigProposal {
    pub id: u64,
    pub group_id: u64,
    pub action: Symbol,
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub signed_count: u32,
    pub executed: bool,
    pub expires_at: u64,
    pub created_at: u64,
}

const MULTISIG_KEY: Symbol = symbol_short!("MSIG");

fn proposal_key(env: &Env, id: u64) -> soroban_sdk::Val {
    (MULTISIG_KEY, id).into_val(env)
}

fn next_id_key(env: &Env) -> soroban_sdk::Val {
    symbol_short!("MSIG_ID").into_val(env)
}

fn has_signed_key(env: &Env, proposal_id: u64, signer: &Address) -> soroban_sdk::Val {
    (symbol_short!("MSIG_SIG"), proposal_id, signer.clone()).into_val(env)
}

/// Create a new multi-sig proposal.
///
/// # Arguments
/// * `env` - Soroban environment
/// * `group_id` - Associated group ID (for audit context)
/// * `action` - Action type identifier (Symbol for efficiency)
/// * `signers` - Addresses authorized to sign
/// * `threshold` - Number of signatures required for execution readiness
/// * `ttl_seconds` - Time-to-live in seconds; proposal expires after this duration
///
/// # Returns
/// Unique proposal ID
///
/// # Panics
/// - If threshold < 1
/// - If threshold > number of signers
pub fn create_proposal(
    env: &Env,
    group_id: u64,
    action: Symbol,
    signers: Vec<Address>,
    threshold: u32,
    ttl_seconds: u64,
) -> u64 {
    assert!(threshold >= 1, "threshold must be >= 1");
    assert!(threshold <= signers.len() as u32, "threshold exceeds signer count");

    let id: u64 = env.storage().instance().get(&next_id_key(env)).unwrap_or(0u64);
    let now = env.ledger().timestamp();

    let proposal = MultiSigProposal {
        id,
        group_id,
        action,
        threshold,
        signers,
        signed_count: 0,
        executed: false,
        expires_at: now + ttl_seconds,
        created_at: now,
    };

    env.storage().instance().set(&proposal_key(env, id), &proposal);
    env.storage().instance().set(&next_id_key(env), &(id + 1));
    id
}

/// Sign a proposal. Returns true when threshold is reached.
///
/// # Arguments
/// * `env` - Soroban environment
/// * `proposal_id` - Proposal to sign
/// * `signer` - Address performing the signature (must be authorized signer)
///
/// # Returns
/// `true` if signature count now meets threshold (proposal ready for execution)
/// `false` if more signatures needed
///
/// # Security Note
/// - Requires authentication from `signer` (Soroban SDK enforces this via `require_auth()`)
/// - Duplicate signatures rejected (each signer signs exactly once)
/// - Cannot sign expired or already-executed proposals
/// - Only authorized signers (from original proposal creation) can sign
///
/// # Panics
/// - If proposal not found
/// - If proposal already executed
/// - If proposal expired
/// - If signer not in authorized signers list
/// - If signer already signed this proposal
pub fn sign_proposal(env: &Env, proposal_id: u64, signer: Address) -> bool {
    signer.require_auth();

    let key = proposal_key(env, proposal_id);
    let mut proposal: MultiSigProposal = env.storage().instance().get(&key)
        .expect("proposal not found");

    assert!(!proposal.executed, "already executed");
    assert!(env.ledger().timestamp() <= proposal.expires_at, "proposal expired");
    assert!(proposal.signers.contains(&signer), "not an authorized signer");

    let signed_key = has_signed_key(env, proposal_id, &signer);
    let already_signed: bool = env.storage().instance().get(&signed_key).unwrap_or(false);
    assert!(!already_signed, "already signed");

    env.storage().instance().set(&signed_key, &true);
    proposal.signed_count += 1;
    let ready = proposal.signed_count >= proposal.threshold;
    env.storage().instance().set(&key, &proposal);
    ready
}

/// Mark a proposal as executed.
///
/// # ⚠️ CRITICAL SECURITY NOTE (Issue #979)
///
/// **This function must be called as the LAST step after the underlying action succeeds.**
///
/// ## CEI Ordering Requirements
///
/// When implementing proposal execution in a contract entrypoint:
///
/// ```ignore
/// // ✅ CORRECT CEI ORDER:
/// pub fn execute_privileged_action(env: Env, proposal_id: u64) -> Result<(), Error> {
///     // 1. CHECKS PHASE
///     let proposal = get_proposal(&env, proposal_id).ok_or(Error::NotFound)?;
///     assert!(proposal.signed_count >= proposal.threshold);
///     // Validate the specific action
///     let target_group = storage::get_group(&env, proposal.group_id)?;
///     validate_action(&target_group)?;
///
///     // 2. EFFECTS PHASE - Update ALL internal state BEFORE execute_proposal()
///     let mut target_group = storage::get_group(&env, proposal.group_id)?;
///     target_group.some_state = new_value;
///     storage::store_group(&env, proposal.group_id, &target_group)?;
///     storage::record_action(&env, proposal_id, success_info)?;
///
///     // 3. EXECUTE PROPOSAL - CRITICAL: Call this LAST, after all state updates
///     execute_proposal(&env, proposal_id);  // <-- Always last!
///
///     // 4. INTERACTIONS PHASE - External calls after proposal is executed
///     // (But ensure state is finalized first in step 2)
///
///     Ok(())
/// }
/// ```
///
/// ## Failure Scenarios
///
/// ### Scenario 1: ✅ Action fails before execute_proposal (SAFE)
/// ```ignore
/// validate_action(&target_group)?;  // <- fails here
/// // Proposal is NOT marked executed
/// // Transaction reverts atomically
/// // Proposal remains in "signed but not executed" state for retry
/// ```
///
/// ### Scenario 2: ❌ Action fails after execute_proposal (DANGEROUS)
/// ```ignore
/// execute_proposal(&env, proposal_id);  // <- marks as executed
/// some_failing_operation()?;            // <- then fails here
/// // Proposal marked as executed but action never happened!
/// // Transaction reverts atomically (Soroban ensures this)
/// // BUT: On retry, proposal cannot be re-executed (executed flag is set)
/// // RESULT: Permanently stuck proposal, no recovery path
/// ```
///
/// ### Scenario 3: ✅ Action succeeds, execute_proposal called (CORRECT)
/// ```ignore
/// storage::store_group(...)?;      // <- succeeds
/// execute_proposal(&env, ...);     // <- marks executed
/// // Everything succeeded
/// // Proposal is properly marked executed
/// // No retry needed
/// ```
///
/// ## Why This Matters
///
/// Soroban provides **atomicity guarantees**: if any operation in a transaction fails,
/// the entire transaction reverts and all state changes are rolled back.
///
/// However, if `execute_proposal()` is called BEFORE the underlying action:
/// - `execute_proposal()` succeeds and state is written
/// - The underlying action then fails
/// - Transaction reverts (atomicity guarantee)
/// - BUT: The proposal remains marked as `executed` in pre-revert state
/// - On next attempt: Cannot re-execute (already marked executed)
/// - On next attempt: Cannot collect more signatures (already executed)
/// - Result: **Permanently stuck proposal with no clean recovery**
///
/// By calling `execute_proposal()` LAST:
/// - All state changes happen together
/// - If anything fails, entire transaction reverts
/// - Proposal remains in "ready" state for retry
/// - Recovery is automatic: retry the entire transaction
///
/// # Arguments
/// * `env` - Soroban environment
/// * `proposal_id` - ID of proposal to mark executed
///
/// # Panics
/// - If proposal not found
/// - If proposal already executed (guard prevents double execution)
/// - If threshold not yet reached
///
/// # Guarantees
/// - Idempotent guard: panics if called twice (prevents accidental double-execution)
/// - Atomic: either fully succeeds or fully reverts with transaction
pub fn execute_proposal(env: &Env, proposal_id: u64) {
    let key = proposal_key(env, proposal_id);
    let mut proposal: MultiSigProposal = env.storage().instance().get(&key)
        .expect("proposal not found");

    assert!(!proposal.executed, "already executed");
    assert!(proposal.signed_count >= proposal.threshold, "threshold not reached");

    proposal.executed = true;
    env.storage().instance().set(&key, &proposal);
}

/// Verify a proposal is ready for execution without modifying state.
///
/// # Arguments
/// * `env` - Soroban environment
/// * `proposal_id` - Proposal to check
///
/// # Returns
/// - `Ok(())` if proposal exists, threshold reached, and not yet executed
/// - `Err` messages if proposal not found, not ready, or already executed
///
/// # Use Case
/// Call this during CHECKS phase to validate proposal state before proceeding
/// with effects/execution phases.
pub fn verify_proposal_ready(env: &Env, proposal_id: u64) -> Result<(), &'static str> {
    let proposal: MultiSigProposal = env.storage().instance().get(&proposal_key(env, proposal_id))
        .ok_or("proposal not found")?;

    if proposal.executed {
        return Err("already executed");
    }

    if proposal.signed_count < proposal.threshold {
        return Err("threshold not reached");
    }

    if env.ledger().timestamp() > proposal.expires_at {
        return Err("proposal expired");
    }

    Ok(())
}

/// Fetch a proposal by ID (read-only).
///
/// # Arguments
/// * `env` - Soroban environment
/// * `proposal_id` - Proposal to fetch
///
/// # Returns
/// `Some(proposal)` if found, `None` otherwise
pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<MultiSigProposal> {
    env.storage().instance().get(&proposal_key(env, proposal_id))
}
