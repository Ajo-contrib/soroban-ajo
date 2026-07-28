#![cfg(test)]

use soroban_ajo::{
    AjoContract, AjoContractClient, DisputeResolution, DisputeStatus, DisputeType,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    BytesN, Env, String as SorobanString,
};

fn setup(env: &Env) -> (AjoContractClient<'static>, soroban_sdk::Address, soroban_sdk::Address) {
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(env, &contract_id);
    let creator = soroban_sdk::Address::generate(env);
    let token = soroban_sdk::Address::generate(env);
    (client, creator, token)
}

fn evidence(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

#[test]
fn test_file_dispute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let defendant = soroban_sdk::Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);
    client.join_group(&defendant, &group_id);

    let dispute_id = client.file_dispute(
        &creator,
        &group_id,
        &defendant,
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "Test dispute"),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.id, dispute_id);
    assert_eq!(dispute.group_id, group_id);
    assert_eq!(dispute.status, DisputeStatus::Open);
}

#[test]
#[should_panic]
fn test_file_dispute_not_member() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let defendant = soroban_sdk::Address::generate(&env); // not joined

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);

    client.file_dispute(
        &creator,
        &group_id,
        &defendant,
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, ""),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );
}

#[test]
fn test_vote_on_dispute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let member1 = soroban_sdk::Address::generate(&env);
    let member2 = soroban_sdk::Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);
    client.join_group(&member1, &group_id);
    client.join_group(&member2, &group_id);

    let dispute_id = client.file_dispute(
        &creator,
        &group_id,
        &member1,
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );

    client.vote_on_dispute(&member2, &dispute_id, &true);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.votes_for_action, 1);
    assert_eq!(dispute.status, DisputeStatus::Voting);
}

#[test]
#[should_panic]
fn test_cannot_vote_twice_on_dispute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let voter = soroban_sdk::Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);
    client.join_group(&voter, &group_id);

    let dispute_id = client.file_dispute(
        &creator,
        &group_id,
        &voter,
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );

    client.vote_on_dispute(&voter, &dispute_id, &true);
    client.vote_on_dispute(&voter, &dispute_id, &false); // should panic
}

#[test]
fn test_resolve_dispute_approved() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let member1 = soroban_sdk::Address::generate(&env);
    let member2 = soroban_sdk::Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);
    client.join_group(&member1, &group_id);
    client.join_group(&member2, &group_id);

    let dispute_id = client.file_dispute(
        &creator,
        &group_id,
        &member1,
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );

    // Vote within the voting period (2/3 members = 66%)
    client.vote_on_dispute(&member2, &dispute_id, &true);
    client.vote_on_dispute(&creator, &dispute_id, &true);

    // Advance past voting deadline
    env.ledger().with_mut(|li| { li.timestamp += 7 * 86400 + 1; });

    client.resolve_dispute(&creator, &dispute_id);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Resolved);
    assert_eq!(dispute.final_resolution, DisputeResolution::Penalty);
}

#[test]
#[should_panic]
fn test_resolve_too_early() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let defendant = soroban_sdk::Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);
    client.join_group(&defendant, &group_id);

    let dispute_id = client.file_dispute(
        &creator,
        &group_id,
        &defendant,
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Penalty,
    );

    client.resolve_dispute(&creator, &dispute_id); // should panic: VotingPeriodActive
}

#[test]
fn test_removal_resolution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let defendant = soroban_sdk::Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);
    client.join_group(&defendant, &group_id);

    let dispute_id = client.file_dispute(
        &creator,
        &group_id,
        &defendant,
        &DisputeType::RuleViolation,
        &SorobanString::from_str(&env, "test"),
        &evidence(&env),
        &DisputeResolution::Removal,
    );

    client.vote_on_dispute(&creator, &dispute_id, &true);

    env.ledger().with_mut(|li| { li.timestamp += 7 * 86400 + 1; });
    client.resolve_dispute(&creator, &dispute_id);

    let group = client.get_group(&group_id);
    assert_eq!(group.members.len(), 1); // only creator remains
}

#[test]
fn test_get_group_disputes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, token) = setup(&env);
    let defendant = soroban_sdk::Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &10_000_000i128, &86400u64, &10u32, &86400u64, &5u32, &0u32);
    client.join_group(&defendant, &group_id);

    client.file_dispute(
        &creator, &group_id, &defendant,
        &DisputeType::NonPayment,
        &SorobanString::from_str(&env, "d1"),
        &evidence(&env),
        &DisputeResolution::Warning,
    );
    client.file_dispute(
        &defendant, &group_id, &creator,
        &DisputeType::PayoutDispute,
        &SorobanString::from_str(&env, "d2"),
        &evidence(&env),
        &DisputeResolution::NoAction,
    );

    let ids = client.get_group_disputes(&group_id);
    assert_eq!(ids.len(), 2);
}
