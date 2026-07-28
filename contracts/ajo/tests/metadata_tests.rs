#![cfg(test)]

use soroban_ajo::{AjoContract, AjoContractClient, AjoError};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup_test() -> (Env, AjoContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);
    let creator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    (env, client, creator, token)
}

#[test]
fn test_set_and_get_metadata() {
    let (env, client, creator, token) = setup_test();

    let group_id = client.create_group(&creator, &token, &1000, &86400, &5, &86400u64, &5u32, &0u32);

    let name = String::from_str(&env, "Test Group");
    let description = String::from_str(&env, "A test group for esusu");
    let rules = String::from_str(&env, "Don't be late with payments");

    client.set_group_metadata(&creator, &group_id, &name, &description, &rules);

    let metadata = client.get_group_metadata(&group_id);

    assert_eq!(metadata.name, name);
    assert_eq!(metadata.description, description);
    assert_eq!(metadata.rules, rules);
}

#[test]
fn test_update_metadata() {
    let (env, client, creator, token) = setup_test();

    let group_id = client.create_group(&creator, &token, &1000, &86400, &5, &86400u64, &5u32, &0u32);

    let name1 = String::from_str(&env, "Name 1");
    let desc1 = String::from_str(&env, "Desc 1");
    let rules1 = String::from_str(&env, "Rules 1");

    client.set_group_metadata(&creator, &group_id, &name1, &desc1, &rules1);

    let name2 = String::from_str(&env, "Name 2");
    let desc2 = String::from_str(&env, "Desc 2");
    let rules2 = String::from_str(&env, "Rules 2");

    client.set_group_metadata(&creator, &group_id, &name2, &desc2, &rules2);

    let metadata = client.get_group_metadata(&group_id);
    assert_eq!(metadata.name, name2);
    assert_eq!(metadata.description, desc2);
    assert_eq!(metadata.rules, rules2);
}

#[test]
fn test_metadata_not_found() {
    let (_env, client, creator, token) = setup_test();
    let group_id = client.create_group(&creator, &token, &1000, &86400, &5, &86400u64, &5u32, &0u32);

    let result = client.try_get_group_metadata(&group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupNotFound)));
}

#[test]
fn test_set_metadata_unauthorized() {
    let (env, client, creator, token) = setup_test();
    let group_id = client.create_group(&creator, &token, &1000, &86400, &5, &86400u64, &5u32, &0u32);

    // `set_group_metadata` takes an explicit `caller` argument compared against
    // `group.creator` in contract logic, so a non-creator caller is rejected
    // even under `mock_all_auths()` (which would otherwise satisfy `require_auth`
    // for any address, defeating an auth-only check).
    let other = Address::generate(&env);

    let name = String::from_str(&env, "Hack");
    let desc = String::from_str(&env, "I am hacking");
    let rules = String::from_str(&env, "All money to me");

    let result = client.try_set_group_metadata(&other, &group_id, &name, &desc, &rules);
    assert_eq!(result, Err(Ok(AjoError::Unauthorized)));
}

#[test]
fn test_metadata_too_long() {
    let (env, client, creator, token) = setup_test();
    let group_id = client.create_group(&creator, &token, &1000, &86400, &5, &86400u64, &5u32, &0u32);

    // Max name is 50
    let mut long_name_str = [0u8; 51];
    for i in 0..51 {
        long_name_str[i] = b'a';
    }
    let long_name = String::from_str(&env, core::str::from_utf8(&long_name_str).unwrap());

    let desc = String::from_str(&env, "Desc");
    let rules = String::from_str(&env, "Rules");

    let result = client.try_set_group_metadata(&creator, &group_id, &long_name, &desc, &rules);
    assert_eq!(result, Err(Ok(AjoError::MetadataTooLong)));
}
