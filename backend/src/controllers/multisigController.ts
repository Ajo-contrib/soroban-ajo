import { Request, Response } from 'express'
import { multiSigService } from '@/services/multisig/MultiSigService'
import { ProposalStatus } from '@/types/multisig'
import { logger } from '@/utils/logger'

/**
 * Create a multi-sig configuration for a group
 */
export const createMultiSigConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await multiSigService.createMultiSigConfig(req.body)
    res.status(201).json(config)
  } catch (error) {
    logger.error('Failed to create multi-sig config', { error })
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create multi-sig config',
    })
  }
}

/**
 * Fetch multi-sig configuration for a group
 */
export const getMultiSigConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await multiSigService.getMultiSigConfig(req.params.groupId)
    if (!config) {
      res.status(404).json({ error: 'Multi-sig configuration not found' })
      return
    }
    res.json(config)
  } catch (error) {
    logger.error('Failed to fetch multi-sig config', { error })
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch multi-sig config',
    })
  }
}

/**
 * Create a new proposal
 */
export const createProposal = async (req: Request, res: Response): Promise<void> => {
  try {
    // Extract proposer from request context (typically from JWT)
    const proposerId = (req as any).user?.walletAddress || (req.body.proposerId as string)

    if (!proposerId) {
      res.status(400).json({
        error: 'Proposer wallet address not found. Authenticate first or provide proposerId in request.',
      })
      return
    }

    const proposal = await multiSigService.createProposal(
      req.body.groupId,
      proposerId,
      req.body.operationType,
      req.body.transactionXdr,
      req.body.metadata,
      req.body.expiresIn
    )
    res.status(201).json(proposal)
  } catch (error) {
    logger.error('Failed to create proposal', { error })
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create proposal',
    })
  }
}

/**
 * Fetch a specific proposal
 */
export const getProposal = async (req: Request, res: Response): Promise<void> => {
  try {
    const proposal = await multiSigService.getProposal(req.params.proposalId)
    res.json(proposal)
  } catch (error) {
    logger.error('Failed to fetch proposal', { error })
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message })
      return
    }
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch proposal',
    })
  }
}

/**
 * Sign a proposal with your wallet
 */
export const signProposal = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get signer from request context or body
    const signerWalletAddress = (req as any).user?.walletAddress || req.body.signerWalletAddress

    if (!signerWalletAddress) {
      res.status(400).json({
        error: 'Signer wallet address not found. Authenticate first.',
      })
      return
    }

    const result = await multiSigService.signProposal(
      req.params.proposalId,
      signerWalletAddress,
      req.body.signature
    )
    res.json(result)
  } catch (error) {
    logger.error('Failed to sign proposal', { error })
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 400
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Failed to sign proposal',
    })
  }
}

/**
 * Execute a proposal (after threshold is reached)
 */
export const executeProposal = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await multiSigService.executeProposal(req.params.proposalId)
    res.json(result)
  } catch (error) {
    logger.error('Failed to execute proposal', { error })
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 400
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Failed to execute proposal',
    })
  }
}

/**
 * List all proposals for a group with optional status filter
 */
export const getGroupProposals = async (req: Request, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string) || undefined
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const offset = parseInt(req.query.offset as string) || 0

    const proposals = await multiSigService.getGroupProposals(
      req.params.groupId,
      status as any,
      limit,
      offset
    )
    res.json({
      data: proposals,
      limit,
      offset,
      count: proposals.length,
    })
  } catch (error) {
    logger.error('Failed to fetch proposals', { error })
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch proposals',
    })
  }
}
