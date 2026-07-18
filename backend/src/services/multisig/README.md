# MultiSigService

## Overview

The `MultiSigService` provides backend coordination for Soroban's on-chain multi-signature functionality (`contracts/ajo/src/multisig.rs`). It manages the full lifecycle of multi-signature proposals: from creation through signature collection to execution.

## Why Multi-Sig?

Multi-signature gates critical operations that could impact fund custody:
- Large payouts
- Member removal from groups
- Group cancellation
- Settings changes that affect fund distribution

Multi-sig ensures no single account can unilaterally execute these operations—requiring consensus from a configured threshold of signers.

## Architecture

### On-Chain (Soroban)
`contracts/ajo/src/multisig.rs` implements:
- `create_proposal()` - Create a proposal with signers, threshold, and TTL
- `sign_proposal()` - Sign a proposal (returns true when threshold reached)
- `execute_proposal()` - Mark proposal as executed
- `get_proposal()` - Fetch proposal state

### Backend (This Service)
Coordinates with the on-chain contract by:
1. **Tracking proposals** in the database
2. **Collecting signatures** from authorized signers
3. **Verifying signatures** against the transaction hash
4. **Submitting transactions** to the network once threshold is met
5. **Maintaining audit trails** of all approvals

### Database Models
- `MultiSigConfig` - Group-level configuration (threshold, signers)
- `SignerConfig` - Individual signer configuration
- `TransactionProposal` - Individual proposals
- `ProposalSignature` - Signature records for audit

## Usage

### 1. Create a Multi-Sig Configuration

```bash
POST /api/multisig/config
Content-Type: application/json

{
  "groupId": "group-123",
  "threshold": 2,
  "signers": [
    { "walletAddress": "GXXXXXX...", "weight": 1 },
    { "walletAddress": "GYYYYYY...", "weight": 1 },
    { "walletAddress": "GZZZZZZ...", "weight": 1 }
  ]
}
```

**Response:**
```json
{
  "id": "config-uuid",
  "groupId": "group-123",
  "threshold": 2,
  "totalSigners": 3
}
```

### 2. Create a Proposal

```bash
POST /api/multisig/proposals
Content-Type: application/json
Authorization: Bearer <JWT>

{
  "groupId": "group-123",
  "operationType": "PAYOUT",
  "transactionXdr": "...", // XDR of the transaction to execute
  "metadata": {
    "amount": "1000000",
    "recipient": "GXXXXXX...",
    "reason": "Monthly payout"
  },
  "expiresIn": 86400  // seconds (24 hours)
}
```

**Response:**
```json
{
  "id": "proposal-uuid",
  "status": "PENDING",
  "requiredSigs": 2,
  "expiresAt": "2026-07-19T18:35:24.972Z"
}
```

### 3. Sign a Proposal

Each authorized signer must sign:

```bash
POST /api/multisig/proposals/{proposalId}/sign
Content-Type: application/json
Authorization: Bearer <JWT-for-signer>

{
  "signature": "base64-encoded-signature-of-transaction"
}
```

**Response:**
```json
{
  "proposalId": "proposal-uuid",
  "currentSigs": 1,
  "requiredSigs": 2,
  "status": "PENDING",
  "readyToExecute": false
}
```

When threshold is reached:
```json
{
  "proposalId": "proposal-uuid",
  "currentSigs": 2,
  "requiredSigs": 2,
  "status": "APPROVED",
  "readyToExecute": true
}
```

### 4. Execute a Proposal

Once the threshold is met, any authorized actor can execute:

```bash
POST /api/multisig/proposals/{proposalId}/execute
Content-Type: application/json
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "proposalId": "proposal-uuid",
  "txHash": "transaction-hash-on-blockchain",
  "status": "EXECUTED"
}
```

### 5. Query Proposals

Get all proposals for a group:

```bash
GET /api/multisig/groups/{groupId}/proposals?status=PENDING&limit=50&offset=0
```

Get a specific proposal:

```bash
GET /api/multisig/proposals/{proposalId}
```

## Proposal Lifecycle

```
CREATE
  ↓
PENDING (collecting signatures)
  ↓
APPROVED (threshold reached) ← ready for execution
  ↓
EXECUTED (transaction on blockchain)

OR

EXPIRED (if not enough signatures within TTL)
```

## Signature Verification

Signatures are verified against:
1. **Transaction Hash**: The XDR transaction is hashed
2. **Signer's Public Key**: Must be in the authorized signer list
3. **Valid Signature**: Must cryptographically verify against the transaction

The service uses `stellar-sdk` to perform verification.

## Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `MULTISIG_NOT_FOUND` | 404 | No multi-sig config for this group |
| `PROPOSAL_NOT_FOUND` | 404 | Proposal doesn't exist |
| `PROPOSAL_EXPIRED` | 410 | Proposal expired before threshold was reached |
| `PROPOSAL_ALREADY_EXECUTED` | 409 | Proposal already executed |
| `INSUFFICIENT_SIGNATURES` | 400 | Can't execute before threshold |
| `DUPLICATE_SIGNATURE` | 409 | This signer already signed |
| `UNAUTHORIZED_SIGNER` | 403 | This wallet is not an authorized signer |
| `INVALID_THRESHOLD` | 400 | Threshold > signer count |
| `INVALID_SIGNATURE` | 400 | Signature verification failed |

## Security Considerations

1. **Authentication Required**: All endpoints (except GET config) require JWT authentication
2. **Signature Verification**: All signatures are cryptographically verified
3. **Replay Protection**: Duplicate signatures from the same signer are rejected
4. **Expiration**: Proposals expire after the configured TTL
5. **Signer Authorization**: Only configured signers can sign proposals
6. **Audit Trail**: All signatures are recorded for compliance

## Integration with On-Chain Contract

The backend service coordinates with `multisig.rs`:

1. **Proposal Creation**: Backend creates a database record; on-chain call happens during execution
2. **Signature Collection**: Backend tracks signatures; on-chain verification happens at execution
3. **Execution**: Backend submits the multi-signed transaction to the network
4. **On-Chain Validation**: Contract verifies threshold is met before marking as executed

This two-phase approach allows flexible proposal discussion while ensuring on-chain immutability.

## Testing

Run E2E tests:
```bash
npm test tests/e2e/multisig.test.ts
```

Tests cover:
- Config creation and validation
- Proposal creation and state transitions
- Signature collection and threshold logic
- Execution authorization
- Error conditions (duplicates, expired, insufficient sigs)
- Audit trail queries

## Troubleshooting

### "Unauthorized signer"
- Check the wallet is in the multi-sig config's signer list
- Verify authentication token matches the wallet

### "Already signed"
- This signer has already approved the proposal
- Different signers must sign to reach threshold

### "Insufficient signatures"
- Need more signers to reach the threshold
- Check current signature count vs. required

### "Proposal expired"
- The proposal TTL has passed
- Create a new proposal to try again

## Future Enhancements

- [ ] Timelocks (delay execution by N blocks)
- [ ] Weighted voting (signers with different weights)
- [ ] Conditional execution (based on oracle data)
- [ ] Multi-chain coordination (via Stellar bridges)
- [ ] Proposal metadata versioning
