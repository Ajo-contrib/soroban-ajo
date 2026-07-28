use soroban_sdk::{symbol_short, Address, Env};

use crate::errors::AjoError;
use crate::storage;

/// Get the current pause state from instance storage.
///
/// Returns `false` if the pause state has not been set, meaning the contract
/// starts in an unpaused state by default. This function is used internally
/// by the pausable module and can also be called directly to check the current
/// pause status.
///
/// # Arguments
/// * `env` - The contract environment used to access instance storage
///
/// # Returns
/// `true` if the contract is paused, `false` otherwise
///
/// # Storage Strategy
/// The pause state is stored in instance storage under the key "PAUSED".
/// Instance storage is appropriate for contract-level configuration because:
/// - It provides fast O(1) access
/// - It persists across contract calls and upgrades
/// - It matches the pattern used for admin storage
/// - It has lower cost than persistent storage for frequently accessed data
pub fn is_paused(env: &Env) -> bool {
    let key = symbol_short!("PAUSED");
    env.storage().instance().get(&key).unwrap_or(false)
}

/// Set the pause state in instance storage.
///
/// This is a private helper function used by `pause()` and `unpause()` to
/// update the pause state. It should not be called directly from outside
/// this module.
///
/// # Arguments
/// * `env` - The contract environment used to access instance storage
/// * `paused` - The new pause state (`true` to pause, `false` to unpause)
fn set_paused(env: &Env, paused: bool) {
    let key = symbol_short!("PAUSED");
    env.storage().instance().set(&key, &paused);
}

/// Check if the contract is paused and return an error if so.
///
/// This is the primary guard function that should be called at the beginning
/// of all state-mutating operations. It provides a fail-fast mechanism to
/// prevent any state changes when the contract is in a paused state.
///
/// # Arguments
/// * `env` - The contract environment used to check the pause state
///
/// # Returns
/// * `Ok(())` if the contract is not paused (operation can proceed)
/// * `Err(AjoError::ContractPaused)` if the contract is paused
///
/// # Usage
/// Add this check at the start of state-mutating functions:
/// ```ignore
/// pausable::ensure_not_paused(&env)?;
/// ```
pub fn ensure_not_paused(env: &Env) -> Result<(), AjoError> {
    if is_paused(env) {
        Err(AjoError::ContractPaused)
    } else {
        Ok(())
    }
}

/// Pause the contract to prevent state-mutating operations.
///
/// This function can only be called by the contract administrator. When the
/// contract is paused, all state-mutating operations (create_group, join_group,
/// contribute, execute_payout) will fail with a `ContractPaused` error. Query
/// operations and admin functions remain available during the pause.
///
/// The pause mechanism is designed for emergency situations such as:
/// - Detected security vulnerabilities
/// - Ongoing attacks or exploits
/// - Maintenance periods requiring state freeze
/// - Investigation of suspicious activity
///
/// # Arguments
/// * `env` - The contract environment used to verify admin and set pause state
/// * `caller` - Address invoking the pause; must match the stored admin
///
/// # Returns
/// * `Ok(())` if the pause was successful
/// * `Err(AjoError::Unauthorized)` if the caller is not the admin
///
/// # Authorization
/// Checked two ways: `caller` must equal the stored admin address (so a
/// mismatched caller is rejected even if `require_auth()` alone would have let
/// it through, e.g. under test tooling that mocks every address's auth), and
/// `caller.require_auth()` still enforces a real signature on a live network.
///
/// # Idempotency
/// Calling pause when already paused is safe and will succeed without error.
pub fn pause(env: &Env, caller: &Address) -> Result<(), AjoError> {
    let admin = storage::get_admin(env).ok_or(AjoError::Unauthorized)?;
    if *caller != admin {
        return Err(AjoError::Unauthorized);
    }
    caller.require_auth();

    // Set paused state
    set_paused(env, true);

    Ok(())
}

/// Unpause the contract to restore normal operations.
///
/// This function can only be called by the contract administrator. When the
/// contract is unpaused, all operations return to normal functionality. All
/// stored data (groups, contributions, payouts) remains intact and accessible.
///
/// Unpausing should be done after:
/// - The emergency situation has been resolved
/// - Security vulnerabilities have been patched
/// - Maintenance has been completed
/// - Investigation has concluded
///
/// # Arguments
/// * `env` - The contract environment used to verify admin and clear pause state
/// * `caller` - Address invoking the unpause; must match the stored admin
///
/// # Returns
/// * `Ok(())` if the unpause was successful
/// * `Err(AjoError::Unauthorized)` if the caller is not the admin
///
/// # Authorization
/// Checked two ways: `caller` must equal the stored admin address (so a
/// mismatched caller is rejected even if `require_auth()` alone would have let
/// it through, e.g. under test tooling that mocks every address's auth), and
/// `caller.require_auth()` still enforces a real signature on a live network.
///
/// # Idempotency
/// Calling unpause when already unpaused is safe and will succeed without error.
///
/// # Data Safety
/// Unpausing does not modify any stored data. All groups, contributions, and
/// payouts remain exactly as they were before the pause.
pub fn unpause(env: &Env, caller: &Address) -> Result<(), AjoError> {
    let admin = storage::get_admin(env).ok_or(AjoError::Unauthorized)?;
    if *caller != admin {
        return Err(AjoError::Unauthorized);
    }
    caller.require_auth();

    // Clear paused state
    set_paused(env, false);

    Ok(())
}
