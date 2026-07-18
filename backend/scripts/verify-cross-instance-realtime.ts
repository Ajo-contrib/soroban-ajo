/**
 * Cross-instance delivery proof for the REAL production real-time stack,
 * driven purely over HTTP/WebSocket against two ALREADY-RUNNING, SEPARATE OS
 * processes (see scripts/realtime-instance.ts). This process shares no
 * in-memory state with either instance — it only talks to them the way a
 * client or another service would, which is what makes this a genuine test
 * of horizontal scaling. (An earlier version of this script imported
 * chatService/notificationService directly and booted "two instances" inside
 * one Node process — that was invalid, because those services are
 * module-level singletons: both "instances" shared the same singleton `io`,
 * so cross-instance delivery looked correct even without the Redis adapter.
 * Real separate processes are required to actually exercise the fix.)
 *
 * Requires: two instances already running (e.g. via scripts/realtime-instance.ts),
 * both pointed at the same DATABASE_URL and REDIS_URL, plus the seed data
 * from scripts/seed-verify-users.ts already applied.
 *
 *   URL_A=http://localhost:4101 URL_B=http://localhost:4102 \
 *   DATABASE_URL=... JWT_SECRET=<same as instances> \
 *   npx tsx scripts/verify-cross-instance-realtime.ts
 */
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { AuthService } from '../src/services/authService'
import { chatService } from '../src/services/chatService'
import { prisma } from '../src/config/database'
import { seed, USER_A, USER_B, GROUP_ID } from './seed-verify-users'

const URL_A = process.env.URL_A || 'http://localhost:4101'
const URL_B = process.env.URL_B || 'http://localhost:4102'

const print = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}

function connectClient(url: string, user: typeof USER_A): Promise<ClientSocket> {
  const socket = ioClient(url, {
    auth: { userId: user.userId, walletAddress: user.walletAddress },
    transports: ['websocket'],
  })
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket))
    socket.on('connect_error', reject)
  })
}

function waitFor<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    socket.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

function authHeader(walletAddress: string): string {
  return `Bearer ${AuthService.generateToken(walletAddress)}`
}

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  print(`  ${ok ? '✅' : '❌'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failures++
}

// createChatRoom/addParticipant are plain Prisma writes with no dependency on
// a live `io` — safe to call from this separate verifier process; the actual
// cross-instance emit happens inside the two running instance processes when
// their sockets call send_message, not here.
async function ensureChatRoom(): Promise<string> {
  const existing = await prisma.chatRoom.findUnique({ where: { groupId: GROUP_ID } })
  const room = existing ?? (await chatService.createChatRoom(GROUP_ID, 'Cross-instance verification room'))
  await chatService.addParticipant(room.id, USER_A.userId)
  await chatService.addParticipant(room.id, USER_B.userId)
  return room.id
}

async function main(): Promise<void> {
  await seed()
  const roomId = await ensureChatRoom()

  print(`▶ Verifying against two separately-launched instances: A=${URL_A} B=${URL_B}`)

  const clientA = await connectClient(URL_A, USER_A)
  const clientB = await connectClient(URL_B, USER_B)
  await new Promise((r) => setTimeout(r, 400))

  print('\n▶ TEST 1: POST /api/notifications/test on instance A targets user B → client B (on instance B) receives it')
  const p1 = waitFor<{ userId: string; title: string }>(clientB, 'notification')
  const res1 = await fetch(`${URL_A}/api/notifications/test`, {
    method: 'POST',
    headers: { authorization: authHeader(USER_B.walletAddress) },
  })
  check('REST call to instance A succeeded', res1.ok, `(status ${res1.status})`)
  const notif = await p1
  check('client B received the notification triggered via instance A REST', notif?.userId === USER_B.walletAddress, `got ${JSON.stringify(notif)}`)

  print('\n▶ TEST 2: GET /api/notifications/status on instance A reflects user B (connected to instance B) as online — shared presence')
  const res2 = await fetch(`${URL_A}/api/notifications/status`, {
    headers: { authorization: authHeader(USER_B.walletAddress) },
  })
  const body2 = (await res2.json()) as { data: { online: boolean } }
  check('instance A reports user B online (cross-instance presence)', body2.data?.online === true, `got ${JSON.stringify(body2)}`)

  print('\n▶ TEST 3: chat message sent by client A (instance A) reaches client B (instance B) in the same room')
  clientA.emit('join_room', { roomId })
  clientB.emit('join_room', { roomId })
  await new Promise((r) => setTimeout(r, 300))

  const p3 = waitFor<{ content: string; userId: string }>(clientB, 'new_message')
  clientA.emit('send_message', { roomId, content: 'hello across instances' })
  const message = await p3
  check('client B received the chat message sent by client A across instances', message?.content === 'hello across instances' && message?.userId === USER_A.userId, `got ${JSON.stringify(message)}`)

  clientA.close()
  clientB.close()
  await prisma.$disconnect()

  print(`\n${failures === 0 ? '✅ ALL CROSS-INSTANCE CHECKS PASSED (real chatService/notificationService, two separate processes)' : `❌ ${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  print(`verifier crashed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})
