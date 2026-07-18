# MultiSig API Reference

## Base URL
```
http://localhost:3001/api/multisig
```

## Authentication
All endpoints except `GET /config/{groupId}` require a valid JWT token in the `Authorization` header:
```
Authorization: Bearer <JWT_TOKEN>
```

The JWT should contain a `walletAddress` claim that matches the Stellar wallet making the request.

---

## Configuration Endpoints

### Create Multi-Sig Configuration
Creates a new multi-signature configuration for a group.

**Endpoint**
```
POST /config
```

**Request Body**
```json
{
  "groupId": "string (required, unique)",
  "threshold": "number (required, 1-10)",
  "signers": [
    {
      "walletAddress": "string (required, valid Stellar address)",
      "weight": "number (required, 1-10, default 1)"
    }
  ]
}
```

**Response (201 Created)**
```json
{
  "id": "uuid",
  "groupId": "string",
  "threshold": 2,
  "totalSigners": 3
}
```

**Error Responses**
- `400` - Invalid input (threshold > signer count, invalid address format, etc.)
- `400` - Multi-sig already configured for this group

**Example**
```bash
curl -X POST http://localhost:3001/api/multisig/config \
  -H 'Content-Type: application/json' \
  -d '{
    "groupId": "my-group",
    "threshold": 2,
    "signers": [
      { "walletAddress": "GXXXXXX...", "weight": 1 },
      { "walletAddress": "GYYYYYY...", "weight": 1 },
      { "walletAddress": "GZZZZZZ...", "weight": 1 }
    ]
  }'
```

---

### Get Multi-Sig Configuration
Retrieves the multi-signature configuration for a group.

**Endpoint**
```
GET /config/:groupId
```

**Parameters**
- `groupId` (path) - The group ID

**Response (200 OK)**
```json
{
  "id": "uuid",
  "groupId": "string",
  "threshold": 2,
  "totalSigners": 3,
  "signers": [
    {
      "id": "uuid",
      "walletAddress": "GXXXXXX...",
      "weight": 1,
      "isActive": true
    }
  ]
}
```

**Error Responses**
- `404` - No multi-sig configuration found for this group

**Example**
```bash
curl http://localhost:3001/api/multisig/config/my-group
```

---

## Proposal Endpoints

### Create Proposal
Creates a new multi-signature proposal for a critical operation.

**Endpoint**
```
POST /proposals
```

**Request Body**
```json
{
  "groupId": "string (required)",
  "operationType": "enum (required: PAYOUT, CANCEL_GROUP, REMOVE_MEMBER, CHANGE_SETTINGS, ADD_SIGNER, REMOVE_SIGNER)",
  "transactionXdr": "string (required, valid Stellar transaction XDR)",
  "metadata": {
    "amount": "string (optional, for PAYOUT)",
    "recipient": "string (optional, Stellar address)",
    "reason": "string (optional)",
    "memberToRemove": "string (optional, for REMOVE_MEMBER)",
    "settingKey": "string (optional, for CHANGE_SETTINGS)",
    "settingValue": "string (optional)"
  },
  "expiresIn": "number (optional, default 86400, range 3600-604800 seconds)"
}
```

**Response (201 Created)**
```json
{
  "id": "uuid",
  "status": "PENDING",
  "requiredSigs": 2,
  "expiresAt": "2026-07-19T18:35:24Z"
}
```

**Error Responses**
- `400` - Missing required fields or invalid format
- `400` - Multi-sig not configured for this group
- `403` - Proposer is not an authorized signer
- `400` - Invalid transaction XDR

**Example**
```bash
curl -X POST http://localhost:3001/api/multisig/proposals \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT>' \
  -d '{
    "groupId": "my-group",
    "operationType": "PAYOUT",
    "transactionXdr": "...",
    "metadata": {
      "amount": "1000000",
      "recipient": "GXXXXXX...",
      "reason": "Monthly distribution"
    },
    "expiresIn": 86400
  }'
```

---

### Get Proposal
Retrieves details of a specific proposal.

**Endpoint**
```
GET /proposals/:proposalId
```

**Parameters**
- `proposalId` (path) - The proposal ID

**Response (200 OK)**
```json
{
  "id": "uuid",
  "groupId": "string",
  "proposerId": "GXXXXXX...",
  "operationType": "PAYOUT",
  "status": "PENDING",
  "currentSigs": 1,
  "requiredSigs": 2,
  "expiresAt": "2026-07-19T18:35:24Z",
  "createdAt": "2026-07-18T18:35:24Z",
  "metadata": {
    "amount": "1000000",
    "recipient": "GXXXXXX...",
    "reason": "Monthly distribution"
  },
  "signatures": [
    {
      "walletAddress": "GXXXXXX...",
      "signedAt": "2026-07-18T18:36:00Z"
    }
  ]
}
```

**Error Responses**
- `404` - Proposal not found

**Example**
```bash
curl http://localhost:3001/api/multisig/proposals/123e4567-e89b-12d3-a456-426614174000
```

---

### Sign Proposal
Adds a signature to a proposal. Returns status after signature is added.

**Endpoint**
```
POST /proposals/:proposalId/sign
```

**Parameters**
- `proposalId` (path) - The proposal ID

**Request Body**
```json
{
  "signature": "string (required, base64-encoded signature of transaction)"
}
```

**Response (200 OK)**
```json
{
  "proposalId": "uuid",
  "currentSigs": 2,
  "requiredSigs": 2,
  "status": "APPROVED",
  "readyToExecute": true
}
```

**Error Responses**
- `404` - Proposal not found
- `400` - Proposal expired
- `409` - Proposal already executed
- `400` - Invalid signature (failed verification)
- `409` - Signer has already signed this proposal
- `403` - Signer is not authorized for this group

**Example**
```bash
curl -X POST http://localhost:3001/api/multisig/proposals/123e4567-e89b-12d3-a456-426614174000/sign \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT>' \
  -d '{
    "signature": "2e5f7a8b9c0d1e2f3a4b5c6d7e8f9g0h..."
  }'
```

---

### Execute Proposal
Executes a proposal that has reached the signature threshold.

**Endpoint**
```
POST /proposals/:proposalId/execute
```

**Parameters**
- `proposalId` (path) - The proposal ID

**Request Body**
```json
{}
```

**Response (200 OK)**
```json
{
  "proposalId": "uuid",
  "txHash": "0123456789abcdef...",
  "status": "EXECUTED"
}
```

**Error Responses**
- `404` - Proposal not found
- `409` - Proposal already executed
- `400` - Proposal has expired
- `400` - Insufficient signatures (below threshold)
- `400` - Transaction submission failed

**Example**
```bash
curl -X POST http://localhost:3001/api/multisig/proposals/123e4567-e89b-12d3-a456-426614174000/execute \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <JWT>' \
  -d '{}'
```

---

## Query Endpoints

### List Group Proposals
Lists all proposals for a group with optional filtering.

**Endpoint**
```
GET /groups/:groupId/proposals
```

**Parameters**
- `groupId` (path) - The group ID
- `status` (query, optional) - Filter by status: PENDING, APPROVED, EXECUTED, EXPIRED
- `limit` (query, optional, default 50, max 100) - Number of results
- `offset` (query, optional, default 0) - Pagination offset

**Response (200 OK)**
```json
{
  "data": [
    {
      "id": "uuid",
      "operationType": "PAYOUT",
      "status": "PENDING",
      "currentSigs": 1,
      "requiredSigs": 2,
      "expiresAt": "2026-07-19T18:35:24Z",
      "createdAt": "2026-07-18T18:35:24Z"
    }
  ],
  "limit": 50,
  "offset": 0,
  "count": 1
}
```

**Example**
```bash
# Get all pending proposals
curl "http://localhost:3001/api/multisig/groups/my-group/proposals?status=PENDING"

# Get with pagination
curl "http://localhost:3001/api/multisig/groups/my-group/proposals?limit=10&offset=20"

# Get executed proposals
curl "http://localhost:3001/api/multisig/groups/my-group/proposals?status=EXECUTED"
```

---

## Error Response Format

All errors follow this format:

**Standard Error**
```json
{
  "error": "Description of what went wrong"
}
```

**Validation Error**
```json
{
  "error": "Validation failed",
  "details": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "number",
      "path": ["threshold"],
      "message": "Expected string, received number"
    }
  ]
}
```

---

## Status Codes Summary

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation, business logic) |
| 403 | Forbidden (not authorized to perform action) |
| 404 | Not Found (resource doesn't exist) |
| 409 | Conflict (duplicate signature, already executed) |
| 410 | Gone (proposal expired) |
| 500 | Internal Server Error |

---

## Rate Limiting

All endpoints are subject to rate limiting:
- **Global limit**: 100 requests per 15 minutes
- **Auth limit**: 30 requests per 15 minutes
- **Public read limit**: 200 requests per 15 minutes

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

---

## Proposal Statuses

| Status | Meaning | Can Sign | Can Execute |
|--------|---------|----------|-------------|
| PENDING | Collecting signatures | ✓ | ✗ |
| APPROVED | Threshold reached | ✗ | ✓ |
| EXECUTED | On-chain call completed | ✗ | ✗ |
| EXPIRED | TTL passed before threshold | ✗ | ✗ |
| REJECTED | Rejected by vote (future) | ✗ | ✗ |

---

## Operation Types

| Type | Purpose |
|------|---------|
| PAYOUT | Transfer funds from group |
| CANCEL_GROUP | Dissolve the group |
| REMOVE_MEMBER | Remove a member |
| CHANGE_SETTINGS | Modify group settings |
| ADD_SIGNER | Add a new signer (future) |
| REMOVE_SIGNER | Remove a signer (future) |

---

## Signature Format

Signatures must be:
- Base64-encoded
- Valid ed25519 signature
- Signature of the transaction XDR's hash
- From an authorized signer

**Creating a signature in JavaScript:**
```javascript
const StellarSdk = require('stellar-sdk');

// Build transaction
const account = new StellarSdk.Account(publicKey, '0');
const transaction = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE
})
  .setTimeout(30)
  .build();

// Sign it
const keypair = StellarSdk.Keypair.fromSecret(secretKey);
transaction.sign(keypair);

// Extract signature
const signature = transaction.signatures[0].signature().toString('base64');
```

---

## Webhook Events (Future)

Events will be sent when proposals reach threshold or expire:

```
POST /your-webhook-url
{
  "event": "proposal.approved",
  "proposalId": "uuid",
  "groupId": "string",
  "currentSigs": 2,
  "requiredSigs": 2
}
```

---

## Rate Limiting Best Practices

1. **Poll for status** max once per 5 seconds
2. **Cache config** (changes rarely)
3. **Batch queries** when possible
4. **Implement exponential backoff** for retries
5. **Store proposal state** locally

---

## Security Best Practices

1. **Never expose private keys** in requests
2. **Verify signatures client-side** before submission
3. **Use HTTPS** in production
4. **Rotate JWT tokens** regularly
5. **Keep transaction XDRs** short-lived
6. **Audit all proposals** for compliance
7. **Monitor proposal creation rate** for anomalies
8. **Implement signing quorum procedures** in your app

---

## SDK Integration

Use the TypeScript SDK for type-safe calls:

```typescript
import { AjoMultiSigClient } from '@ajo/sdk';

const client = new AjoMultiSigClient({
  baseUrl: 'http://localhost:3001',
  apiVersion: 'v1'
});

// Type-safe API
const config = await client.config.create({ /* ... */ });
const proposal = await client.proposals.create({ /* ... */ });
```

---

## Changelog

### v1.0.0 (Current)
- Initial release
- Full multi-sig workflow
- E2E tests
- TypeScript support

### v1.1.0 (Planned)
- Weighted voting
- Timelocks
- Webhooks
- GraphQL API
