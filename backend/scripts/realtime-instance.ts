/**
 * Boots ONE real backend process running the actual production real-time
 * stack (chatService + notificationService + websocketService, wired exactly
 * as in src/index.ts) plus the real notifications REST router.
 *
 * This MUST run as its own OS process (not imported alongside another
 * "instance" in the same Node process) — chatService/notificationService are
 * module-level singletons, so two "instances" sharing one process would
 * share the same singleton `io` and trivially look cross-instance-safe even
 * without the Redis adapter. Separate processes are what make this a real
 * test of horizontal scaling.
 *
 * Env: PORT (default 4101). Requires DATABASE_URL, REDIS_URL, JWT_SECRET,
 * and the Soroban config vars (see backend/.env.example).
 *
 *   PORT=4101 DATABASE_URL=... REDIS_URL=redis://localhost:6379 \
 *   JWT_SECRET=<32+ chars> npx tsx scripts/realtime-instance.ts
 */
import express from 'express'
import { createServer } from 'http'
import { prisma } from '../src/config/database'
import { chatService } from '../src/services/chatService'
import { websocketService } from '../src/services/websocketService'
import { notificationsRouter } from '../src/routes/notifications'
import { errorHandler } from '../src/middleware/errorHandler'

const PORT = Number(process.env.PORT || 4101)

async function main(): Promise<void> {
  const app = express()
  app.use(express.json())
  app.use('/api/notifications', notificationsRouter)
  app.use(errorHandler)

  const http = createServer(app)
  chatService.init(http)
  websocketService.init(chatService.getIO())

  http.listen(PORT, () => {
    process.stdout.write(`▶ realtime instance listening on :${PORT} (pid ${process.pid})\n`)
  })

  const stop = async (): Promise<void> => {
    await prisma.$disconnect()
    http.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((error) => {
  process.stderr.write(`instance failed to start: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
