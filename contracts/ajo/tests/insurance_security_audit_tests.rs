use soroban_sdk::{testutils::Address as _, Address, Env};
use crate::{
    contract::{AjoContract, AjoContractClient},
    errors::AjoError,
    types::{ClaimStatus, FraudRiskProfile, GroupRiskAssessment, FRAUD_FLAG_SELF_DEALING, FRAUD_FLAG_MANUFACTURED_DEFAULT, FRAUD_FLAG_SYBIL_ATTACK},
};

fn setup_test_env() -> (Env, AjoContractClient<'static>, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);

    client.initialize(&admin);

    (env, client, admin, alice, bob, charlie)
}

fn setup_group_with_members(
    env: &Env,
    client: &AjoContractClient,
    members: &[Address],
    contribution_amount: i128,
) -> u64 {
    let creator = &members[0];
    let token = env.register_stellar_asset_contract(creator.clone());

    // Create group
    let group_id = client.create_group(
        creator,
        &token,
        contribution_amount,
        5, // max_members
        604800, // cycle_duration (1 week)
        86400,  // grace_period (1 day)
        0,      // penalty_rate
    );

    // Join all members
    for member in members.iter().skip(1) {
        client.join_group(member, &group_id);
    }

    group_id
}

#[test]
fn test_self_dealing_detection() {
    let (env, client, _admin, alice, bob, _charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);

    // Alice tries to file a claim against herself (direct self-dealing)
    let result = client.try_file_insurance_claim(
        &alice,
        &group_id,
        &1u32,
        &alice, // same as claimant - direct self-dealing
        &1000000i128,
    );

    // Should fail with high fraud risk
    assert_eq!(result, Err(Ok(AjoError::HighFraudRisk)));
}

#[test]
fn test_manufactured_default_detection() {
    let (env, client, _admin, alice, bob, _charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);
    
    let token = env.register_stellar_asset_contract(alice.clone());

    // Give bob plenty of balance but he doesn't contribute
    mint_tokens(&env, &token, &[bob.clone()], 10000000); // 10x contribution amount

    // Move time forward to simulate cycle progression
    env.ledger().with_mut(|li| li.timestamp = 604800 + 86400); // past grace period

    // Alice tries to file claim against bob who clearly could have contributed
    let result = client.try_file_insurance_claim(
        &alice,
        &group_id,
        &1u32,
        &bob,
        &1000000i128,
    );

    // Should either fail with high fraud risk or be detected as manufactured default
    match result {
        Err(Ok(AjoError::HighFraudRisk)) => {}, // Direct rejection
        Ok(claim_id) => {
            // If claim is filed, auto-verification should reject it
            let verification_result = client.try_auto_verify_insurance_claim(&claim_id);
            // Should succeed but reject the claim due to manufactured default detection
            assert!(verification_result.is_ok());
            
            let claim = client.get_insurance_claim(&claim_id);
            assert_eq!(claim.status, ClaimStatus::Rejected);
        }
        _ => panic!("Unexpected result"),
    }
}

#[test]
fn test_sybil_attack_detection() {
    let (env, client, _admin, alice, bob, charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone(), charlie.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);

    // Move time forward
    env.ledger().with_mut(|li| li.timestamp = 604800 + 86400);

    // Multiple members file claims at the same time (coordinated attack)
    let claim1_result = client.try_file_insurance_claim(
        &alice,
        &group_id,
        &1u32,
        &bob,
        &1000000i128,
    );

    let claim2_result = client.try_file_insurance_claim(
        &bob,
        &group_id,
        &1u32,
        &charlie,
        &1000000i128,
    );

    let claim3_result = client.try_file_insurance_claim(
        &charlie,
        &group_id,
        &1u32,
        &alice,
        &1000000i128,
    );

    // At least some of these should be detected as suspicious
    let failed_claims = [claim1_result, claim2_result, claim3_result]
        .iter()
        .filter(|r| matches!(r, Err(Ok(AjoError::HighFraudRisk))))
        .count();

    // Expect at least one claim to be rejected due to sybil attack detection
    assert!(failed_claims > 0);
}

#[test]
fn test_pool_solvency_protection() {
    let (env, client, _admin, alice, bob, charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone(), charlie.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);
    
    let token = env.register_stellar_asset_contract(alice.clone());

    // Setup insurance pool with limited funds
    crate::insurance::deposit_to_pool(&env, &token, 5000000); // 5M stroops

    // Move time forward
    env.ledger().with_mut(|li| li.timestamp = 604800 + 86400);

    // Try to file a legitimate claim
    let claim_id = client.file_insurance_claim(
        &alice,
        &group_id,
        &1u32,
        &bob,
        &1000000i128,
    );

    // Process the claim (should succeed)
    client.process_insurance_claim(&alice, &claim_id, &true);

    // Now try to file another large claim that would exceed epoch limits
    // Pool has 5M, already paid out 1M, max claimable per epoch is 5% = 250k
    // So another 1M claim should be rejected
    let large_claim_result = client.try_file_insurance_claim(
        &alice,
        &group_id,
        &2u32,
        &charlie,
        &1000000i128,
    );

    if let Ok(claim_id) = large_claim_result {
        // If claim was filed, processing should fail due to solvency limits
        let process_result = client.try_process_insurance_claim(&alice, &claim_id, &true);
        assert_eq!(process_result, Err(Ok(AjoError::PoolSolvencyLimitReached)));
    }
}

#[test]
fn test_rate_limiting() {
    let (env, client, _admin, alice, bob, charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone(), charlie.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);

    // Alice files multiple claims in quick succession
    let mut successful_claims = 0;
    let mut failed_claims = 0;

    for i in 1..=5 {
        let result = client.try_file_insurance_claim(
            &alice,
            &group_id,
            &(i as u32),
            &bob,
            &1000000i128,
        );

        match result {
            Ok(_) => successful_claims += 1,
            Err(Ok(AjoError::HighFraudRisk)) => failed_claims += 1,
            _ => {}
        }
    }

    // Should have some rate limiting in effect
    assert!(failed_claims > 0, "Rate limiting should reject some claims");
    assert!(successful_claims < 5, "Not all claims should succeed");
}

#[test]
fn test_fraud_profile_updates() {
    let (env, client, _admin, alice, bob, _charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);

    // Check initial fraud profile
    let initial_profile = client.get_member_fraud_profile(&alice);
    assert_eq!(initial_profile.total_claims_filed, 0);
    assert_eq!(initial_profile.successful_claims, 0);

    // File and process a legitimate claim
    env.ledger().with_mut(|li| li.timestamp = 604800 + 86400);
    
    let claim_id = client.file_insurance_claim(
        &alice,
        &group_id,
        &1u32,
        &bob,
        &1000000i128,
    );

    client.process_insurance_claim(&alice, &claim_id, &true);

    // Check updated fraud profile
    let updated_profile = client.get_member_fraud_profile(&alice);
    assert_eq!(updated_profile.total_claims_filed, 1);
    assert_eq!(updated_profile.successful_claims, 1);
}

#[test]
fn test_group_risk_assessment() {
    let (env, client, _admin, alice, bob, charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone(), charlie.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);

    // Get initial group risk assessment
    let initial_assessment = client.get_group_risk_assessment(&group_id).unwrap();
    let initial_risk = initial_assessment.aggregate_risk_score;

    // Simulate some defaults to increase risk
    env.ledger().with_mut(|li| li.timestamp = 604800 + 86400);

    // File multiple claims (increasing group risk)
    let _ = client.try_file_insurance_claim(&alice, &group_id, &1u32, &bob, &1000000i128);
    let _ = client.try_file_insurance_claim(&bob, &group_id, &2u32, &charlie, &1000000i128);

    // Move time forward to trigger reassessment
    env.ledger().with_mut(|li| li.timestamp += 86400 + 1);

    // Get updated assessment
    let updated_assessment = client.get_group_risk_assessment(&group_id).unwrap();
    let updated_risk = updated_assessment.aggregate_risk_score;

    // Risk should have increased due to claims activity
    assert!(updated_risk > initial_risk, "Group risk should increase with claim activity");
}

#[test]
fn test_auto_verify_rejects_high_risk_claims() {
    let (env, client, _admin, alice, bob, _charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);

    // Create a high-risk scenario by filing suspicious claims first
    for i in 1..=3 {
        let _ = client.try_file_insurance_claim(&alice, &group_id, &(i as u32), &bob, &1000000i128);
    }

    // Now try to file and auto-verify another claim
    env.ledger().with_mut(|li| li.timestamp = 604800 + 86400);

    let result = client.try_file_insurance_claim(&alice, &group_id, &4u32, &bob, &1000000i128);
    
    if let Ok(claim_id) = result {
        // Auto-verification should reject high-risk claims
        client.auto_verify_insurance_claim(&claim_id);
        
        let claim = client.get_insurance_claim(&claim_id);
        assert_eq!(claim.status, ClaimStatus::Rejected);
    }
}

#[test]
fn test_legitimate_claims_pass_verification() {
    let (env, client, _admin, alice, bob, _charlie) = setup_test_env();
    let members = [alice.clone(), bob.clone()];
    let group_id = setup_group_with_members(&env, &client, &members, 1000000);

    // Alice contributes for cycle 1
    client.contribute(&alice, &group_id);

    // Bob doesn't contribute (legitimate default)
    // Move time past grace period
    env.ledger().with_mut(|li| li.timestamp = 604800 + 86400 + 1);

    // File legitimate claim
    let claim_id = client.file_insurance_claim(
        &alice,
        &group_id,
        &1u32,
        &bob, // bob legitimately didn't contribute
        &1000000i128,
    );

    // Auto-verify should approve this legitimate claim
    client.auto_verify_insurance_claim(&claim_id);

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Paid);
}

fn mint_tokens(env: &Env, token_id: &Address, members: &[Address], amount: i128) {
    use soroban_sdk::token::{StellarAssetClient, TokenClient};
    
    let token_admin = StellarAssetClient::new(env, token_id);
    let token_client = TokenClient::new(env, token_id);

    for member in members {
        token_admin.mint(member, &amount);
        token_client.increase_allowance(member, &env.current_contract_address(), &amount);
    }
}
