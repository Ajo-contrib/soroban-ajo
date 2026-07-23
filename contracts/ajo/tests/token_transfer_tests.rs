#![cfg(test)]

//! Token transfer integration tests
//!
//! These tests verify that token transfers work correctly for contributions,
//! payouts, and refunds using the Stellar Asset Contract interface.

use soroban_ajo::{AjoContract, AjoContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

/// Helper function to create a test environment with token contract
fn setup_test_env_with_token() -> (Env, AjoContractClient<'static>, Address, token::Client<'static>, token::StellarAssetClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    // Register and initialize the Ajo contract
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    // Create admin and initialize contract
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Register a token contract
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token_client = token::Client::new(&env, &token_id);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

    (env, client, token_id, token_client, token_admin_client)
}

#[test]
fn test_contribute_with_token_transfer() {
    let (env, client, token_id, token_client, token_admin_client) = setup_test_env_with_token();

    // Create members
    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);

    // Mint tokens to members
    let contribution = 100_000_000i128; // 10 XLM equivalent
    token_admin_client.mint(&creator, &(contribution * 10));
    token_admin_client.mint(&member2, &(contribution * 10));

    // Create group with token
    let group_id = client.create_group(
        &creator,
        &token_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Join group
    client.join_group(&member2, &group_id);

    // Get contract address
    let contract_address = client.address.clone();

    // Check initial balances
    let creator_balance_before = token_client.balance(&creator);
    let contract_balance_before = token_client.balance(&contract_address);

    // Contribute
    client.contribute(&creator, &group_id);

    // Verify token transfer occurred
    let creator_balance_after = token_client.balance(&creator);
    let contract_balance_after = token_client.balance(&contract_address);

    assert_eq!(
        creator_balance_before - contribution,
        creator_balance_after
    );
    assert_eq!(
        contract_balance_before + contribution,
        contract_balance_after
    );
}

#[test]
fn test_payout_with_token_transfer() {
    let (env, client, token_id, token_client, token_admin_client) = setup_test_env_with_token();

    // Create members
    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);

    // Mint tokens to members
    let contribution = 100_000_000i128;
    token_admin_client.mint(&creator, &(contribution * 10));
    token_admin_client.mint(&member2, &(contribution * 10));

    // Create group
    let group_id = client.create_group(
        &creator,
        &token_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Join group
    client.join_group(&member2, &group_id);

    // Both members contribute
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Get contract address
    let contract_address = client.address.clone();

    // Check balances before payout
    let creator_balance_before = token_client.balance(&creator);
    let contract_balance_before = token_client.balance(&contract_address);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Execute payout
    client.execute_payout(&group_id);

    // Verify token transfer occurred
    let creator_balance_after = token_client.balance(&creator);
    let contract_balance_after = token_client.balance(&contract_address);

    let expected_payout = contribution * 2; // Both members contributed
    assert_eq!(
        creator_balance_before + expected_payout,
        creator_balance_after
    );
    assert_eq!(
        contract_balance_before - expected_payout,
        contract_balance_after
    );
}

#[test]
fn test_full_cycle_with_token_transfers() {
    let (env, client, token_id, token_client, token_admin_client) = setup_test_env_with_token();

    // Create 3 members
    let members: Vec<Address> = (0..3).map(|_| Address::generate(&env)).collect();

    // Mint tokens to all members
    let contribution = 50_000_000i128;
    for member in &members {
        token_admin_client.mint(member, &(contribution * 10));
    }

    // Create group
    let group_id = client.create_group(
        &members[0],
        &token_id,
        &contribution,
        &604_800u64,
        &3u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Join group
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Complete all cycles
    for cycle in 0..3 {
        // All members contribute
        for member in &members {
            client.contribute(member, &group_id);
        }

        // Advance time
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 604_800 + 86400 + 1;
        });

        // Get recipient balance before payout
        let recipient = &members[cycle];
        let balance_before = token_client.balance(recipient);

        // Execute payout
        client.execute_payout(&group_id);

        // Verify payout received
        let balance_after = token_client.balance(recipient);
        let expected_payout = contribution * 3;
        assert_eq!(balance_before + expected_payout, balance_after);
    }

    // Verify group is complete
    let group = client.get_group(&group_id);
    assert_eq!(group.is_complete, true);
}

#[test]
fn test_cancel_group_with_refunds() {
    let (env, client, token_id, token_client, token_admin_client) = setup_test_env_with_token();

    // Create members
    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);

    // Mint tokens
    let contribution = 100_000_000i128;
    token_admin_client.mint(&creator, &(contribution * 10));
    token_admin_client.mint(&member2, &(contribution * 10));

    // Create group
    let group_id = client.create_group(
        &creator,
        &token_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Join group
    client.join_group(&member2, &group_id);

    // Both contribute
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Get balances before cancellation
    let creator_balance_before = token_client.balance(&creator);
    let member2_balance_before = token_client.balance(&member2);

    // Cancel group
    client.cancel_group(&creator, &group_id);

    // Verify refunds
    let creator_balance_after = token_client.balance(&creator);
    let member2_balance_after = token_client.balance(&member2);

    assert_eq!(creator_balance_before + contribution, creator_balance_after);
    assert_eq!(member2_balance_before + contribution, member2_balance_after);
}

#[test]
fn test_multiple_token_types() {
    let env = Env::default();
    env.mock_all_auths();

    // Register Ajo contract
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    // Initialize contract
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Create two different tokens
    let token1_admin = Address::generate(&env);
    let token1_id = env.register_stellar_asset_contract(token1_admin.clone());
    let token1_client = token::Client::new(&env, &token1_id);
    let token1_admin_client = token::StellarAssetClient::new(&env, &token1_id);

    let token2_admin = Address::generate(&env);
    let token2_id = env.register_stellar_asset_contract(token2_admin.clone());
    let token2_client = token::Client::new(&env, &token2_id);
    let token2_admin_client = token::StellarAssetClient::new(&env, &token2_id);

    // Create members
    let creator1 = Address::generate(&env);
    let creator2 = Address::generate(&env);

    // Mint different tokens
    let contribution = 100_000_000i128;
    token1_admin_client.mint(&creator1, &(contribution * 10));
    token2_admin_client.mint(&creator2, &(contribution * 10));

    // Create groups with different tokens
    let group1_id = client.create_group(
        &creator1,
        &token1_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    let group2_id = client.create_group(
        &creator2,
        &token2_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Verify groups have different tokens
    let group1 = client.get_group(&group1_id);
    let group2 = client.get_group(&group2_id);

    assert_eq!(group1.token_address, token1_id);
    assert_eq!(group2.token_address, token2_id);
}

#[test]
fn test_get_contract_balance() {
    let (env, client, token_id, token_client, token_admin_client) = setup_test_env_with_token();

    // Create member
    let creator = Address::generate(&env);

    // Mint tokens
    let contribution = 100_000_000i128;
    token_admin_client.mint(&creator, &(contribution * 10));

    // Create group
    let group_id = client.create_group(
        &creator,
        &token_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Check initial contract balance
    let balance_before = client.get_contract_balance(&token_id);
    assert_eq!(balance_before, 0);

    // Contribute
    client.contribute(&creator, &group_id);

    // Check contract balance after contribution
    let balance_after = client.get_contract_balance(&token_id);
    assert_eq!(balance_after, contribution);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_contribute_insufficient_balance() {
    let (env, client, token_id, _token_client, token_admin_client) = setup_test_env_with_token();

    // Create member
    let creator = Address::generate(&env);

    // Mint insufficient tokens
    let contribution = 100_000_000i128;
    token_admin_client.mint(&creator, &(contribution / 2)); // Only half needed

    // Create group
    let group_id = client.create_group(
        &creator,
        &token_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Try to contribute (should fail)
    client.contribute(&creator, &group_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_payout_insufficient_contract_balance() {
    let (env, client, token_id, token_client, token_admin_client) = setup_test_env_with_token();

    // Create members
    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);

    // Mint tokens
    let contribution = 100_000_000i128;
    token_admin_client.mint(&creator, &(contribution * 10));
    token_admin_client.mint(&member2, &(contribution * 10));

    // Create group
    let group_id = client.create_group(
        &creator,
        &token_id,
        &contribution,
        &604_800u64,
        &2u32,
        &86400u64,
        &5u32,
        &0u32,
    );

    // Join group
    client.join_group(&member2, &group_id);

    // Both members contribute so `execute_payout` gets past the
    // all-contributed check and reaches the balance-dependent transfer.
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Drain the contract's balance out from under it so the payout transfer
    // itself fails with InsufficientContractBalance.
    let contract_address = client.address.clone();
    let contract_balance = token_client.balance(&contract_address);
    token_client.transfer(&contract_address, &creator, &contract_balance);

    // Advance time
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Try to execute payout (should fail due to insufficient balance)
    client.execute_payout(&group_id);
}
