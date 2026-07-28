#![cfg(test)]

//! Upgrade/storage migration regression tests.
//!
//! These tests document the current v1 policy: upgrades may only declare the
//! storage schema already stamped into instance storage. A future test should be
//! added beside this one when a real v1->v2 migration exists.

use soroban_ajo::{AjoContract, AjoContractClient, AjoError};
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env};

fn setup() -> (Env, AjoContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);
    (env, client, admin, token_id)
}

#[test]
fn populated_state_rejects_incompatible_upgrade_schema_and_remains_readable() {
    let (env, client, admin, token_id) = setup();
    let creator = Address::generate(&env);
    let member = Address::generate(&env);

    let group_id = client.create_group(
        &creator,
        &token_id,
        &100_000_000i128,
        &604_800u64,
        &2u32,
        &86_400u64,
        &5u32,
        &0u32,
    );
    client.join_group(&member, &group_id);

    let token_client = token::StellarAssetClient::new(&env, &token_id);
    token_client.mint(&creator, &100_000_000i128);
    client.contribute(&creator, &group_id);

    let before = client.get_group(&group_id);
    assert_eq!(client.storage_schema_version(), 1);

    let wasm_hash = BytesN::from_array(&env, &[7u8; 32]);
    let result = client.try_upgrade(&admin, &wasm_hash, &2u32);
    assert_eq!(result, Err(Ok(AjoError::SchemaMismatch)));

    let after = client.get_group(&group_id);
    assert_eq!(before, after);
    assert_eq!(after.members.len(), 2);
    assert_eq!(after.current_cycle, 1);
}
