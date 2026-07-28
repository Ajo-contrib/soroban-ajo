#![cfg(test)]

//! Regression tests for issue #801: dispute resolution and voting fairness.
//!
//! Covers the manipulation vectors found while auditing `file_dispute`,
//! `vote_on_dispute`, `resolve_dispute`, and `vote_refund`/`execute_refund`:
//! quorum-of-one approvals, a defendant voting on their own case, a
//! self-filed dispute, and a rejected vote permanently blocking future
//! requests. See `contracts/ajo/docs/DISPUTE_VOTING_FAIRNESS_AUDIT.md` for
//! the full analysis.

use soroban_ajo::{
    AjoContract, AjoContractClient, AjoError, DisputeResolution, DisputeStatus, DisputeType,
    GroupState,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, String as SorobanString,
};

fn setup(env: &Env, member_count: usize) -> (AjoContractClient<'static>, Vec<Address>, Address) {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(env, &contract_id);
    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract(token_admin);

    let members: Vec<Address> = (0..member_count).map(|_| Address::generate(env)).collect();
    (client, members, token)
}

fn evidence(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

// ============================================================================
// Dispute filing / voting fairness
// ============================================================================

#[test]
fn test_cannot_file_dispute_against_self() {
    let env = Env::default();
    let (client, members, token) = setup(&env, 2);

    let group_id = client.create_group(
        &members[0], &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32,
    );
    client.join_group(&members[1], &group_id);

    let result = client.try_file_dispute(
        &members[0],
        &group_id,
        &members[0],
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "self dispute"),
        &evidence(&env),
        &DisputeResolution::Refund,
    );
    assert_eq!(result, Err(Ok(AjoError::Unauthorized)));
}

#[test]
fn test_defendant_cannot_vote_on_own_dispute() {
    let env = Env::default();
    let (client, members, token) = setup(&env, 3);

    let group_id = client.create_group(
        &members[0], &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32,
    );
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    let dispute_id = client.file_dispute(
        &members[0],
        &group_id,
        &members[1],
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );

    // members[1] is the defendant and cannot vote on their own case.
    let result = client.try_vote_on_dispute(&members[1], &dispute_id, &true);
    assert_eq!(result, Err(Ok(AjoError::Unauthorized)));
}

#[test]
fn test_dispute_single_vote_cannot_force_resolution_in_large_group() {
    // A 10-member group: only the complainant votes. Before the quorum fix,
    // 1 vote for / 0 against was 100% approval - enough to clear the 66%
    // threshold and apply the proposed resolution against the defendant,
    // regardless of what the other 8 eligible voters think.
    let env = Env::default();
    let (client, members, token) = setup(&env, 10);

    let group_id = client.create_group(
        &members[0], &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32,
    );
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    let dispute_id = client.file_dispute(
        &members[0],
        &group_id,
        &members[1],
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Removal,
    );

    // Only the complainant votes.
    client.vote_on_dispute(&members[0], &dispute_id, &true);

    env.ledger().with_mut(|li| li.timestamp += 7 * 86400 + 1);
    client.resolve_dispute(&members[0], &dispute_id);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Rejected, "1 of 9 eligible voters is not quorum");
    assert_eq!(dispute.final_resolution, DisputeResolution::NoAction);

    // The defendant was NOT removed.
    let group = client.get_group(&group_id);
    assert_eq!(group.members.len(), 10);
}

#[test]
fn test_dispute_meets_quorum_with_half_of_eligible_voters() {
    // 10 members, defendant excluded leaves 9 eligible voters; quorum needs
    // at least half (5). With exactly 5 voting unanimously in favor, the
    // dispute should resolve and apply.
    let env = Env::default();
    let (client, members, token) = setup(&env, 10);

    let group_id = client.create_group(
        &members[0], &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32,
    );
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    let dispute_id = client.file_dispute(
        &members[0],
        &group_id,
        &members[1],
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Removal,
    );

    for i in [0, 2, 3, 4, 5] {
        client.vote_on_dispute(&members[i], &dispute_id, &true);
    }

    env.ledger().with_mut(|li| li.timestamp += 7 * 86400 + 1);
    client.resolve_dispute(&members[0], &dispute_id);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Resolved);
    assert_eq!(dispute.final_resolution, DisputeResolution::Removal);

    let group = client.get_group(&group_id);
    assert_eq!(group.members.len(), 9, "defendant should have been removed");
}

#[test]
fn test_dispute_tied_vote_resolves_to_rejected_not_stuck() {
    let env = Env::default();
    let (client, members, token) = setup(&env, 4);

    let group_id = client.create_group(
        &members[0], &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32,
    );
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    let dispute_id = client.file_dispute(
        &members[0],
        &group_id,
        &members[1],
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );

    // 3 eligible voters (members[0], members[2], members[3]); members[1] is
    // the defendant and can't vote. A 1-for/1-against split is a tie among
    // votes cast (50% < 66% threshold) but still meets quorum (2 of 3).
    client.vote_on_dispute(&members[0], &dispute_id, &true);
    client.vote_on_dispute(&members[2], &dispute_id, &false);

    env.ledger().with_mut(|li| li.timestamp += 7 * 86400 + 1);

    // resolve_dispute must return Ok and leave the dispute in a final state -
    // never an error, never stuck "Voting" forever.
    client.resolve_dispute(&members[3], &dispute_id);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Rejected);
    assert_eq!(dispute.final_resolution, DisputeResolution::NoAction);
}

// ============================================================================
// Refund vote quorum
// ============================================================================

fn setup_refund_group(env: &Env, member_count: usize) -> (AjoContractClient<'static>, Vec<Address>, u64) {
    let (client, members, token) = setup(env, member_count);

    let group_id = client.create_group(
        &members[0], &token, &10_000_000i128, &604_800u64, &(member_count as u32), &86400u64, &5u32, &0u32,
    );
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    let token_admin_client = token::StellarAssetClient::new(env, &token);
    for member in &members {
        token_admin_client.mint(member, &1_000_000_000i128);
        client.contribute(member, &group_id);
    }

    env.ledger().with_mut(|li| li.timestamp += 604_800 + 86400 + 1);
    (client, members, group_id)
}

#[test]
fn test_refund_single_vote_cannot_force_cancellation_in_large_group() {
    // A 10-member group: only the requester votes in favor. Before the
    // quorum fix, 1-for/0-against was 100% approval - enough to clear the
    // 51% threshold and cancel the whole group's cycle unilaterally.
    let env = Env::default();
    let (client, members, group_id) = setup_refund_group(&env, 10);

    client.request_refund(&members[0], &group_id);
    client.vote_refund(&members[0], &group_id, &true);

    env.ledger().with_mut(|li| li.timestamp += 604_800 + 1);
    client.execute_refund(&members[0], &group_id);

    let request = client.get_refund_request(&group_id);
    assert!(request.executed);
    assert!(!request.approved, "1 of 10 members voting is not quorum");

    let group = client.get_group(&group_id);
    assert_eq!(group.state, GroupState::Active, "group must not be cancelled without quorum");
}

#[test]
fn test_refund_meets_quorum_with_half_of_members() {
    let env = Env::default();
    let (client, members, group_id) = setup_refund_group(&env, 10);

    client.request_refund(&members[0], &group_id);
    for i in 0..5 {
        client.vote_refund(&members[i], &group_id, &true);
    }

    env.ledger().with_mut(|li| li.timestamp += 604_800 + 1);
    client.execute_refund(&members[0], &group_id);

    let request = client.get_refund_request(&group_id);
    assert!(request.executed);
    assert!(request.approved);

    let group = client.get_group(&group_id);
    assert_eq!(group.state, GroupState::Cancelled);
}

#[test]
fn test_rejected_refund_vote_allows_new_request() {
    // A refund request that fails quorum or approval must be a final,
    // resolved outcome - not a permanent block on ever requesting again.
    let env = Env::default();
    let (client, members, group_id) = setup_refund_group(&env, 3);

    client.request_refund(&members[0], &group_id);
    client.vote_refund(&members[0], &group_id, &true);
    client.vote_refund(&members[1], &group_id, &false);
    client.vote_refund(&members[2], &group_id, &false);

    env.ledger().with_mut(|li| li.timestamp += 604_800 + 1);
    client.execute_refund(&members[0], &group_id);

    let request = client.get_refund_request(&group_id);
    assert!(request.executed);
    assert!(!request.approved);

    // A brand new refund request should be accepted, not rejected with
    // RefundRequestExists.
    client.request_refund(&members[1], &group_id);
    let new_request = client.get_refund_request(&group_id);
    assert_eq!(new_request.requester, members[1]);
    assert!(!new_request.executed);
}
