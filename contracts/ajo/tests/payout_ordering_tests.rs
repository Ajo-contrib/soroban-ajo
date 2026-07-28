#![cfg(test)]

use soroban_ajo::{AjoContract, AjoContractClient, AjoError, PayoutOrderingStrategy};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

fn setup_test_env() -> (Env, AjoContractClient<'static>, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    let token = Address::generate(&env);
    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);
    let member3 = Address::generate(&env);

    (env, client, token, creator, member2, member3)
}

#[test]
fn test_create_group_with_ordering_persists_strategy() {
    let (_env, client, token, creator, _, _) = setup_test_env();

    let group_id = client.create_group_with_ordering(
        &creator,
        &token,
        &1000i128,
        &86400u64,
        &5u32,
        &3600u64,
        &5u32,
        &0u32,
        &PayoutOrderingStrategy::Random,
    );

    let group = client.get_group(&group_id);
    assert_eq!(group.payout_strategy, PayoutOrderingStrategy::Random);
}

#[test]
fn test_voting_strategy_status_uses_vote_winner() {
    let (env, client, token, creator, member2, member3) = setup_test_env();

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_700_000_000;
        ledger.sequence_number = 77;
    });

    let group_id = client.create_group_with_ordering(
        &creator,
        &token,
        &1000i128,
        &86400u64,
        &3u32,
        &3600u64,
        &5u32,
        &0u32,
        &PayoutOrderingStrategy::VotingBased,
    );

    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    client.vote_for_next_recipient(&creator, &group_id, &member3);
    client.vote_for_next_recipient(&member2, &group_id, &member3);

    let status = client.get_group_status(&group_id);
    assert_eq!(status.has_next_recipient, true);
    assert_eq!(status.next_recipient, member3);
}

#[test]
fn test_vote_for_next_recipient_rejects_non_voting_groups() {
    let (_env, client, token, creator, member2, _) = setup_test_env();

    let group_id = client.create_group_with_ordering(
        &creator,
        &token,
        &1000i128,
        &86400u64,
        &3u32,
        &3600u64,
        &5u32,
        &0u32,
        &PayoutOrderingStrategy::Sequential,
    );

    client.join_group(&member2, &group_id);

    let result = client.try_vote_for_next_recipient(&creator, &group_id, &member2);
    assert_eq!(result, Err(Ok(AjoError::VotingNotOpen)));
}

#[test]
fn test_random_strategy_status_returns_eligible_member() {
    let (env, client, token, creator, member2, member3) = setup_test_env();

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_700_000_123;
        ledger.sequence_number = 99;
    });

    let group_id = client.create_group_with_ordering(
        &creator,
        &token,
        &1000i128,
        &86400u64,
        &3u32,
        &3600u64,
        &5u32,
        &0u32,
        &PayoutOrderingStrategy::Random,
    );

    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    let status = client.get_group_status(&group_id);
    assert_eq!(status.has_next_recipient, true);
    assert!(
        status.next_recipient == creator
            || status.next_recipient == member2
            || status.next_recipient == member3
    );
}
