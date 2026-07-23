use soroban_sdk::{token, Address, Env};

use crate::errors::AjoError;

/// Transfer tokens from one address to another using the Stellar Asset Contract interface.
///
/// # Arguments
/// * `env` - The contract environment
/// * `token_address` - Address of the token contract
/// * `from` - Address to transfer from
/// * `to` - Address to transfer to
/// * `amount` - Amount to transfer
///
/// # Returns
/// `Ok(())` on successful transfer
///
/// Traps (does not return an `AjoError`) if the underlying token transfer fails,
/// since token clients propagate host-level errors rather than a `Result`.
pub fn transfer_token(
    env: &Env,
    token_address: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) -> Result<(), AjoError> {
    let client = token::Client::new(env, token_address);
    
    // Attempt the transfer
    client.transfer(from, to, &amount);
    
    Ok(())
}

/// Get the token balance of an address.
///
/// # Arguments
/// * `env` - The contract environment
/// * `token_address` - Address of the token contract
/// * `address` - Address to check balance for
///
/// # Returns
/// The token balance
pub fn get_balance(env: &Env, token_address: &Address, address: &Address) -> i128 {
    let client = token::Client::new(env, token_address);
    client.balance(address)
}

/// Check if an address has sufficient balance for a transfer.
///
/// # Arguments
/// * `env` - The contract environment
/// * `token_address` - Address of the token contract
/// * `address` - Address to check
/// * `amount` - Required amount
///
/// # Returns
/// `Ok(())` if balance is sufficient
///
/// # Errors
/// * `InsufficientBalance` - If balance is less than required amount
pub fn check_balance(
    env: &Env,
    token_address: &Address,
    address: &Address,
    amount: i128,
) -> Result<(), AjoError> {
    let balance = get_balance(env, token_address, address);
    if balance < amount {
        return Err(AjoError::InsufficientBalance);
    }
    Ok(())
}

/// Check if the contract has sufficient balance for a payout.
///
/// # Arguments
/// * `env` - The contract environment
/// * `token_address` - Address of the token contract
/// * `contract_address` - Address of this contract
/// * `amount` - Required payout amount
///
/// # Returns
/// `Ok(())` if contract balance is sufficient
///
/// # Errors
/// * `InsufficientContractBalance` - If contract balance is less than required amount
pub fn check_contract_balance(
    env: &Env,
    token_address: &Address,
    contract_address: &Address,
    amount: i128,
) -> Result<(), AjoError> {
    let balance = get_balance(env, token_address, contract_address);
    if balance < amount {
        return Err(AjoError::InsufficientContractBalance);
    }
    Ok(())
}
