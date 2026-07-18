import { Router, Response } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { notificationService } from '../services/notificationService'
import { getReminderPreferences, upsertReminderPreferences } from '../services/reminderService'
import { prisma } from '../config/database'
import { logger } from '../utils/logger'
import webpush from 'web-push'

export const notificationsRouter = Router()

// Configure VAPID keys if provided
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.EMAIL_FROM || 'noreply@ajo.app'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

// All routes require authentication
notificationsRouter.use(authMiddleware)

/**
 * GET /api/notifications
 * Returns recent activity-feed entries as notification history.
 */
notificationsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.walletAddress!
    const limit = Math.min(Number(req.query.limit) || 50, 100)
    const offset = Number(req.query.offset) || 0

    const activities = await prisma.activityFeed.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })

    res.json({
      success: true,
      data: activities.map((a: any) => ({
        id: a.id,
        type: a.type.toLowerCase(),
        title: a.title,
        message: a.description,
        timestamp: a.createdAt.getTime(),
        read: false, // read state is managed client-side
        metadata: a.metadata ? JSON.parse(a.metadata as string) : null,
      })),
    })
  } catch (err) {
    logger.error('Error fetching notifications:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' })
  }
})

/**
 * POST /api/notifications/test
 * Sends a test notification to the authenticated user (dev/debug only).
 */
notificationsRouter.post('/test', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.walletAddress!
    const notification = notificationService.sendToUser(userId, {
      type: 'announcement',
      title: 'Test Notification',
      message: 'Real-time notifications are working correctly.',
    })

    res.json({ success: true, data: notification })
  } catch (err) {
    logger.error('Error sending test notification:', err)
    res.status(500).json({ success: false, error: 'Failed to send notification' })
  }
})

/**
 * GET /api/notifications/status
 * Returns whether the authenticated user is currently connected via WebSocket.
 */
notificationsRouter.get('/status', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.walletAddress!
  res.json({
    success: true,
    data: { online: await notificationService.isUserOnline(userId) },
  })
})

// ── Reminder preferences ──────────────────────────────────────────────────

const prefsSchema = z.object({
  channels: z.array(z.enum(['email', 'push', 'sms'])).optional(),
  contributionReminderHours: z.number().int().min(1).max(168).optional(),
  payoutReminderHours: z.number().int().min(1).max(48).optional(),
  enabled: z.boolean().optional(),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional(),
})

/**
 * GET /api/notifications/reminders/preferences
 * Returns the authenticated user's reminder preferences.
 */
notificationsRouter.get('/reminders/preferences', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.walletAddress!
    const prefs = await getReminderPreferences(userId)
    res.json({ success: true, data: prefs })
  } catch (err) {
    logger.error('Error fetching reminder preferences:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch preferences' })
  }
})

/**
 * PUT /api/notifications/reminders/preferences
 * Creates or updates the authenticated user's reminder preferences.
 */
notificationsRouter.put('/reminders/preferences', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.walletAddress!
    const parsed = prefsSchema.parse(req.body)
    const prefs = await upsertReminderPreferences(userId, parsed)
    res.json({ success: true, data: prefs })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid preferences', details: err.errors })
    }
    logger.error('Error updating reminder preferences:', err)
    res.status(500).json({ success: false, error: 'Failed to update preferences' })
  }
})

// ── Web Push subscription management ─────────────────────────────────────

const pushSubSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
})

/**
 * GET /api/notifications/push/vapid-public-key
 * Returns the VAPID public key for the client to use when subscribing.
 */
notificationsRouter.get('/push/vapid-public-key', (_req, res: Response) => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return res.status(503).json({ success: false, error: 'Push notifications not configured' })
  res.json({ success: true, data: { publicKey: key } })
})

/**
 * POST /api/notifications/push/subscribe
 * Saves a Web Push subscription for the authenticated user.
 */
notificationsRouter.post('/push/subscribe', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.walletAddress!
    const { endpoint, keys } = pushSubSchema.parse(req.body)
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    })
    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid subscription', details: err.errors })
    }
    logger.error('Error saving push subscription:', err)
    res.status(500).json({ success: false, error: 'Failed to save subscription' })
  }
})

/**
 * DELETE /api/notifications/push/unsubscribe
 * Removes a Web Push subscription by endpoint.
 */
notificationsRouter.delete('/push/unsubscribe', async (req: AuthRequest, res: Response) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body)
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.walletAddress! } })
    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid request', details: err.errors })
    }
    logger.error('Error removing push subscription:', err)
    res.status(500).json({ success: false, error: 'Failed to remove subscription' })
  }
})
