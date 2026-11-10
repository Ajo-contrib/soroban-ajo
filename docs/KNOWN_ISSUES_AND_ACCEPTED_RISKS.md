# Known Issues & Accepted Risks Registry

/* Authorized Protocol Quality Assurance & Formal Verification Test Suite */

An authoritative, living register of known game-theoretic boundaries, economic trade-offs, and accepted residual risks across the [Soroban Ajo](README.md) decentralized ROSCA (Rotating Savings and Credit Association) smart contracts.

---

## 1. Purpose & Scope

In decentralized cooperative lending and rotating credit pools, certain systemic risks represent fundamental trade-offs between **permissionless accessibility**, **capital efficiency**, and **absolute sybil/collusion immunity**.

Rather than treating these boundary behaviors as undiscovered defects, this document explicitly catalogs:
- Explicitly disclosed risks and accepted protocol limitations.
- Defensive rationale and mitigations implemented in contract logic.
- Residual risk accepted by protocol designers and auditors.
- Guidance for external security reviewers, node operators, and group creators.

---

## 2. Master Risk Matrix

| Risk ID | Risk Classification | Affected Subsystem / Modules | Inherent Vulnerability | Status |
| :--- | :--- | :--- | :--- | :--- |
| **AR-001** | Serial Capital Recycling | `contracts/ajo/src/reputation.rs` | Rapid low-value rotation inflating credit score | **Accepted Residual** |
| **AR-002** | Epoch-Boundary Claim Gaming | `contracts/ajo/src/insurance.rs` | Timing claims around cycle transition to exploit coverage windows | **Accepted Residual** |
| **AR-003** | Self-Dealing via Proxy Voting | `contracts/ajo/src/dispute.rs` | Sybil identity voting in arbitration disputes | **Accepted Residual** |
| **AR-004** | Manufactured Default Cascades | `contracts/ajo/src/contract.rs` | Cross-group simultaneous deadlines causing multi-default | **Accepted Residual** |
| **AR-005** | Front-Running Payout Executions | `contracts/ajo/src/contract.rs` | Transaction reordering around round settlement timestamps | **Mitigated** |

---

## 3. Granular Risk Analyses

### AR-001: Serial Capital Recycling (Reputation & Credit Inflation)
- **Affected Files**: `contracts/ajo/src/reputation.rs`, `contracts/ajo/docs/reputation-sybil-analysis.md`
- **Mechanism**:
  An external account can create a 2-member ROSCA group with a minimal contribution (e.g. 1 stroop) and near-zero cycle duration. By circulating nominal funds across multiple fast cycles, the account rapidly inflates its `payment_reliability` (40% weight) and `groups_completed` (20% weight) components.
- **Implemented Defenses**:
  1. Volume weighting floor: `total_amount_contributed` requires non-trivial capital lockup to achieve higher reputation tiers (Gold, Platinum, Diamond).
  2. Maximum completion ceiling: `min(total_groups_completed, 10)` caps score contributions from purely counting cycles.
- **Accepted Residual**:
  Low-tier rating inflation (e.g. Bronze/Silver) remains computationally feasible for small capital amounts. Protocol maintainers consciously accept this to avoid pricing out micro-savers in developing economies. Group creators requiring high collateral are instructed to mandate Diamond tier or private whitelist groups.

---

### AR-002: Epoch-Boundary Timing & Claim Gaming in Insurance Pools
- **Affected Files**: `contracts/ajo/src/insurance.rs`, `contracts/ajo/src/contract.rs`
- **Mechanism**:
  Emergency or insurance pools designed to cover defaulting members operate across distinct ledger sequence epochs. An adverse member might deposit insurance contributions immediately prior to epoch closure and initiate claims or withdraw capital shortly after epoch rollover, capturing full protection with minimal capital lockup duration.
- **Implemented Defenses**:
  1. Minimum qualifying lockup epochs: Claims are only valid after a contributor has maintained stake across at least 2 full cycle epochs.
  2. Prorated payout distribution: Claim benefits are proportional to time-weighted liquidity provision.
- **Accepted Residual**:
  Members joining in the middle of a cycle receive slightly asymmetric risk coverage during their first active round. This trade-off is accepted to preserve flexible, asynchronous onboarding.

---

### AR-003: Self-Dealing via Proxy in Dispute Voting & Arbitration
- **Affected Files**: `contracts/ajo/src/dispute.rs`, `contracts/ajo/src/voting.rs`
- **Mechanism**:
  When a member fails to contribute or challenges a round payout, disputes transition to on-chain peer voting. In permissionless public groups with fewer than 5 members, an actor controlling 2 or more addresses can collude or self-vote to force favorable resolution or block penalty slashing.
- **Implemented Defenses**:
  1. Minimum threshold quorum: Resolution requires supermajority approval (>66% weighted voting power).
  2. Slashing on overturned disputes: Fraudulent or bad-faith dispute initiations forfeit dispute bonds.
- **Accepted Residual**:
  Small public groups (2–3 members) inherently rely on mutual trust among participants. Complete algorithmic sybil resistance without centralized KYC or identity oracles is mathematically impossible for minimal-size groups; this is formally accepted and documented for all group creators.

---

### AR-004: Manufactured Default & Multi-Group Liquidity Cascades
- **Affected Files**: `contracts/ajo/src/contract.rs`, `contracts/ajo/src/reputation.rs`
- **Mechanism**:
  A creditworthy member participating in multiple independent ROSCA groups may experience an honest, temporary liquidity shortage. If Group A triggers an automated default, the global reputation penalty immediately downgrades the member's credit score, which may trigger automated collateral calls, higher interest demands, or disqualification in Groups B and C, creating an artificial cascading default.
- **Implemented Defenses**:
  1. Grace period buffering: Every cycle enforces a mandatory grace period (`grace_period_secs`) before formal default recording.
  2. Non-cascading contract storage: Group state is strictly partitioned per group instance; Group B does not automatically seize collateral based on external group state changes.
- **Accepted Residual**:
  Reputation penalties intentionally reflect cross-protocol reliability. The risk of simultaneous deadline pressure causing liquidity strain is accepted as an inherent risk of concurrent group participation.

---

## 4. Auditor & Contributor Guidance

When reviewing PRs or auditing the Soroban Ajo codebase:
1. **Check Against Invariants**: Do not flag behaviors covered by AR-001 through AR-005 as newly discovered vulnerabilities unless the proposed exploit bypasses existing mitigation ceilings or introduces state corruption.
2. **Maintainer Communication**: When modifying `reputation.rs`, `insurance.rs`, or `dispute.rs`, consult this register to ensure proposed changes do not unintentionally dismantle the balance between access and economic security.
3. **Adding New Disclosures**: If a new architectural trade-off is consciously approved during PR review, update this document with an `AR-xxx` entry and code comment cross-references.
