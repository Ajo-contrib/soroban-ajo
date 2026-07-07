import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { errorHandler } from './middleware/errorHandler'
import { requestLogger } from './middleware/requestLogger'
import {
  enhancedLoggingMiddleware,
  errorLoggingMiddleware,
  performanceMonitoringMiddleware,
  requestBodyLoggingMiddleware,
} from './middleware/enhancedLogging'
import { logger } from './utils/logger'
import { groupsRouter } from './routes/groups'
import { healthRouter } from './routes/health'
import { webhooksRouter } from './routes/webhooks'
import { authRouter } from './routes/auth'
import analyticsRouter from './routes/analytics'
import { emailRouter } from './routes/email'
import { jobsRouter } from './routes/jobs'
import { notificationsRouter } from './routes/notifications'
import { verificationRouter } from './routes/verification'
import { searchRouter } from './routes/search'
import { membersRouter } from './routes/members'
import { marketingRouter } from './routes/marketing'
import { socialSharingRouter } from './routes/socialSharing'
// import { gamificationRouter } from './routes/gamification' // Temporarily disabled
// import { goalsRouter } from './routes/goals' // Temporarily disabled due to type errors
import { setupSwagger } from './swagger'
import {
  apiLimiter,
  strictLimiter,
  publicReadLimiter,
  analyticsLimiter,
} from './middleware/rateLimiter'
import { startWorkers, stopWorkers } from './jobs/jobWorkers'
import { startScheduler, stopScheduler } from './cron/scheduler'
import { chatService } from './services/chatService'
import { websocketService } from './services/websocketService'
import { adminRouter } from './routes/admin'
import { versionsRouter } from './routes/versions'
import { ipBlocklist, ddosProtection } from './middleware/ddosProtection'
import { requestThrottle } from './middleware/requestThrottle'
import { apiVersionMiddleware } from './middleware/apiVersion'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'] : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}))
app.set('trust proxy', 1)

// DDoS & IP protection — run before everything else
app.use(ipBlocklist)
app.use(ddosProtection)
app.use(requestThrottle)

app.use(requestLogger)
app.use(enhancedLoggingMiddleware)
app.use(performanceMonitoringMiddleware(1000)) // Log requests slower than 1 second
app.use(requestBodyLoggingMiddleware)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Global API rate limit
app.use('/api', apiLimiter)

// API Versioning middleware - applies to all /api routes
app.use('/api', apiVersionMiddleware)

// API Documentation
setupSwagger(app)

// Routes
app.use('/health', healthRouter)
app.use('/api/versions', versionsRouter)
app.use('/api/auth', strictLimiter, authRouter)
app.use('/api/groups', publicReadLimiter, groupsRouter)
app.use('/api/webhooks', strictLimiter, webhooksRouter)
app.use('/api/analytics', analyticsLimiter, analyticsRouter)
app.use('/api/email', emailRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/verification', verificationRouter)
app.use('/api/search', searchRouter)
app.use('/api/members', membersRouter)
app.use('/api/marketing', marketingRouter)
app.use('/api/share', socialSharingRouter)
// app.use('/api/gamification', gamificationRouter) // Temporarily disabled due to missing auth middleware
// app.use('/api/goals', goalsRouter) // Temporarily disabled due to type errors

// Disputes
import { disputesRouter } from './routes/disputes'
app.use('/api/disputes', disputesRouter)

// Templates
import { templatesRouter } from './routes/templates'
app.use('/api/templates', templatesRouter)

// Admin
app.use('/api/admin', adminRouter)

// Audit logs
import { auditRouter } from './routes/audit'
app.use('/api/audit', auditRouter)

// Backups
import { backupRouter } from './routes/backup'
app.use('/api/backups', backupRouter)

// Payments
import { paymentsRouter } from './routes/payments'
app.use('/api/payments', paymentsRouter)

// Payment Webhooks (no auth required - verified by signature)
import { paymentWebhooksRouter } from './routes/paymentWebhooks'
app.use('/api/webhooks/payments', paymentWebhooksRouter)

// E2E Encryption key exchange — Issue #611
import { e2eRouter } from './routes/e2e'
app.use('/api/e2e', strictLimiter, e2eRouter)

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found'
  })
})

// Error handling
app.use(errorLoggingMiddleware)
app.use(errorHandler)

// Start server and keep reference so we can close it on shutdown
const server = createServer(app)

// Initialize Socket.IO (chat + notifications)
chatService.init(server)
websocketService.init(chatService.getIO())

server.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`, { env: process.env.NODE_ENV || 'development' })

  // Start background job workers and cron scheduler
  try {
    startWorkers()
    startScheduler()
    logger.info('Background jobs and cron scheduler started')
  } catch (err) {
    logger.error('Failed to start background jobs', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down gracefully...')
  // stop accepting new connections
  if (server && server.close) {
    server.close((err?: Error) => {
      if (err) {
        logger.error('Error closing server', { error: err.message })
      } else {
        logger.info('HTTP server closed')
      }
    })
  }

  stopScheduler()
  await stopWorkers()
  // give a short delay in case there are pending callbacks
  setTimeout(() => process.exit(0), 100)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export default app
