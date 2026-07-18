import { Router, Request, Response } from 'express'
import {
  createMultiSigConfig,
  getMultiSigConfig,
  createProposal,
  getProposal,
  signProposal,
  executeProposal,
  getGroupProposals,
} from '@/controllers/multisigController'
import {
  multiSigConfigSchema,
  createProposalSchema,
  signProposalSchema,
} from '@/types/multisig'
import { ZodError } from 'zod'

const router = Router()

// Validation middleware
const validateRequest = (schema: any) => (req: Request, res: Response, next: Function) => {
  try {
    const validated = schema.parse(req.body)
    ;(req as any).validated = validated
    next()
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      })
    }
    return res.status(400).json({ error: 'Validation failed' })
  }
}

/**
 * POST /multisig/config
 * Create a multi-sig configuration for a group
 */
router.post('/config', validateRequest(multiSigConfigSchema), createMultiSigConfig)

/**
 * GET /multisig/config/:groupId
 * Fetch multi-sig configuration for a group
 */
router.get('/config/:groupId', getMultiSigConfig)

/**
 * POST /multisig/proposals
 * Create a new proposal
 */
router.post('/proposals', validateRequest(createProposalSchema), createProposal)

/**
 * GET /multisig/proposals/:proposalId
 * Fetch a specific proposal
 */
router.get('/proposals/:proposalId', getProposal)

/**
 * POST /multisig/proposals/:proposalId/sign
 * Sign a proposal with your wallet
 */
router.post('/proposals/:proposalId/sign', validateRequest(signProposalSchema), signProposal)

/**
 * POST /multisig/proposals/:proposalId/execute
 * Execute a proposal (after threshold is reached)
 */
router.post('/proposals/:proposalId/execute', executeProposal)

/**
 * GET /multisig/groups/:groupId/proposals
 * List all proposals for a group with optional status filter
 */
router.get('/groups/:groupId/proposals', getGroupProposals)

export default router
