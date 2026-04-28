import { Router, Request, Response } from 'express'
import { adminQueuesRouter } from './queues'
import { adminAuth } from '../../middleware/adminAuth'
import { apiKeyAuth } from '../../middleware/apiKey'
import { securityService } from '../../services/securityService'
import { asyncHandler } from '../../middleware/errorHandler'

const router = Router()

// All admin routes require admin JWT
router.use(adminAuth())

// Queue management
router.use('/queues', adminQueuesRouter)

// API key management — also requires x-api-key on sensitive operations
router.get(
  '/api-keys',
  asyncHandler(async (_req: Request, res: Response) => {
    const keys = await securityService.listApiKeys()
    res.json({ success: true, data: keys })
  })
)

router.post(
  '/api-keys',
  asyncHandler(async (req: Request, res: Response) => {
    const { name, rateLimit } = req.body
    if (!name) {
      res.status(400).json({ success: false, error: 'name is required' })
      return
    }
    const result = await securityService.createApiKey(name, rateLimit)
    res.status(201).json({ success: true, data: result })
  })
)

router.delete(
  '/api-keys/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await securityService.revokeApiKey(req.params.id)
    res.json({ success: true })
  })
)

// Example: a sensitive admin action that additionally requires a valid API key
router.post(
  '/secure-action',
  apiKeyAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, message: 'Secure action executed' })
  })
)

export const adminRouter = router
