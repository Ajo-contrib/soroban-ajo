# GraphQL / REST parity — coverage notes

Written for issue #807. Scope was deliberately kept to what's needed for the
GraphQL layer to be a trustworthy second API surface, not a 1:1 mirror of
every REST route.

## Before this PR

The GraphQL layer (`schema.ts`, `server.ts`, `dataloader.ts`) didn't run at
all: `@apollo/server`, `@graphql-tools/schema`, `@graphql-tools/utils`,
`dataloader`, and `graphql-tag` were imported but never declared in
`package.json`, and `setupGraphQL()` was never called from `src/index.ts`.
The schema covered Group (read-only), Goal, and Reward, with no auth checks
on any resolver and no rate limiting of any kind.

## Domain coverage added

| Domain | Reads | Writes | Backed by |
|---|---|---|---|
| Groups | `groups`, `group`, `Group.members`, `Group.contributions` | (unchanged — writes go through REST/on-chain today) | Prisma (`Group`/`GroupMember`/`Contribution`), same tables the old resolvers already read |
| Contributions | `Group.contributions` | — | Prisma `Contribution`, via a new batched dataloader |
| Payouts | `payouts(groupId)` | — | Prisma `Payout`. REST has no read endpoint for this either (payouts are cron/saga-written); this is net-new coverage, not a port of an existing route |
| Disputes | `dispute(id)`, `disputesByGroup` | `fileDispute`, `voteOnDispute` | `disputeService` (Redis-backed), same functions `routes/disputes.ts` calls |
| Insurance | `insurancePool` | `fileInsuranceClaim`, `processInsuranceClaim` | `insuranceService`, same functions `routes/insurance.ts` calls |
| Gamification | `gamificationStats`, `leaderboard`, `activityFeed` | — | `gamificationService`, same functions `routes/gamification.ts` calls (that REST router is currently commented out of `index.ts` — GraphQL is the only live surface for this domain right now) |
| Goals / Rewards | `goals`, `goal`, `rewards`, `rewardHistory` | `createGoal`, `updateGoal`, `deleteGoal`, `redeemReward` | `goalsService` / `rewardService`, replacing the direct `prisma.goal`/`prisma.reward` calls the resolvers used before (business logic — BigInt handling, ownership checks — now has one source of truth) |

All new/changed resolvers call the same service-layer functions the
equivalent REST controller calls. Nothing under `services/` was duplicated.

## Intentionally REST-only

Everything else under `routes/` (~40 remaining route files: admin, KYC/AML,
multisig, DEX, chat, websocket, webhooks, backups, GDPR export, marketing,
social sharing, search, i18n, SMS/email delivery, analytics/BI dashboards,
referrals, loans, refunds, verification, audit, security, saga inspection,
job scheduling, etc.) stays REST-only. These are either infra/ops surfaces
with no client-facing read/write shape, admin-console-only, webhook receivers,
or built around file upload/binary payloads — none of that maps naturally
onto a GraphQL query/mutation, and porting it wouldn't reduce N+1 risk or
close an auth gap, which is what this issue is actually about.

## Auth parity

Every resolver that reads or writes a specific user's data now requires
`context.walletAddress` (resolved from the same `Bearer` JWT REST verifies
via `AuthService.verifyToken`) and, where relevant, an ownership check:

- `createGoal`/`updateGoal`/`deleteGoal`/`redeemReward` — previously took a
  client-supplied `userId`/no owner check at all (`updateGoal`/`deleteGoal`
  could mutate *any* goal by id). Now the caller's identity comes only from
  their verified token, and update/delete verify `goal.userId === caller`
  before touching anything.
- `gamificationStats`/`activityFeed` — deliberately take **no** target-user
  argument. REST's `/api/gamification/stats` and `/activity` only ever
  resolve `req.user.walletAddress`; accepting an arbitrary argument here
  would be a parity *regression*, not an improvement.
- `fileDispute`/`voteOnDispute`/`fileInsuranceClaim`/`processInsuranceClaim`
  require auth, matching their REST routes' `authMiddleware`.
- `processInsuranceClaim` requires *an* authenticated caller, not a verified
  admin role — matching REST's actual behavior in `routes/insurance.ts`
  today (the route comment says "admin only" but the code never checks
  `req.admin`). Silently tightening this under the banner of "parity" would
  make GraphQL diverge from REST, which is the opposite of the ask; fixing
  that gap is a REST-side security fix and out of scope here.
- `leaderboard`, `groups`/`group`, `goals`/`rewards`/`rewardHistory` stay
  public/keyed-by-argument reads, matching REST's existing (lax) behavior for
  those routes. `goals`/`rewards` reads accepting an arbitrary `userId` is a
  pre-existing REST behavior (Goal has an `isPublic` flag suggesting a public
  profile use case), not something introduced here — left as a follow-up if
  the maintainers want it filtered.

`verifyAdminToken` was extracted out of the `adminAuth` Express middleware
(`middleware/adminAuth.ts`) so the GraphQL context builder (`context.ts`)
resolves admin tokens through the identical code path REST uses, rather than
re-implementing JWT verification.

## N+1 prevention

`Group.members` and `Group.contributions` go through
`membersByGroupLoader`/`contributionsByGroupLoader` (`dataloader.ts`), each
issuing a single batched `findMany({ where: { groupId: { in: [...] } } })`
regardless of how many groups are in the result page. Proven in
`__tests__/dataloader-n-plus-one.test.ts`: 5 groups × (2 members + 3
contributions each) resolves with exactly one `groupMember.findMany` call and
one `contribution.findMany` call, not five of each.

Disputes/insurance aren't part of this story — they're Redis/on-chain reads
with no per-parent SQL fan-out to batch.

## Query-complexity rate limiting

`complexity.ts` scores every operation with `graphql-query-complexity`
(`simpleEstimator` + `fieldExtensionsEstimator`, default complexity 1/field)
via an Apollo `didResolveOperation` plugin (`server.ts`) that runs **before
any resolver executes** — so a request over budget (`GRAPHQL_MAX_COMPLEXITY`,
default 1000) never touches the database at all. This catches both deep
nesting and the aliasing variant of the same attack (repeating one field
selection hundreds of times under different aliases), which a flat
per-IP/per-request limiter can't distinguish from a single cheap query.
Proven in `__tests__/complexity.test.ts`. The `/graphql` endpoint also sits
behind the same per-IP limiter as `/api` (`createIpLimiter('api')`) as a
coarse floor underneath the complexity check.

Not implemented (follow-up, not needed to meet the acceptance criteria):
per-field cost multipliers keyed off pagination args (e.g. `groups(limit:
1000)` currently costs the same as `groups(limit: 1)` in the complexity
score — only the *shape* of the query is scored, not requested list sizes).

## Known gaps, called out rather than silently left

- `Subscription.groupUpdated`/`contributionAdded` are declared in the schema
  but have no resolvers/pubsub wiring — that predates this PR and is a
  separate, materially bigger effort (websocket transport, event publishing
  from the write paths) than fits here.
- The Prisma-backed `Group` type here reads from a different data source than
  REST's `/api/groups`, which reads live from the Soroban contract via
  `SorobanService`/`GroupsService`. Reconciling those two into one source of
  truth is a bigger architectural question than this issue and wasn't
  attempted; the dataloader/N+1 work targets the Prisma-backed path since
  that's what the existing schema already exposed.
- Running the test suite locally requires a reachable Postgres
  (`DATABASE_URL` in `.env.test`) for Jest's `globalSetup`
  (`tests/setup.ts`), and several services construct real Redis clients at
  module load (`rewardService`, `disputeService` via `cacheService`). Neither
  is provisioned in `.github/workflows/ci.yml`'s `tests-js` job today — this
  predates this PR (every existing integration/saga test needs the same
  infra) and isn't specific to the tests added here, which mock Prisma and
  stub the Redis-backed services out precisely to avoid that dependency.
