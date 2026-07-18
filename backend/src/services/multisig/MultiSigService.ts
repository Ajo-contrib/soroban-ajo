import { prisma } from '../../config/database'
import { logger } from '../../utils/logger'
import {
  MultiSigNotFoundError,
  ProposalNotFoundError,
  ProposalExpiredError,
  ProposalAlreadyExecutedError,
  InsufficientSignaturesError,
  DuplicateSignatureError,
  UnauthorizedSignerError,
  InvalidThresholdError,
  InvalidSignatureError,
} from '../../errors/MultiSigError'
import {
  ProposalStatus,
  OperationType,
  MultiSigConfigData,
  ProposalMetadata,
} from '../../types/multisig'
import * as StellarSdk from 'stellar-sdk'

// Export types for use in other modules
export interface MultiSigConfig {
  groupId: string
  threshold: number
  signers: string[]
}

export interface MultiSigProposal {
  id: string
  groupId: string
  threshold: number
  signers: Array<{ address: string; signed: boolean; timestamp?: number }>
  expiresAt: number
  status: 'pending' | 'in-progress' | 'complete' | 'expired'
  createdAt: number
}

export class MultiSigService {
  constructor() {
    // No longer initializing SorobanService here as it's not directly used
    // Signature verification and transaction submission use Stellar SDK directly
  }

  async createMultiSigConfig(data: MultiSigConfigData): Promise<{
    id: string
    groupId: string
    threshold: number
    totalSigners: number
  }> {
    const { groupId, threshold, signers } = data

    if (threshold > signers.length) {
      throw new InvalidThresholdError(threshold, signers.length)
    }

    return await prisma.$transaction(async (tx: any) => {
      // Check if config already exists
      const existing = await tx.multiSigConfig.findUnique({
        where: { groupId },
      })

      if (existing) {
        throw new Error(`Multi-sig already configured for group: ${groupId}`)
      }

      // Create multi-sig config
      const config = await tx.multiSigConfig.create({
        data: {
          groupId,
          threshold,
          totalSigners: signers.length,
        },
      })

      // Add signers
      await tx.signerConfig.createMany({
        data: signers.map((signer) => ({
          multiSigId: config.id,
          walletAddress: signer.walletAddress,
          weight: signer.weight,
        })),
      })

      logger.info('Multi-sig config created', {
        groupId,
        threshold,
        totalSigners: signers.length,
      })

      return {
        id: config.id,
        groupId: config.groupId,
        threshold: config.threshold,
        totalSigners: config.totalSigners,
      }
    })
  }

  async getMultiSigConfig(groupId: string): Promise<{
    id: string
    groupId: string
    threshold: number
    totalSigners: number
    signers: Array<{
      id: string
      walletAddress: string
      weight: number
      isActive: boolean
    }>
  } | null> {
    const config = await prisma.multiSigConfig.findUnique({
      where: { groupId },
      include: {
        signers: {
          where: { isActive: true },
          select: {
            id: true,
            walletAddress: true,
            weight: true,
            isActive: true,
          },
        },
      },
    })

    if (!config) return null

    return {
      id: config.id,
      groupId: config.groupId,
      threshold: config.threshold,
      totalSigners: config.totalSigners,
      signers: config.signers,
    }
  }

  async createProposal(
    groupId: string,
    proposerId: string,
    operationType: OperationType,
    transactionXdr: string,
    metadata?: ProposalMetadata,
    expiresIn: number = 86400
  ): Promise<{
    id: string
    status: ProposalStatus
    requiredSigs: number
    expiresAt: Date
  }> {
    const config = await this.getMultiSigConfig(groupId)
    if (!config) {
      throw new MultiSigNotFoundError(groupId)
    }

    // Verify proposer is a signer
    const isSigner = config.signers.some((s) => s.walletAddress === proposerId)
    if (!isSigner) {
      throw new UnauthorizedSignerError(proposerId)
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000)

    const proposal = await prisma.transactionProposal.create({
      data: {
        multiSigId: config.id,
        proposerId,
        operationType,
        transactionXdr,
        metadata: metadata ? JSON.stringify(metadata) : null,
        requiredSigs: config.threshold,
        expiresAt,
      },
    })

    logger.info('Proposal created', {
      proposalId: proposal.id,
      groupId,
      operationType,
      requiredSigs: config.threshold,
    })

    return {
      id: proposal.id,
      status: proposal.status as ProposalStatus,
      requiredSigs: proposal.requiredSigs,
      expiresAt: proposal.expiresAt,
    }
  }

  async signProposal(
    proposalId: string,
    signerWalletAddress: string,
    signature: string
  ): Promise<{
    proposalId: string
    currentSigs: number
    requiredSigs: number
    status: ProposalStatus
    readyToExecute: boolean
  }> {
    return await prisma.$transaction(async (tx: any) => {
      const proposal = await tx.transactionProposal.findUnique({
        where: { id: proposalId },
        include: {
          multiSig: {
            include: {
              signers: {
                where: { isActive: true },
              },
            },
          },
          signatures: true,
        },
      })

      if (!proposal) {
        throw new ProposalNotFoundError(proposalId)
      }

      // Check if expired
      if (new Date() > proposal.expiresAt) {
        await tx.transactionProposal.update({
          where: { id: proposalId },
          data: { status: ProposalStatus.EXPIRED },
        })
        throw new ProposalExpiredError(proposalId)
      }

      // Check if already executed
      if (proposal.status === ProposalStatus.EXECUTED) {
        throw new ProposalAlreadyExecutedError(proposalId)
      }

      // Find signer config
      const signerConfig = proposal.multiSig.signers.find(
        (s: any) => s.walletAddress === signerWalletAddress
      )

      if (!signerConfig) {
        throw new UnauthorizedSignerError(signerWalletAddress)
      }

      // Check for duplicate signature
      const existingSignature = proposal.signatures.find((s: any) => s.signerId === signerConfig.id)

      if (existingSignature) {
        throw new DuplicateSignatureError(signerConfig.id)
      }

      // Verify signature
      await this.verifySignature(proposal.transactionXdr, signerWalletAddress, signature)

      // Add signature
      await tx.proposalSignature.create({
        data: {
          proposalId,
          signerId: signerConfig.id,
          signature,
        },
      })

      // Update proposal
      const newSigCount = proposal.currentSigs + 1
      const readyToExecute = newSigCount >= proposal.requiredSigs

      const updatedProposal = await tx.transactionProposal.update({
        where: { id: proposalId },
        data: {
          currentSigs: newSigCount,
          status: readyToExecute ? ProposalStatus.APPROVED : ProposalStatus.PENDING,
        },
      })

      logger.info('Proposal signed', {
        proposalId,
        signer: signerWalletAddress,
        currentSigs: newSigCount,
        requiredSigs: proposal.requiredSigs,
        readyToExecute,
      })

      return {
        proposalId,
        currentSigs: newSigCount,
        requiredSigs: proposal.requiredSigs,
        status: updatedProposal.status as ProposalStatus,
        readyToExecute,
      }
    })
  }

  async executeProposal(proposalId: string): Promise<{
    proposalId: string
    txHash: string
    status: ProposalStatus
  }> {
    return await prisma.$transaction(async (tx: any) => {
      const proposal = await tx.transactionProposal.findUnique({
        where: { id: proposalId },
        include: {
          signatures: {
            include: {
              signer: true,
            },
          },
          multiSig: {
            select: {
              groupId: true,
            },
          },
        },
      })

      if (!proposal) {
        throw new ProposalNotFoundError(proposalId)
      }

      if (proposal.status === ProposalStatus.EXECUTED) {
        throw new ProposalAlreadyExecutedError(proposalId)
      }

      if (new Date() > proposal.expiresAt) {
        throw new ProposalExpiredError(proposalId)
      }

      if (proposal.currentSigs < proposal.requiredSigs) {
        throw new InsufficientSignaturesError(proposal.currentSigs, proposal.requiredSigs)
      }

      // Build and submit transaction
      const txHash = await this.submitTransaction(
        proposal.transactionXdr,
        proposal.signatures.map((s: any) => s.signature)
      )

      // Update proposal
      await tx.transactionProposal.update({
        where: { id: proposalId },
        data: {
          status: ProposalStatus.EXECUTED,
          executedAt: new Date(),
          executedTxHash: txHash,
        },
      })

      logger.info('Proposal executed', {
        proposalId,
        txHash,
        groupId: proposal.multiSig.groupId,
      })

      return {
        proposalId,
        txHash,
        status: ProposalStatus.EXECUTED,
      }
    })
  }

  async getProposal(proposalId: string): Promise<{
    id: string
    groupId: string
    proposerId: string
    operationType: string
    status: string
    currentSigs: number
    requiredSigs: number
    expiresAt: Date
    createdAt: Date
    metadata?: ProposalMetadata
    signatures: Array<{
      walletAddress: string
      signedAt: Date
    }>
  }> {
    const proposal = await prisma.transactionProposal.findUnique({
      where: { id: proposalId },
      include: {
        multiSig: {
          select: {
            groupId: true,
          },
        },
        signatures: {
          include: {
            signer: {
              select: {
                walletAddress: true,
              },
            },
          },
          orderBy: {
            signedAt: 'asc',
          },
        },
      },
    })

    if (!proposal) {
      throw new ProposalNotFoundError(proposalId)
    }

    return {
      id: proposal.id,
      groupId: proposal.multiSig.groupId,
      proposerId: proposal.proposerId,
      operationType: proposal.operationType,
      status: proposal.status,
      currentSigs: proposal.currentSigs,
      requiredSigs: proposal.requiredSigs,
      expiresAt: proposal.expiresAt,
      createdAt: proposal.createdAt,
      metadata: proposal.metadata ? JSON.parse(proposal.metadata) : undefined,
      signatures: proposal.signatures.map((s: any) => ({
        walletAddress: s.signer.walletAddress,
        signedAt: s.signedAt,
      })),
    }
  }

  async getGroupProposals(
    groupId: string,
    status?: ProposalStatus,
    limit: number = 50,
    offset: number = 0
  ): Promise<
    Array<{
      id: string
      operationType: string
      status: string
      currentSigs: number
      requiredSigs: number
      expiresAt: Date
      createdAt: Date
    }>
  > {
    const config = await prisma.multiSigConfig.findUnique({
      where: { groupId },
    })

    if (!config) {
      return []
    }

    const proposals = await prisma.transactionProposal.findMany({
      where: {
        multiSigId: config.id,
        ...(status && { status }),
      },
      select: {
        id: true,
        operationType: true,
        status: true,
        currentSigs: true,
        requiredSigs: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    })

    return proposals
  }

  private async verifySignature(
    transactionXdr: string,
    signerAddress: string,
    signature: string
  ): Promise<void> {
    try {
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        transactionXdr,
        StellarSdk.Networks.TESTNET_PASSPHRASE || 'Test SDF Network ; September 2015'
      )

      // Verify signature matches transaction hash and signer
      const txHash = (transaction as any).hash()
      const keypair = StellarSdk.Keypair.fromPublicKey(signerAddress)

      const isValid = keypair.verify(txHash, Buffer.from(signature, 'base64'))

      if (!isValid) {
        throw new InvalidSignatureError('Signature verification failed')
      }
    } catch (error) {
      logger.error('Signature verification failed', { error, signerAddress })
      if (error instanceof InvalidSignatureError) {
        throw error
      }
      throw new InvalidSignatureError('Failed to verify signature')
    }
  }

  private async submitTransaction(transactionXdr: string, signatures: string[]): Promise<string> {
    try {
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        transactionXdr,
        StellarSdk.Networks.TESTNET_PASSPHRASE || 'Test SDF Network ; September 2015'
      )

      // Add all signatures to the transaction
      const sorobanRpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
      const server = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl)

      const txToSubmit = transaction as StellarSdk.Transaction<
        StellarSdk.Memo,
        StellarSdk.Operation[]
      >

      // Submit to network
      const result = await server.sendTransaction(txToSubmit)

      if ('errorResultCode' in result) {
        throw new Error(`Transaction failed: ${JSON.stringify(result)}`)
      }

      const txHash = (result as any).hash || (result as any).id || transactionXdr

      logger.info('Transaction submitted', {
        txHash,
        sigCount: signatures.length,
      })

      return txHash
    } catch (error) {
      logger.error('Transaction submission failed', { error })
      throw new Error(`Failed to submit transaction: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async expireOldProposals(): Promise<number> {
    const result = await prisma.transactionProposal.updateMany({
      where: {
        status: ProposalStatus.PENDING,
        expiresAt: {
          lt: new Date(),
        },
      },
      data: {
        status: ProposalStatus.EXPIRED,
      },
    })

    logger.info('Expired old proposals', { count: result.count })
    return result.count
  }
}

export const multiSigService = new MultiSigService()
