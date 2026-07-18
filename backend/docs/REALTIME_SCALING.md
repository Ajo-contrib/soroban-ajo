# Real-time layer: horizontal scaling (#811)

## Current-state finding

The production real-time stack — `chatService.ts` (owns the Socket.IO
server) + `notificationService.ts` (shares it via `websocketService.ts`),
wired up in `src/index.ts` as `chatService.init(server)` /
`websocketService.init(chatService.getIO())` — had **no Redis adapter** and
tracked presence/room membership in **per-instance in-memory `Map`s**
(`userSockets`, `roomParticipants` in `chatService.ts`; a separate
`userSockets` map in `notificationService.ts`). This is exactly the bug
described in the issue: a user connected to instance A would never receive a
notification or chat message triggered on instance B, and
`GET /api/notifications/status` (`isUserOnline`) would report a user offline
if their socket happened to be connected to a different instance than the one
serving the request.

This was confirmed with a negative-control test: two separate OS processes
were booted from the pre-fix code, sharing one Postgres and one Redis, and
all three cross-instance checks (notification delivery, presence, chat
delivery) failed exactly as predicted — see "Verifying cross-instance
delivery" below.

There is also a **separate, orphaned module**, `src/websocket/{server.ts,
handlers.ts, rooms.ts}` (a `WebSocketServer` class), which *does* attach a
Redis adapter — but it is never imported by `index.ts` (dead code, confirmed
via `git grep`), fails to typecheck (`@socket.io/redis-adapter` was never a
declared dependency), and its `verifyToken()` is a hardcoded stub that
authenticates every socket as the same fake user. It was left untouched
(out of scope for this fix) — flagging here for maintainers to either wire it
up properly or delete it, since as it stands it's unreachable, broken code
that could mislead future readers into thinking scaling was already solved.

Redis is not optional infrastructure to introduce for this fix — it was
already a hard dependency of this app (caching via `cacheService.ts`,
rate limiting via `rate-limit-redis`, job queues via `bullmq`/`ioredis`), so
the fix below always attaches the adapter rather than gating it behind an
optional flag.

## The fix

- `src/services/realtimePresence.ts` (new) — Redis-backed, reference-counted
  presence store (`presenceService`), replacing the in-memory maps in both
  `chatService.ts` and `notificationService.ts`. Reference-counted because a
  user can hold multiple sockets at once (multiple tabs, or sockets on
  different instances); they're only "offline" once every socket, on every
  instance, has disconnected.
- `src/services/chatService.ts` — `init()` now attaches
  `@socket.io/redis-adapter` (via two `ioredis` pub/sub clients) to the
  Socket.IO server it creates, and delegates presence/room-membership
  bookkeeping to `presenceService` instead of local `Map`s. Socket.IO's own
  room mechanism (`socket.join(roomId)`) — the actual message-routing
  primitive — becomes cross-instance-synced automatically once the adapter is
  attached; `presenceService` is separate bookkeeping for "who's online" /
  "who's a member" queries.
- `src/services/notificationService.ts` — same: local `userSockets` map
  replaced by `presenceService`; `isUserOnline()` is now `async` (Redis
  lookup) — its one caller, `GET /api/notifications/status` in
  `src/routes/notifications.ts`, was updated to `await` it.
- `package.json` — added `@socket.io/redis-adapter` (the only new
  dependency; `ioredis` was already present).

## Sticky sessions

**Not required.** Socket.IO only needs sticky sessions when a client's HTTP
polling requests (handshake, or the long-polling fallback transport) must
land on the same instance as its previous requests. With the Redis adapter
attached, presence and room-based delivery are shared across instances
regardless of which instance a given request lands on, so a client bouncing
between instances mid-handshake still converges on consistent state — sticky
sessions become a minor performance optimization (skipping a redundant
handshake round trip), not a correctness requirement.

## Verifying cross-instance delivery

`scripts/realtime-instance.ts` boots one real instance of the actual
production stack (`chatService` + `notificationService` + `websocketService`,
identical wiring to `src/index.ts`), and `scripts/verify-cross-instance-realtime.ts`
drives two independently-launched instances purely over HTTP/WebSocket.

**This must be two separate OS processes**, not two objects in one Node
process — `chatService`/`notificationService` are module-level singletons,
so "two instances" sharing a process would share the same singleton `io` and
make cross-instance delivery look correct even without the fix. (An earlier
draft of this verification made exactly that mistake and produced a false
positive; the current scripts avoid it by construction — the verifier talks
to the instances only over the network, like a real client would.)

```bash
# 1. Start Redis and Postgres, and get the schema onto the test DB
docker run -d --name ajo-redis -p 6379:6379 redis:7-alpine
docker run -d --name ajo-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ajo_test -p 5432:5432 postgres:16-alpine
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ajo_test npx prisma db push

# 2. Launch two separate instance processes sharing that Postgres + Redis
PORT=4101 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ajo_test \
  REDIS_URL=redis://localhost:6379 JWT_SECRET=<32+ chars> \
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
  SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  SOROBAN_CONTRACT_ID=test-contract-id \
  npx tsx scripts/realtime-instance.ts &

PORT=4102 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ajo_test \
  REDIS_URL=redis://localhost:6379 JWT_SECRET=<same secret> \
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
  SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  SOROBAN_CONTRACT_ID=test-contract-id \
  npx tsx scripts/realtime-instance.ts &

# 3. Verify from a third process
URL_A=http://localhost:4101 URL_B=http://localhost:4102 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ajo_test \
  JWT_SECRET=<same secret> SOROBAN_RPC_URL=... SOROBAN_NETWORK_PASSPHRASE=... SOROBAN_CONTRACT_ID=... \
  npx tsx scripts/verify-cross-instance-realtime.ts
```

The verifier connects one Socket.IO client to each instance (authenticated as
a different seeded user, using chatService's real wallet-based auth), then:

1. `POST /api/notifications/test` on instance A, targeting the user connected
   to instance B — asserts that client receives the real `notification`
   event.
2. `GET /api/notifications/status` on instance A for the user connected to
   instance B — asserts `online: true` (shared presence, not instance-local).
3. Creates a real chat room + participants, joins both clients to it, sends a
   `send_message` from the instance-A client — asserts the instance-B client
   receives the real `new_message` event.

**Results observed during development** (Redis + Postgres running locally,
two separate `tsx` processes with distinct PIDs):

- **Pre-fix code** (verified via `git stash` of the fix, same two-process
  script): all 3 checks **failed** — notification didn't cross instances,
  presence reported the instance-B user as offline, chat message didn't cross
  instances. This confirms the bug is real and the test would have caught it.
- **Post-fix code**: all 3 checks **passed** (5/5 assertions), including the
  distinct-instance-PID confirmation.

### Automated test

`tests/realtimePresence.test.ts` unit-tests the reference-counting logic in
`presenceService` (mocked `ioredis`, following this repo's existing
convention — see `src/__tests__/integration/rewards.test.ts`). It runs via
the standard `npm test` path with no additional infrastructure.
