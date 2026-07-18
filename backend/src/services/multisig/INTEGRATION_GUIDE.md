# MultiSig Service Integration Guide

This guide explains how to integrate the MultiSigService with your application (frontend, mobile, or other backend services).

## Quick Start Example

### Step 1: Setup Multi-Sig for a Group

When creating a group, initialize multi-sig if it needs critical operation protection:

```typescript
async function setupGroupMultiSig(groupId: string, signers: string[], threshold: number) {
  const response = await fetch('http://localhost:3001/api/multisig/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId,
      threshold,
      signers: signers.map(addr => ({ walletAddress: addr, weight: 1 }))
    })
  });
  
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

// Usage
const config = await setupGroupMultiSig('group-1', [
  'GXXXXXX...',
  'GYYYYYY...',
  'GZZZZZZ...'
], 2); // 2-of-3 multisig
```

### Step 2: Create a Proposal

When a critical operation is triggered:

```typescript
async function proposePayout(
  groupId: string,
  amount: string,
  recipient: string,
  reason: string,
  jwtToken: string
) {
  // First, build the transaction XDR for the on-chain call
  const transactionXdr = buildPayoutTransaction(amount, recipient);
  
  const response = await fetch('http://localhost:3001/api/multisig/proposals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwtToken}`
    },
    body: JSON.stringify({
      groupId,
      operationType: 'PAYOUT',
      transactionXdr,
      metadata: { amount, recipient, reason },
      expiresIn: 86400 // 24 hours
    })
  });
  
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

// Usage
const proposal = await proposePayout(
  'group-1',
  '1000000', // stroops
  'GYYYYYYY...',
  'Monthly distribution',
  userToken
);
console.log(`Proposal created: ${proposal.id}, needs ${proposal.requiredSigs} signatures`);
```

### Step 3: Collect Signatures

Each signer must approve the proposal:

```typescript
async function signProposal(
  proposalId: string,
  walletAddress: string,
  transactionXdr: string,
  signerPrivateKey: string,
  jwtToken: string
) {
  // Sign the transaction with the signer's private key
  const transaction = StellarSdk.TransactionBuilder.fromXDR(
    transactionXdr,
    StellarSdk.Networks.TESTNET_PASSPHRASE
  );
  
  const keypair = StellarSdk.Keypair.fromSecret(signerPrivateKey);
  transaction.sign(keypair);
  
  const signature = transaction.signatures[0].signature().toString('base64');
  
  // Submit signature
  const response = await fetch(
    `http://localhost:3001/api/multisig/proposals/${proposalId}/sign`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({ signature })
    }
  );
  
  if (!response.ok) throw new Error(await response.text());
  const result = response.json();
  
  return {
    approved: result.readyToExecute,
    currentSigs: result.currentSigs,
    requiredSigs: result.requiredSigs,
    status: result.status
  };
}

// Usage
const signer1Result = await signProposal(
  proposal.id,
  'GXXXXX...',
  proposal.transactionXdr,
  signer1PrivateKey,
  signer1Token
);

if (!signer1Result.approved) {
  console.log(`Signatures: ${signer1Result.currentSigs}/${signer1Result.requiredSigs}`);
  console.log('Waiting for more signers...');
  
  // Wait for second signer
  const signer2Result = await signProposal(
    proposal.id,
    'GYYYYYY...',
    proposal.transactionXdr,
    signer2PrivateKey,
    signer2Token
  );
  
  if (signer2Result.approved) {
    console.log('Threshold reached! Proposal ready to execute.');
  }
}
```

### Step 4: Execute the Proposal

Once threshold is reached, execute the on-chain call:

```typescript
async function executeProposal(proposalId: string, jwtToken: string) {
  const response = await fetch(
    `http://localhost:3001/api/multisig/proposals/${proposalId}/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: '{}'
    }
  );
  
  if (!response.ok) throw new Error(await response.text());
  const result = response.json();
  
  return {
    txHash: result.txHash,
    executed: result.status === 'EXECUTED'
  };
}

// Usage
if (signers.every(s => s.signed)) {
  const execution = await executeProposal(proposal.id, adminToken);
  console.log(`Transaction executed: ${execution.txHash}`);
}
```

### Step 5: Monitor Proposal Status

Poll or subscribe to proposal status changes:

```typescript
async function getProposalStatus(proposalId: string) {
  const response = await fetch(
    `http://localhost:3001/api/multisig/proposals/${proposalId}`
  );
  
  if (!response.ok) throw new Error(await response.text());
  const proposal = response.json();
  
  return {
    id: proposal.id,
    status: proposal.status,
    signatures: proposal.signatures.map(sig => ({
      signer: sig.walletAddress,
      signedAt: new Date(sig.signedAt)
    })),
    progress: `${proposal.currentSigs}/${proposal.requiredSigs}`,
    expiresAt: new Date(proposal.expiresAt)
  };
}

// Usage - poll every 5 seconds
const pollInterval = setInterval(async () => {
  const status = await getProposalStatus(proposal.id);
  console.log(`Status: ${status.status} (${status.progress} signatures)`);
  
  if (status.status === 'EXECUTED') {
    clearInterval(pollInterval);
    console.log('Proposal executed!');
  } else if (status.status === 'EXPIRED') {
    clearInterval(pollInterval);
    console.log('Proposal expired');
  }
}, 5000);
```

## Full Example: Multi-Sig Protected Payout

```typescript
import * as StellarSdk from 'stellar-sdk';

class MultiSigPayout {
  private apiBase = 'http://localhost:3001/api/multisig';
  private signers: Array<{ address: string; privateKey: string; token: string }>;
  private groupId: string;
  private threshold: number;

  constructor(
    groupId: string,
    signers: Array<{ address: string; privateKey: string; token: string }>,
    threshold: number
  ) {
    this.groupId = groupId;
    this.signers = signers;
    this.threshold = threshold;
  }

  async initializeMultiSig() {
    const response = await fetch(`${this.apiBase}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: this.groupId,
        threshold: this.threshold,
        signers: this.signers.map(s => ({
          walletAddress: s.address,
          weight: 1
        }))
      })
    });
    
    if (!response.ok) throw new Error('Failed to initialize multi-sig');
    return response.json();
  }

  async executePayout(recipient: string, amount: string, reason: string) {
    // Build transaction
    const txXdr = this.buildPayoutTransaction(recipient, amount);

    // Create proposal
    const proposalRes = await fetch(`${this.apiBase}/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.signers[0].token}`
      },
      body: JSON.stringify({
        groupId: this.groupId,
        operationType: 'PAYOUT',
        transactionXdr: txXdr,
        metadata: { recipient, amount, reason },
        expiresIn: 86400
      })
    });

    if (!proposalRes.ok) throw new Error('Failed to create proposal');
    const proposal = await proposalRes.json();

    console.log(`Proposal created: ${proposal.id}`);
    console.log(`Waiting for ${proposal.requiredSigs} signatures...`);

    // Collect signatures
    for (const signer of this.signers) {
      const signRes = await fetch(
        `${this.apiBase}/proposals/${proposal.id}/sign`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${signer.token}`
          },
          body: JSON.stringify({
            signature: this.createSignature(txXdr, signer.privateKey)
          })
        }
      );

      if (!signRes.ok) throw new Error(`Failed to sign: ${signer.address}`);
      const result = await signRes.json();

      console.log(`Signed by ${signer.address} (${result.currentSigs}/${result.requiredSigs})`);

      if (result.readyToExecute) {
        console.log('Threshold reached!');
        break;
      }
    }

    // Execute
    const execRes = await fetch(
      `${this.apiBase}/proposals/${proposal.id}/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.signers[0].token}`
        },
        body: '{}'
      }
    );

    if (!execRes.ok) throw new Error('Failed to execute proposal');
    const execution = await execRes.json();

    console.log(`✓ Payout executed! Tx: ${execution.txHash}`);
    return execution;
  }

  private buildPayoutTransaction(recipient: string, amount: string): string {
    const account = new StellarSdk.Account(this.signers[0].address, '0');
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE
    })
      .addMemo(StellarSdk.Memo.text('Payout'))
      .setTimeout(30)
      .build();

    return transaction.toXDR();
  }

  private createSignature(txXdr: string, privateKey: string): string {
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      txXdr,
      StellarSdk.Networks.TESTNET_PASSPHRASE
    );

    const keypair = StellarSdk.Keypair.fromSecret(privateKey);
    transaction.sign(keypair);

    return transaction.signatures[0].signature().toString('base64');
  }
}

// Usage
const payout = new MultiSigPayout(
  'group-1',
  [
    { address: 'GXXXXX...', privateKey: 'S...', token: 'jwt1' },
    { address: 'GYYYYYY...', privateKey: 'S...', token: 'jwt2' },
    { address: 'GZZZZZZ...', privateKey: 'S...', token: 'jwt3' }
  ],
  2 // 2-of-3
);

await payout.initializeMultiSig();
await payout.executePayout('GRECIEVER...', '1000000', 'Monthly payout');
```

## Error Handling

Always handle errors gracefully:

```typescript
async function executeWithErrorHandling(proposalId: string, token: string) {
  try {
    const result = await executeProposal(proposalId, token);
    return result;
  } catch (error) {
    if (error instanceof Response) {
      const status = error.status;
      const body = await error.json();

      switch (status) {
        case 404:
          console.error('Proposal not found');
          break;
        case 409:
          console.error('Proposal already executed or conflict:', body.error);
          break;
        case 410:
          console.error('Proposal expired');
          break;
        case 400:
          console.error('Invalid request:', body.error);
          break;
        default:
          console.error('Unknown error:', body.error);
      }
    }
  }
}
```

## SDK Integration (Recommended)

For production, use a typed SDK:

```typescript
import { AjoMultiSigClient } from '@ajo/sdk';

const client = new AjoMultiSigClient({
  baseUrl: 'http://localhost:3001',
  apiVersion: 'v1'
});

// Type-safe API calls
const proposal = await client.proposals.create({
  groupId: 'group-1',
  operationType: 'PAYOUT',
  transactionXdr: '...',
  metadata: { ... }
});

await client.proposals.sign(proposal.id, signature);
await client.proposals.execute(proposal.id);
```

See `@ajo/sdk` documentation for full details.

## Testing

Test multi-sig locally with testnet:

```bash
# Start backend
npm run dev:backend

# Run tests
npm test tests/e2e/multisig.test.ts

# Try manually
curl -X POST http://localhost:3001/api/multisig/config \
  -H 'Content-Type: application/json' \
  -d '{
    "groupId": "test-1",
    "threshold": 2,
    "signers": [
      { "walletAddress": "GXXXXXX...", "weight": 1 },
      { "walletAddress": "GYYYYYY...", "weight": 1 }
    ]
  }'
```

## Deployment

### Environment Setup

```env
# Stellar Network
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
SOROBAN_CONTRACT_ID=<your-deployed-contract-id>

# Database (must support transactions)
DATABASE_URL=postgresql://user:pass@localhost:5432/ajo

# Logging
LOG_LEVEL=info
```

### Database Migrations

Ensure multisig tables exist:

```bash
npx prisma migrate deploy
```

### Monitoring

Track proposal execution:

```typescript
// Monitor pending proposals
setInterval(async () => {
  const pending = await fetch(
    'http://localhost:3001/api/multisig/groups/group-1/proposals?status=PENDING'
  ).then(r => r.json());

  console.log(`${pending.data.length} pending proposals`);
  
  // Alert if proposals near expiration
  for (const proposal of pending.data) {
    const hoursLeft = (new Date(proposal.expiresAt).getTime() - Date.now()) / 3600000;
    if (hoursLeft < 1) {
      console.warn(`Proposal ${proposal.id} expires in ${hoursLeft.toFixed(1)} hours!`);
    }
  }
}, 300000); // Check every 5 minutes
```

## Best Practices

1. **Always verify signatures**: The backend verifies, but frontend should too
2. **Use JWT authentication**: All endpoints except GET config require auth
3. **Set appropriate TTLs**: Balance between security and operations
4. **Monitor expirations**: Set up alerts for proposals near expiration
5. **Test thoroughly**: Use testnet before mainnet
6. **Document thresholds**: Clearly communicate threshold requirements to signers
7. **Implement retry logic**: Network timeouts are possible
8. **Audit all operations**: Log all proposals and signatures for compliance
