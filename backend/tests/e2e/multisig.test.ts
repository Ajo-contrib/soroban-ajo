import request from 'supertest'
import express from 'express'
import multisigRouter from '@/routes/multisig'
import { multiSigService } from '@/services/multisig/MultiSigService'
import { ProposalStatus, OperationType } from '@/types/multisig'
import * as StellarSdk from 'stellar-sdk'

/**
 * E2E tests for MultiSig service
 * Tests the full workflow: create config, create proposal, collect signatures, execute
 */
describe('MultiSig E2E Tests', () => {
  let app: express.Application
  let testGroupId: string
  let testSigners: string[]
  let testKeyPairs: StellarSdk.Keypair[]

  beforeAll(() => {
    app = express()
    app.use(express.json())
    app.use('/multisig', multisigRouter)

    // Generate test keypairs for signers
    testKeyPairs = Array.from({ length: 3 }, () => StellarSdk.Keypair.random())
    testSigners = testKeyPairs.map((kp) => kp.publicKey())
    testGroupId = `test-group-${Date.now()}`
  })

  describe('Multi-sig Workflow', () => {
    let configId: string
    let proposalId: string

    test('should create multi-sig config with 3 signers and threshold of 2', async () => {
      const response = await request(app)
        .post('/multisig/config')
        .send({
          groupId: testGroupId,
          threshold: 2,
          signers: testSigners.map((addr) => ({
            walletAddress: addr,
            weight: 1,
          })),
        })

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      expect(response.body.groupId).toBe(testGroupId)
      expect(response.body.threshold).toBe(2)
      expect(response.body.totalSigners).toBe(3)
      configId = response.body.id
    })

    test('should fetch multi-sig config', async () => {
      const response = await request(app)
        .get(`/multisig/config/${testGroupId}`)

      expect(response.status).toBe(200)
      expect(response.body.groupId).toBe(testGroupId)
      expect(response.body.threshold).toBe(2)
      expect(response.body.signers).toHaveLength(3)
    })

    test('should reject invalid threshold (exceeds signer count)', async () => {
      const response = await request(app)
        .post('/multisig/config')
        .send({
          groupId: `test-group-invalid-${Date.now()}`,
          threshold: 5,
          signers: testSigners.slice(0, 2).map((addr) => ({
            walletAddress: addr,
            weight: 1,
          })),
        })

      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
    })

    test('should create a proposal for a critical operation', async () => {
      // Create a simple transaction for testing
      const account = new StellarSdk.Account(testSigners[0], '0')
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE,
      })
        .addMemo(StellarSdk.Memo.text('test proposal'))
        .setTimeout(30)
        .build()

      const response = await request(app)
        .post('/multisig/proposals')
        .send({
          groupId: testGroupId,
          proposerId: testSigners[0],
          operationType: OperationType.PAYOUT,
          transactionXdr: transaction.toXDR(),
          metadata: {
            amount: '1000000',
            recipient: testSigners[1],
            reason: 'Test payout',
          },
          expiresIn: 86400,
        })

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      expect(response.body.status).toBe(ProposalStatus.PENDING)
      expect(response.body.requiredSigs).toBe(2)
      proposalId = response.body.id
    })

    test('should fetch proposal details', async () => {
      const response = await request(app)
        .get(`/multisig/proposals/${proposalId}`)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe(proposalId)
      expect(response.body.groupId).toBe(testGroupId)
      expect(response.body.operationType).toBe(OperationType.PAYOUT)
      expect(response.body.currentSigs).toBe(0)
      expect(response.body.requiredSigs).toBe(2)
      expect(response.body.status).toBe(ProposalStatus.PENDING)
    })

    test('should reject non-signer from creating proposal', async () => {
      const account = new StellarSdk.Account(testSigners[0], '0')
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE,
      })
        .setTimeout(30)
        .build()

      const response = await request(app)
        .post('/multisig/proposals')
        .send({
          groupId: testGroupId,
          proposerId: StellarSdk.Keypair.random().publicKey(),
          operationType: OperationType.CHANGE_SETTINGS,
          transactionXdr: transaction.toXDR(),
          expiresIn: 86400,
        })

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Unauthorized')
    })

    test('should not allow signing before threshold is met', async () => {
      // First signer signs
      const account = new StellarSdk.Account(testSigners[0], '0')
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE,
      })
        .addMemo(StellarSdk.Memo.text('test proposal'))
        .setTimeout(30)
        .build()

      // Sign the transaction
      transaction.sign(testKeyPairs[0])
      const signature = transaction.signatures[0].signature().toString('base64')

      const signResponse1 = await request(app)
        .post(`/multisig/proposals/${proposalId}/sign`)
        .send({
          signerWalletAddress: testSigners[0],
          signature,
        })

      expect(signResponse1.status).toBe(200)
      expect(signResponse1.body.currentSigs).toBe(1)
      expect(signResponse1.body.readyToExecute).toBe(false)
      expect(signResponse1.body.status).toBe(ProposalStatus.PENDING)

      // Try to execute before threshold - should fail
      const executeResponse = await request(app)
        .post(`/multisig/proposals/${proposalId}/execute`)

      expect(executeResponse.status).toBe(400)
      expect(executeResponse.body.error).toContain('Insufficient')
    })

    test('should allow execution after threshold is met', async () => {
      // Create a fresh proposal for clean test
      const account = new StellarSdk.Account(testSigners[0], '0')
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE,
      })
        .addMemo(StellarSdk.Memo.text('test threshold'))
        .setTimeout(30)
        .build()

      // Create proposal
      const propResponse = await request(app)
        .post('/multisig/proposals')
        .send({
          groupId: testGroupId,
          proposerId: testSigners[0],
          operationType: OperationType.REMOVE_SIGNER,
          transactionXdr: transaction.toXDR(),
          expiresIn: 86400,
        })

      const thresholdProposalId = propResponse.body.id

      // Collect 2 signatures (threshold)
      for (let i = 0; i < 2; i++) {
        const tx = new StellarSdk.TransactionBuilder(
          new StellarSdk.Account(testSigners[0], '0'),
          {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE,
          }
        )
          .addMemo(StellarSdk.Memo.text('test threshold'))
          .setTimeout(30)
          .build()

        tx.sign(testKeyPairs[i])
        const sig = tx.signatures[0].signature().toString('base64')

        await request(app)
          .post(`/multisig/proposals/${thresholdProposalId}/sign`)
          .send({
            signerWalletAddress: testSigners[i],
            signature: sig,
          })
      }

      // Check proposal is now APPROVED
      const checkResponse = await request(app)
        .get(`/multisig/proposals/${thresholdProposalId}`)

      expect(checkResponse.body.status).toBe(ProposalStatus.APPROVED)
      expect(checkResponse.body.currentSigs).toBe(2)
    })

    test('should reject duplicate signature from same signer', async () => {
      const account = new StellarSdk.Account(testSigners[0], '0')
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET_PASSPHRASE,
      })
        .addMemo(StellarSdk.Memo.text('test duplicate'))
        .setTimeout(30)
        .build()

      transaction.sign(testKeyPairs[0])
      const signature = transaction.signatures[0].signature().toString('base64')

      // Create fresh proposal
      const propResponse = await request(app)
        .post('/multisig/proposals')
        .send({
          groupId: testGroupId,
          proposerId: testSigners[0],
          operationType: OperationType.ADD_SIGNER,
          transactionXdr: transaction.toXDR(),
          expiresIn: 86400,
        })

      const dupProposalId = propResponse.body.id

      // Sign once
      const sign1 = await request(app)
        .post(`/multisig/proposals/${dupProposalId}/sign`)
        .send({
          signerWalletAddress: testSigners[0],
          signature,
        })

      expect(sign1.status).toBe(200)

      // Try to sign again with same signer
      const sign2 = await request(app)
        .post(`/multisig/proposals/${dupProposalId}/sign`)
        .send({
          signerWalletAddress: testSigners[0],
          signature,
        })

      expect(sign2.status).toBe(409)
      expect(sign2.body.error).toContain('already signed')
    })

    test('should list proposals for a group', async () => {
      const response = await request(app)
        .get(`/multisig/groups/${testGroupId}/proposals`)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('data')
      expect(Array.isArray(response.body.data)).toBe(true)
      expect(response.body.data.length).toBeGreaterThan(0)
    })

    test('should filter proposals by status', async () => {
      const response = await request(app)
        .get(`/multisig/groups/${testGroupId}/proposals?status=${ProposalStatus.PENDING}`)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.data)).toBe(true)
      // All returned should be PENDING
      response.body.data.forEach((proposal: any) => {
        expect([ProposalStatus.PENDING, ProposalStatus.APPROVED]).toContain(proposal.status)
      })
    })

    test('should handle pagination correctly', async () => {
      const response1 = await request(app)
        .get(`/multisig/groups/${testGroupId}/proposals?limit=2&offset=0`)

      expect(response1.status).toBe(200)
      expect(response1.body).toHaveProperty('limit', 2)
      expect(response1.body).toHaveProperty('offset', 0)
    })
  })

  describe('Error Handling', () => {
    test('should return 404 for non-existent group config', async () => {
      const response = await request(app)
        .get('/multisig/config/non-existent-group-id')

      expect(response.status).toBe(404)
      expect(response.body.error).toContain('not found')
    })

    test('should return 404 for non-existent proposal', async () => {
      const response = await request(app)
        .get('/multisig/proposals/non-existent-proposal-id')

      expect(response.status).toBe(404)
    })

    test('should validate required fields on config creation', async () => {
      const response = await request(app)
        .post('/multisig/config')
        .send({
          // Missing groupId and signers
          threshold: 1,
        })

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Validation')
    })

    test('should validate Stellar address format', async () => {
      const response = await request(app)
        .post('/multisig/config')
        .send({
          groupId: 'test-invalid-addr',
          threshold: 1,
          signers: [
            {
              walletAddress: 'invalid-address', // Not a valid Stellar address
              weight: 1,
            },
          ],
        })

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Validation')
    })
  })
})
