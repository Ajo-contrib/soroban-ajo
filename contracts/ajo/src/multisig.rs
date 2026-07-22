use soroban_sdk::{contracttype, Address, Env, Vec, Symbol, symbol_short, IntoVal};

/// On-chain multi-sig proposal for critical admin actions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultiSigProposal {
    pub id: u64,
    pub group_id: u64,
    pub action: Symbol,
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub signed_count: u32,
    pub executed: bool,
    pub expires_at: u64,
    pub created_at: u64,
}

const MULTISIG_KEY: Symbol = symbol_short!("MSIG");

fn proposal_key(env: &Env, id: u64) -> soroban_sdk::Val {
    (MULTISIG_KEY, id).into_val(env)
}

fn next_id_key(env: &Env) -> soroban_sdk::Val {
    symbol_short!("MSIG_ID").into_val(env)
}

fn has_signed_key(env: &Env, proposal_id: u64, signer: &Address) -> soroban_sdk::Val {
    (symbol_short!("MSIG_SIG"), proposal_id, signer.clone()).into_val(env)
}

/// Create a new multi-sig proposal.
pub fn create_proposal(
    env: &Env,
    group_id: u64,
    action: Symbol,
    signers: Vec<Address>,
    threshold: u32,
    ttl_seconds: u64,
) -> u64 {
    assert!(threshold >= 1, "threshold must be >= 1");
    assert!(threshold <= signers.len() as u32, "threshold exceeds signer count");

    let id: u64 = env.storage().instance().get(&next_id_key(env)).unwrap_or(0u64);
    let now = env.ledger().timestamp();

    let proposal = MultiSigProposal {
        id,
        group_id,
        action,
        threshold,
        signers,
        signed_count: 0,
        executed: false,
        expires_at: now + ttl_seconds,
        created_at: now,
    };

    env.storage().instance().set(&proposal_key(env, id), &proposal);
    env.storage().instance().set(&next_id_key(env), &(id + 1));
    id
}

/// Sign a proposal. Returns true when threshold is reached.
pub fn sign_proposal(env: &Env, proposal_id: u64, signer: Address) -> bool {
    signer.require_auth();

    let key = proposal_key(env, proposal_id);
    let mut proposal: MultiSigProposal = env.storage().instance().get(&key)
        .expect("proposal not found");

    assert!(!proposal.executed, "already executed");
    assert!(env.ledger().timestamp() <= proposal.expires_at, "proposal expired");
    assert!(proposal.signers.contains(&signer), "not an authorized signer");

    let signed_key = has_signed_key(env, proposal_id, &signer);
    let already_signed: bool = env.storage().instance().get(&signed_key).unwrap_or(false);
    assert!(!already_signed, "already signed");

    env.storage().instance().set(&signed_key, &true);
    proposal.signed_count += 1;
    let ready = proposal.signed_count >= proposal.threshold;
    env.storage().instance().set(&key, &proposal);
    ready
}

/// Mark a proposal as executed (call after on-chain action succeeds).
pub fn execute_proposal(env: &Env, proposal_id: u64) {
    let key = proposal_key(env, proposal_id);
    let mut proposal: MultiSigProposal = env.storage().instance().get(&key)
        .expect("proposal not found");

    assert!(!proposal.executed, "already executed");
    assert!(proposal.signed_count >= proposal.threshold, "threshold not reached");

    proposal.executed = true;
    env.storage().instance().set(&key, &proposal);
}

/// Fetch a proposal by ID.
pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<MultiSigProposal> {
    env.storage().instance().get(&proposal_key(env, proposal_id))
}
