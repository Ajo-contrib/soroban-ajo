#![cfg(test)]

use soroban_ajo::{AjoContract, AjoContractClient, AjoError};
use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, Env};

/// Mints `amount` of `token_id` to each address in `members` so they can
/// satisfy `contribute()`'s balance check.
fn mint_tokens(env: &Env, token_id: &Address, members: &[Address], amount: i128) {
    let token_client = token::StellarAssetClient::new(env, token_id);
    for member in members {
        token_client.mint(member, &amount);
    }
}

/// Helper function to create a test environment and contract
fn setup_test_env() -> (Env, AjoContractClient<'static>, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    // Generate test addresses
    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);
    let member3 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    // Fund every generated member so `contribute()` calls in tests have balance to transfer.
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    for member in [&creator, &member2, &member3] {
        token_admin_client.mint(member, &1_000_000_000i128);
    }

    (env, client, creator, member2, member3, token)
}

#[test]
fn test_cancel_group_before_payout() {
    let (_env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Members join
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Members contribute
    mint_tokens(&_env, &token, &[creator.clone(), member2.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Creator cancels group
    client.cancel_group(&creator, &group_id);

    // Verify group is cancelled
    let group = client.get_group(&group_id);
    assert_eq!(group.state, soroban_ajo::GroupState::Cancelled);

    // Verify refund records exist
    let refund1 = client.get_refund_record(&group_id, &creator);
    assert_eq!(refund1.amount, 100_000_000i128);
    assert_eq!(refund1.reason, soroban_ajo::RefundReason::CreatorCancellation);

    let refund2 = client.get_refund_record(&group_id, &member2);
    assert_eq!(refund2.amount, 100_000_000i128);
}

#[test]
fn test_cannot_cancel_after_payout() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Members join
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // All contribute
    mint_tokens(&env, &token, &[creator.clone(), member2.clone(), member3.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);

    // Advance time and execute payout
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    client.execute_payout(&group_id);

    // Try to cancel - should fail
    let result = client.try_cancel_group(&creator, &group_id);
    assert_eq!(result, Err(Ok(AjoError::CannotCancelAfterPayout)));
}

#[test]
fn test_only_creator_can_cancel() {
    let (_env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Member joins
    client.join_group(&member2, &group_id);

    // Non-creator tries to cancel - should fail
    let result = client.try_cancel_group(&member2, &group_id);
    assert_eq!(result, Err(Ok(AjoError::OnlyCreatorCanCancel)));
}

#[test]
fn test_request_refund_after_cycle_expires() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Members join
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Only some members contribute
    mint_tokens(&env, &token, &[creator.clone(), member2.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Request refund
    client.request_refund(&creator, &group_id);

    // Verify refund request exists
    let request = client.get_refund_request(&group_id);
    assert_eq!(request.requester, creator);
    assert_eq!(request.votes_for, 0);
    assert_eq!(request.votes_against, 0);
}

#[test]
fn test_cannot_request_refund_before_cycle_expires() {
    let (_env, client, creator, member2, _, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Member joins
    client.join_group(&member2, &group_id);

    // Try to request refund before cycle expires - should fail
    let result = client.try_request_refund(&creator, &group_id);
    assert_eq!(result, Err(Ok(AjoError::CycleNotExpired)));
}

#[test]
fn test_voting_on_refund_request() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Members join
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Contribute
    mint_tokens(&env, &token, &[creator.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Request refund
    client.request_refund(&creator, &group_id);

    // Members vote
    client.vote_refund(&creator, &group_id, &true);
    client.vote_refund(&member2, &group_id, &true);
    client.vote_refund(&member3, &group_id, &false);

    // Check vote counts
    let request = client.get_refund_request(&group_id);
    assert_eq!(request.votes_for, 2);
    assert_eq!(request.votes_against, 1);
}

#[test]
fn test_cannot_vote_twice() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Member joins
    client.join_group(&member2, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Request refund
    client.request_refund(&creator, &group_id);

    // Vote once
    client.vote_refund(&creator, &group_id, &true);

    // Try to vote again - should fail
    let result = client.try_vote_refund(&creator, &group_id, &false);
    assert_eq!(result, Err(Ok(AjoError::AlreadyVoted)));
}

#[test]
fn test_execute_approved_refund() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Members join
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // All contribute
    mint_tokens(&env, &token, &[creator.clone(), member2.clone(), member3.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Request refund
    client.request_refund(&creator, &group_id);

    // All vote in favor (100% approval)
    client.vote_refund(&creator, &group_id, &true);
    client.vote_refund(&member2, &group_id, &true);
    client.vote_refund(&member3, &group_id, &true);

    // Advance time past voting period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 1; // 7 days + 1 second
    });

    // Execute refund
    client.execute_refund(&creator, &group_id);

    // Verify group is cancelled
    let group = client.get_group(&group_id);
    assert_eq!(group.state, soroban_ajo::GroupState::Cancelled);

    // Verify refund records
    let refund1 = client.get_refund_record(&group_id, &creator);
    assert_eq!(refund1.reason, soroban_ajo::RefundReason::MemberVote);
}

#[test]
fn test_execute_rejected_refund() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Members join
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Request refund
    client.request_refund(&creator, &group_id);

    // Majority votes against (33% approval)
    client.vote_refund(&creator, &group_id, &true);
    client.vote_refund(&member2, &group_id, &false);
    client.vote_refund(&member3, &group_id, &false);

    // Advance time past voting period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 1;
    });

    // A rejected vote is a final outcome, not an error - it succeeds and
    // records the rejection so a new refund request can be raised later.
    client.execute_refund(&creator, &group_id);
    let request = client.get_refund_request(&group_id);
    assert!(request.executed);
    assert!(!request.approved);

    let group = client.get_group(&group_id);
    assert_eq!(group.state, soroban_ajo::GroupState::Active);
}

#[test]
fn test_cannot_execute_before_voting_ends() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Member joins
    client.join_group(&member2, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Request refund
    client.request_refund(&creator, &group_id);

    // Vote
    client.vote_refund(&creator, &group_id, &true);

    // Try to execute before voting period ends - should fail
    let result = client.try_execute_refund(&creator, &group_id);
    assert_eq!(result, Err(Ok(AjoError::VotingPeriodActive)));
}

#[test]
fn test_emergency_refund_by_admin() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    // Initialize contract with admin
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Member joins and contributes
    client.join_group(&member2, &group_id);
    mint_tokens(&env, &token, &[creator.clone(), member2.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Admin executes emergency refund
    client.emergency_refund(&admin, &group_id);

    // Verify group is cancelled
    let group = client.get_group(&group_id);
    assert_eq!(group.state, soroban_ajo::GroupState::Cancelled);

    // Verify refund records
    let refund1 = client.get_refund_record(&group_id, &creator);
    assert_eq!(refund1.reason, soroban_ajo::RefundReason::EmergencyRefund);
}

#[test]
fn test_non_admin_cannot_emergency_refund() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    // Initialize contract with admin
    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Non-admin tries emergency refund - should fail
    let result = client.try_emergency_refund(&member2, &group_id);
    assert_eq!(result, Err(Ok(AjoError::Unauthorized)));
}

#[test]
fn test_cannot_contribute_to_cancelled_group() {
    let (_env, client, creator, member2, _, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Member joins
    client.join_group(&member2, &group_id);

    // Creator contributes and cancels
    mint_tokens(&_env, &token, &[creator.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);
    client.cancel_group(&creator, &group_id);

    // Try to contribute to cancelled group - should fail
    let result = client.try_contribute(&member2, &group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupCancelled)));
}

#[test]
fn test_cannot_execute_payout_on_cancelled_group() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Members join and contribute
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);
    mint_tokens(&env, &token, &[creator.clone(), member2.clone(), member3.clone()], 100_000_000i128);
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);

    // Cancel group
    client.cancel_group(&creator, &group_id);

    // Advance time
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Try to execute payout - should fail
    let result = client.try_execute_payout(&group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupCancelled)));
}

#[test]
fn test_refund_request_duplicate_prevention() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    
    // Member joins
    client.join_group(&member2, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });

    // Request refund
    client.request_refund(&creator, &group_id);

    // Try to request again - should fail
    let result = client.try_request_refund(&member2, &group_id);
    assert_eq!(result, Err(Ok(AjoError::RefundRequestExists)));
}
