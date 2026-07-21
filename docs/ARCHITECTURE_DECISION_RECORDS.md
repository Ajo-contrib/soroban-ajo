# Architecture Decision Records (ADRs)

This document contains all significant architectural decisions made for the Soroban Ajo project. Each ADR follows the standard format with context, options, decision, and consequences.

## Table of Contents

1. [ADR-001: Blockchain Platform Selection](#adr-001-blockchain-platform-selection)
2. [ADR-002: Smart Contract Language](#adr-002-smart-contract-language)
3. [ADR-003: Backend Framework](#adr-003-backend-framework)
4. [ADR-004: Frontend Framework](#adr-004-frontend-framework)
5. [ADR-005: Database Architecture](#adr-005-database-architecture)
6. [ADR-006: Authentication Strategy](#adr-006-authentication-strategy)
7. [ADR-007: API Design Pattern](#adr-007-api-design-pattern)
8. [ADR-008: State Management](#adr-008-state-management)
9. [ADR-009: Testing Strategy](#adr-009-testing-strategy)
10. [ADR-010: Deployment Architecture](#adr-010-deployment-architecture)
11. [ADR-011: Event Sourcing Scope and Its Relationship to Prisma and the Blockchain](#adr-011-event-sourcing-scope-and-its-relationship-to-prisma-and-the-blockchain)
12. [ADR-012: Service Instantiation Pattern — Retire the DI Container](#adr-012-service-instantiation-pattern--retire-the-di-container)

---

## ADR-001: Blockchain Platform Selection

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Smart Contracts, Backend, Frontend

### Context

We needed to select a blockchain platform for implementing a decentralized savings group system. Key requirements included:
- Low transaction costs
- Fast finality
- Strong developer ecosystem
- Existing wallet infrastructure
- Suitable for financial applications

### Options Considered

1. **Ethereum**: High fees, complex smart contracts, large ecosystem
2. **Polygon**: Lower fees than Ethereum, good ecosystem
3. **Stellar**: Low fees, fast finality, built for payments, strong compliance
4. **Solana**: Very fast, low fees, but less mature for financial apps

### Decision

**Selected: Stellar Network**

Stellar was chosen because:
- Extremely low transaction costs (0.00001 XLM)
- Fast finality (3-5 seconds)
- Built specifically for payments and financial applications
- Strong regulatory compliance features
- Excellent developer documentation
- Soroban smart contract platform provides necessary functionality

### Consequences

**Positive:**
- Users can transact with minimal fees
- Fast confirmation times improve UX
- Stellar's compliance features support regulatory requirements
- Strong community support for financial applications

**Negative:**
- Smaller ecosystem compared to Ethereum
- Fewer third-party tools and libraries
- Less developer familiarity (requires education)

### Related Decisions

- ADR-002: Smart Contract Language (Rust on Soroban)
- ADR-006: Authentication Strategy (Stellar wallet integration)

---

## ADR-002: Smart Contract Language

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Smart Contracts

### Context

We needed to select a language for implementing smart contracts on Soroban. Soroban supports Rust and JavaScript/TypeScript. Key considerations:
- Performance and security
- Developer experience
- Ecosystem maturity
- Compilation to WASM

### Options Considered

1. **Rust**: Strong type system, memory safety, excellent performance
2. **JavaScript/TypeScript**: Familiar to web developers, easier learning curve

### Decision

**Selected: Rust**

Rust was chosen because:
- Memory safety prevents entire classes of bugs
- Strong type system catches errors at compile time
- Excellent performance for financial calculations
- Mature ecosystem for blockchain development
- Better for security-critical code

### Consequences

**Positive:**
- Memory safety eliminates buffer overflows and use-after-free bugs
- Strong type system prevents many runtime errors
- Excellent performance for financial operations
- Mature testing frameworks

**Negative:**
- Steeper learning curve for developers
- Longer development time initially
- Requires Rust expertise on team

### Mitigation

- Provide comprehensive documentation and examples
- Conduct Rust training for team members
- Use established patterns and libraries

---

## ADR-003: Backend Framework

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Backend API

### Context

We needed to select a backend framework for the Node.js API server. Key requirements:
- RESTful API support
- TypeScript support
- Middleware ecosystem
- Performance
- Developer productivity

### Options Considered

1. **Express.js**: Lightweight, flexible, large ecosystem
2. **NestJS**: Opinionated, built-in TypeScript, enterprise features
3. **Fastify**: High performance, modern, TypeScript support
4. **Koa**: Lightweight, modern middleware pattern

### Decision

**Selected: Express.js with TypeScript**

Express.js was chosen because:
- Lightweight and flexible
- Massive ecosystem of middleware
- Easy to learn and use
- Excellent TypeScript support
- Proven in production at scale
- Large community for troubleshooting

### Consequences

**Positive:**
- Rapid development with familiar patterns
- Extensive middleware ecosystem
- Easy to find developers with Express experience
- Flexible architecture allows custom patterns

**Negative:**
- Less opinionated than alternatives
- Requires more manual setup for enterprise features
- Performance not as high as Fastify

### Related Decisions

- ADR-007: API Design Pattern (RESTful with versioning)

---

## ADR-004: Frontend Framework

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Frontend Web Application

### Context

We needed to select a frontend framework for the web application. Key requirements:
- Server-side rendering capability
- TypeScript support
- Component ecosystem
- Performance
- Developer experience

### Options Considered

1. **Next.js**: Full-stack React framework, SSR, excellent DX
2. **React + Vite**: Lightweight, fast, requires more setup
3. **Vue.js**: Simpler learning curve, good ecosystem
4. **Svelte**: Compiler-based, excellent performance

### Decision

**Selected: Next.js 14 with App Router**

Next.js was chosen because:
- Built-in server-side rendering improves SEO
- App Router provides modern file-based routing
- Excellent TypeScript support
- Built-in optimization (image, font, code splitting)
- Vercel deployment integration
- Large ecosystem and community

### Consequences

**Positive:**
- Improved SEO with server-side rendering
- Excellent developer experience
- Built-in performance optimizations
- Easy deployment to Vercel
- Strong community and ecosystem

**Negative:**
- Larger bundle size than lightweight alternatives
- Learning curve for App Router
- Opinionated structure may not suit all projects

### Related Decisions

- ADR-008: State Management (React Query + Zustand)

---

## ADR-005: Database Architecture

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Backend, Data Layer

### Context

We needed to select a database for storing application state. Key requirements:
- ACID compliance for financial data
- Scalability
- Query flexibility
- Operational simplicity
- Cost effectiveness

### Options Considered

1. **PostgreSQL**: Mature, ACID, excellent for relational data
2. **MongoDB**: Flexible schema, good for rapid development
3. **DynamoDB**: Serverless, scalable, AWS-managed
4. **Firebase**: Serverless, real-time, managed

### Decision

**Selected: PostgreSQL with Prisma ORM**

PostgreSQL was chosen because:
- Strong ACID guarantees for financial transactions
- Excellent query performance with proper indexing
- Mature and battle-tested
- Excellent tooling ecosystem
- Cost-effective for our scale
- Prisma provides excellent TypeScript support

### Consequences

**Positive:**
- Strong consistency guarantees for financial data
- Excellent query performance
- Mature ecosystem and tooling
- Easy to scale with read replicas
- Cost-effective

**Negative:**
- Requires operational expertise
- Vertical scaling limitations
- Schema migrations can be complex

### Mitigation

- Use Prisma for schema management
- Implement proper indexing strategy
- Plan for read replicas as needed

---

## ADR-006: Authentication Strategy

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Frontend, Backend, Smart Contracts

### Context

We needed to implement authentication for the platform. Key requirements:
- Decentralized (wallet-based)
- No password management
- Stellar integration
- Secure message signing
- User-friendly

### Options Considered

1. **Wallet-based authentication**: Sign messages with wallet
2. **OAuth**: Centralized, requires third-party provider
3. **Traditional username/password**: Centralized, security risks
4. **Multi-signature**: Complex, overkill for this use case

### Decision

**Selected: Wallet-based Authentication with Message Signing**

Wallet-based auth was chosen because:
- Aligns with blockchain philosophy
- No password management needed
- Leverages existing Stellar wallets (Freighter, Albedo)
- Cryptographically secure
- User-friendly with wallet extensions

### Implementation

```typescript
// User signs a message with their wallet
const message = `Sign to authenticate: ${timestamp}`;
const signature = await wallet.signMessage(message);

// Backend verifies signature
const isValid = verifySignature(publicKey, message, signature);
```

### Consequences

**Positive:**
- No password management burden
- Leverages existing wallet infrastructure
- Cryptographically secure
- Aligns with blockchain principles
- Better user experience

**Negative:**
- Users must have a wallet
- Lost wallet = lost access (unless recovery implemented)
- Requires user education

### Related Decisions

- ADR-001: Blockchain Platform Selection (Stellar)

---

## ADR-007: API Design Pattern

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Backend API

### Context

We needed to establish API design patterns for consistency and maintainability. Key requirements:
- RESTful principles
- Versioning strategy
- Error handling
- Documentation
- Backward compatibility

### Options Considered

1. **RESTful with URL versioning**: `/api/v1/groups`
2. **RESTful with header versioning**: `Accept: application/vnd.ajo.v1+json`
3. **GraphQL**: Flexible queries, complex implementation
4. **gRPC**: High performance, less suitable for web

### Decision

**Selected: RESTful API with URL Versioning**

RESTful with URL versioning was chosen because:
- Clear, explicit versioning
- Easy to understand and use
- Supports multiple versions simultaneously
- Good for caching with CDNs
- Familiar to most developers

### API Structure

```
GET    /api/v1/groups              # List groups
POST   /api/v1/groups              # Create group
GET    /api/v1/groups/:id          # Get group
PUT    /api/v1/groups/:id          # Update group
DELETE /api/v1/groups/:id          # Delete group
POST   /api/v1/groups/:id/members  # Add member
```

### Consequences

**Positive:**
- Clear versioning strategy
- Easy to maintain multiple versions
- Good CDN caching support
- Familiar to developers
- Easy to document

**Negative:**
- URL versioning can lead to code duplication
- Requires careful migration planning
- May need multiple versions in production

---

## ADR-008: State Management

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: Frontend

### Context

We needed to select state management for the React frontend. Key requirements:
- Server state management
- Client state management
- Caching
- Developer experience
- Performance

### Options Considered

1. **Redux**: Powerful, verbose, steep learning curve
2. **Zustand**: Lightweight, simple, good DX
3. **Jotai**: Atomic state, modern approach
4. **React Query + Zustand**: Separation of concerns

### Decision

**Selected: React Query + Zustand**

This combination was chosen because:
- React Query handles server state (data fetching, caching)
- Zustand handles client state (UI state, preferences)
- Clear separation of concerns
- Excellent developer experience
- Minimal boilerplate
- Great TypeScript support

### Implementation Pattern

```typescript
// Server state with React Query
const { data: groups } = useQuery({
  queryKey: ['groups'],
  queryFn: () => api.getGroups(),
});

// Client state with Zustand
const useUIStore = create((set) => ({
  isMenuOpen: false,
  toggleMenu: () => set((state) => ({ isMenuOpen: !state.isMenuOpen })),
}));
```

### Consequences

**Positive:**
- Clear separation of concerns
- Excellent caching with React Query
- Minimal boilerplate with Zustand
- Great TypeScript support
- Easy to test

**Negative:**
- Two libraries to learn
- Requires discipline to maintain separation
- May be overkill for simple apps

---

## ADR-009: Testing Strategy

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: All

### Context

We needed to establish a comprehensive testing strategy. Key requirements:
- Unit test coverage
- Integration test coverage
- End-to-end test coverage
- Performance testing
- Security testing

### Options Considered

1. **Jest + React Testing Library**: Comprehensive, good DX
2. **Vitest + Testing Library**: Faster, modern
3. **Cypress + Jest**: E2E + unit testing
4. **Playwright + Jest**: Modern E2E testing

### Decision

**Selected: Multi-tier Testing Strategy**

- **Unit Tests**: Jest for backend and frontend
- **Integration Tests**: Jest with test containers
- **E2E Tests**: Cypress for critical user flows
- **Contract Tests**: Rust test framework for smart contracts

### Coverage Targets

| Layer | Target Coverage |
|-------|-----------------|
| Backend | 80%+ |
| Frontend | 70%+ |
| Smart Contracts | 90%+ |

### Consequences

**Positive:**
- Comprehensive coverage across all layers
- Early bug detection
- Confidence in deployments
- Good documentation through tests

**Negative:**
- Significant time investment
- Maintenance overhead
- Requires discipline

---

## ADR-010: Deployment Architecture

**Status**: Accepted  
**Date**: April 2026  
**Deciders**: Architecture Team  
**Affected Components**: All

### Context

We needed to establish a deployment architecture. Key requirements:
- Scalability
- High availability
- Easy rollbacks
- Cost efficiency
- Monitoring and logging

### Options Considered

1. **Monolithic deployment**: Single server, simple but limited
2. **Containerized (Docker + Kubernetes)**: Complex but scalable
3. **Serverless (AWS Lambda)**: Scalable, cost-efficient, vendor lock-in
4. **Platform as a Service (Vercel, Railway)**: Easy, limited control

### Decision

**Selected: Containerized Deployment with Docker**

Docker containerization was chosen because:
- Consistent environments across dev/staging/production
- Easy to scale horizontally
- Good balance of control and simplicity
- Excellent tooling ecosystem
- Cost-effective

### Deployment Targets

- **Frontend**: Vercel (Next.js optimized)
- **Backend**: Docker on Railway or DigitalOcean
- **Database**: Managed PostgreSQL (Railway, AWS RDS)
- **Smart Contracts**: Stellar network (no deployment needed)

### CI/CD Pipeline

```
Code Push → GitHub Actions → Tests → Build → Deploy
```

### Consequences

**Positive:**
- Consistent environments
- Easy horizontal scaling
- Good tooling support
- Cost-effective
- Easy rollbacks

**Negative:**
- Requires Docker knowledge
- Operational overhead
- Monitoring complexity

---

## ADR-011: Event Sourcing Scope and Its Relationship to Prisma and the Blockchain

**Status**: Accepted
**Date**: July 2026
**Deciders**: Architecture Team
**Affected Components**: Backend (`backend/src/events/`), Data Layer

### Context

`backend/src/events/` implements an event-sourcing pattern — an append-only
`EventStore` backed by a Prisma `EventStore` table, domain event types
(`GROUP_CREATED`, `MEMBER_JOINED`, `CONTRIBUTION_MADE`, etc.), a
`groupProjection` that reconstructs `GroupState` from an event stream, and
handler/dispatch scaffolding — merged via PR #540 (closing #461).

An audit of actual call sites (`git grep` for `eventStore`, `dispatchEvent`,
and `rebuildGroupState` outside `backend/src/events/`) found **zero
callers**. Nothing in any controller or service appends events, dispatches
them, or rebuilds a projection. The module compiles and is unit-tested in
isolation as of this ADR, but nothing in the running application invokes it.

Meanwhile, the actual Group/Contribution domain already has an established
and very different pattern:

- The **Soroban smart contract is the source of truth** for group and
  contribution state (see ADR-001, ADR-002). All mutating actions
  (`createGroup`, `joinGroup`, `contribute`, …) go through `SorobanService`
  and are submitted on-chain.
- `backend/src/handlers/contractEventHandlers.ts` listens for parsed
  contract events and **upserts** the corresponding Prisma rows (e.g.
  `handleGroupCreated` calls `dbService.upsertGroup(...)`). Prisma here is
  an idempotent, denormalized **read model** synced from the chain — it is
  not authoritative, the chain is.
- In other words, the blockchain itself already functions as this domain's
  append-only, replayable event log. `contractEventHandlers.ts` is already
  doing "replay a stream of domain events into a projection" — just against
  on-chain events instead of the `backend/src/events/` module.

This means `backend/src/events/` was not introduced to replace or
front the Group/Contribution CRUD tables — it duplicates a shape (event
types like `GROUP_CREATED`/`MEMBER_JOINED`/`CONTRIBUTION_MADE`, a group
projection) that the contract-event pipeline already covers, without
being wired into it. Prior to this ADR, that relationship was implicit
and undocumented, which is the problem this decision resolves.

### Options Considered

1. **Wire `backend/src/events/` into the Group/Contribution controllers
   now**, dual-writing off-chain events alongside the on-chain
   transactions. Rejected for the Group/Contribution domain specifically:
   it would create a **third** copy of group state (chain, Prisma read
   model, and this event log) with no clear precedence rule between the
   Prisma projection already produced by `contractEventHandlers.ts` and a
   new one produced by `groupProjection` — exactly the kind of ambiguity
   this audit was opened to eliminate, not add to.
2. **Make `backend/src/events/` the source of truth for groups**, with
   Prisma's `Group`/`Contribution` tables becoming a projection of it.
   Rejected: group/contribution state is already sourced from the chain;
   moving authority to an off-chain Postgres event log would contradict
   ADR-001/ADR-002 and require a data-migration effort far beyond this
   audit's scope.
3. **Keep it as an unused, hardened, opt-in module reserved for domains
   that have no existing event log** (off-chain-only workflows — e.g.
   disputes, admin actions, user lifecycle events — where nothing like
   `contractEventHandlers.ts` already plays that role), and fix its
   correctness gaps so it is safe to adopt when such a need arises.
   **Selected.**

### Decision

**`backend/src/events/` is currently unused in production and is not the
source of truth for any domain.** Prisma remains a CRUD/read-model layer
everywhere in the backend today:

- For the **Group/Contribution domain**, Prisma is a read model kept in
  sync with the Soroban smart contract (the actual source of truth) via
  `contractEventHandlers.ts`. Do **not** additionally route these actions
  through `backend/src/events/` — that would create a second, competing
  projection of the same state.
- For **any other domain**, Prisma is the source of truth directly (plain
  CRUD), same as before this audit.
- `backend/src/events/` is kept as a hardened, opt-in library for a
  **future** off-chain domain that (a) has no existing on-chain or other
  event log, and (b) genuinely needs full history/audit/replay. Until a
  domain is explicitly wired to it, treat it as unused.

If you are building a new feature, use this to decide which pattern
applies:

| Your feature involves... | Use |
|---|---|
| An action the smart contract already executes (group lifecycle, contributions, payouts) | `SorobanService` → contract → `contractEventHandlers.ts` → Prisma upsert (existing pattern) |
| A purely off-chain domain with normal query needs | Prisma CRUD directly, like the rest of the backend |
| A purely off-chain domain that needs full replayable history for audit or point-in-time reconstruction, with no existing event log | `backend/src/events/` — call `eventStore.append()` from your service, add a projection, and **wire it in explicitly** (nothing does this automatically) |

Two correctness gaps were fixed as part of this decision, since they would
have made the module unsafe to adopt regardless of which domain eventually
uses it:

- **Optimistic concurrency**: `EventStore.append()` previously accepted
  any caller-supplied `version` with no check, and the Prisma model had no
  uniqueness constraint on `(aggregateId, version)`. Two concurrent writers
  could append conflicting versions for the same aggregate, and replay
  would silently reflect only one of them. A DB-level unique constraint
  plus a `ConflictError` on violation now makes this a hard failure instead
  of silent corruption (`backend/src/events/eventStore.ts`).
- **Unbounded replay cost**: `rebuildProjection` always replayed an
  aggregate's full event history from genesis. A `Snapshot` table plus
  snapshot-aware replay (`backend/src/events/projections/index.ts`,
  `backend/src/events/snapshotStore.ts`) now bounds this for any
  long-lived aggregate, should one ever be wired in.

See `backend/src/events/README.md` for the mechanics and the test suite
under `backend/src/__tests__/unit/events/` for the correctness guarantees
(full-replay/incremental-processing equivalence, snapshot/full-replay
equivalence, and concurrent-write rejection).

### Consequences

**Positive:**
- Removes the ambiguity the audit was opened to resolve: there is now an
  explicit, written answer to "is this event-sourced or CRUD, and what's
  authoritative" for every domain in the backend.
- The module's correctness gaps (concurrency, unbounded replay) are fixed
  before any domain depends on them, instead of being discovered in
  production.
- No production code paths changed, so this carries no deployment risk.

**Negative:**
- The module remains unused; the 264 lines added in PR #540 still deliver
  no product value until a domain is explicitly wired to it.
- A future contributor could still wire it into the Group/Contribution
  domain by mistake without reading this ADR. Mitigated by the table above
  and by `backend/src/events/README.md`, but not mechanically enforced.

### Related Decisions

- ADR-001: Blockchain Platform Selection (the chain is the source of truth
  this ADR defers to)
- ADR-005: Database Architecture (Prisma's role as CRUD/read-model layer)

---

## ADR-012: Service Instantiation Pattern — Retire the DI Container

**Status**: Accepted
**Date**: July 2026
**Deciders**: Backend Team
**Affected Components**: Backend (`backend/src/services/`, `backend/src/di/`)

### Context

`backend/src/di/` (`container.ts`, `bindings.ts`, `types.ts`, `index.ts` —
338 lines total) implemented a generic DI container (`register`,
`registerClass`, `registerInstance`, `resolve`) intended to manage
instantiation and lifecycle for the services under `backend/src/services/`.

An audit of actual usage (grepping the whole backend for imports of
`di/container`, `di/bindings`, `di/index`, `DIContainer`, `setupDependencies`,
and `container.resolve`) found **zero references anywhere outside the `di/`
directory itself** — not in `src/index.ts` (the app entry point), not in any
controller, route, or test. `setupDependencies()` was never called at
startup. Every one of the eleven bindings registered in `bindings.ts`
(`SorobanService`, `ContractService`, `GroupService`, `UserService`,
`NotificationService`, `AuthService`, `GamificationService`, `RefundService`,
`DisputeService`, `EmailService`, `CacheService`, `WebhookService`) was a
placeholder factory that returns `null` — none were ever wired to a real
implementation.

Meanwhile, the ~86 files under `backend/src/services/` (including
`services/gamification/`, `services/marketing/`, `services/multisig/`) were
already consistently *not* using the container. A full inventory of the
top-level 78 service files by export shape:

| Pattern | Count | Description |
|---|---|---|
| Singleton instance export | 44 | `export const xService = new XService()` (or `export default new X()`) at module scope — e.g. `notificationService.ts`, `groupsService.ts`, `cacheService.ts` |
| Class export, caller instantiates | 16 | `export class XService { ... }`, instantiated with `new` at each call site (per-request or per-use) — e.g. `referralService.ts`, `stripeService.ts`, `paymentGatewayService.ts` |
| Function-module (namespace of functions, no class) | 11 | `export async function ...` — e.g. `searchService.ts`, `i18nService.ts`, `calendarService.ts` |
| Static-only class (no instance) | 4 | Methods called as `ClassName.method()` — e.g. `authService.ts`, `FraudDetector.ts` |
| Other (base/abstract classes, not real services) | 3 | `BaseService.ts`, `ExampleRefactoredService.ts` are generic Prisma CRUD base classes meant to be extended, not instantiated; `backupCodeService.ts` mixes patterns |

**DI-container-managed services: 0.** Direct-instantiation services (across
all four patterns above): all of them. There was no partial migration to
undo — the container was dead code from the start.

### Options Considered

1. **Complete the migration**: implement the eleven placeholder bindings for
   real, migrate ~86 services to be resolved via `container.resolve()`, and
   add compatibility singleton exports during a transition window. Rejected
   as disproportionate: no code depends on the container today, the
   direct-instantiation pattern already works and is well understood by
   contributors, and introducing container resolution across every
   controller/route would be a large, high-risk change for a benefit
   (mock injection, lifecycle control) the codebase hasn't needed in
   practice — services are already unit-testable via `jest.mock()` on the
   module.
2. **Retire the DI container**: delete `backend/src/di/`, keep the
   direct-instantiation patterns already in use, and codify them in
   contribution docs so new services stop guessing which pattern to follow.

### Decision

**Retire the DI container.** `backend/src/di/` has been removed. The
existing direct-instantiation patterns remain as-is (no call sites needed to
change, since none used the container). [CONTRIBUTING_GUIDELINES.md](../CONTRIBUTING_GUIDELINES.md)
now documents the singleton-export pattern as the default for new backend
services, with the class-export and function-module variants named as
acceptable alternatives for their respective cases (per-request state vs.
stateless utility functions).

### Consequences

**Positive:**
- One documented, consistently-followed pattern instead of a 338-line
  unused abstraction sitting alongside it.
- New contributors no longer have to guess whether a new service should be
  DI-registered or a plain singleton — `CONTRIBUTING_GUIDELINES.md` says.
- No call sites changed, so this carries no runtime risk.

**Negative:**
- Services still self-manage their dependencies (e.g. importing `prisma`
  or other singletons directly) rather than having them injected, so
  swapping an implementation for a test still relies on `jest.mock()`
  rather than container overrides. If a real need for constructor-injected
  mocking emerges, it should be reconsidered as a new ADR rather than
  reviving this container.

### Related Decisions

- ADR-003: Backend Framework (Express + services/controllers layering this
  decision operates within)

---

### When to Create an ADR

Create an ADR when:
- Making significant architectural decisions
- Choosing between major technologies
- Establishing patterns that affect multiple components
- Making decisions with long-term implications

### ADR Template

```markdown
## ADR-XXX: [Title]

**Status**: [Proposed/Accepted/Deprecated/Superseded]
**Date**: [Date]
**Deciders**: [Team members]
**Affected Components**: [List components]

### Context
[Explain the issue and why it matters]

### Options Considered
1. [Option 1]: [Pros and cons]
2. [Option 2]: [Pros and cons]

### Decision
[Explain the chosen option and why]

### Consequences
**Positive:**
- [Benefit 1]

**Negative:**
- [Drawback 1]

### Related Decisions
- [Related ADR]
```

### Review Checklist

- [ ] Problem clearly stated
- [ ] Options thoroughly evaluated
- [ ] Decision well justified
- [ ] Consequences identified
- [ ] Related decisions noted
- [ ] Team consensus achieved

---

## Superseded Decisions

None yet. As decisions are superseded, they will be marked as deprecated with references to new ADRs.

---

## Future Decisions to Make

- [ ] Caching strategy (Redis vs in-memory)
- [ ] Message queue implementation (Bull vs RabbitMQ)
- [ ] Monitoring and observability stack
- [ ] Disaster recovery strategy
- [ ] Multi-region deployment strategy

---

**Last Updated**: July 2026  
**Version**: 1.2.0  
**Maintainers**: Ajo Architecture Team

For questions or to propose new ADRs, please open an issue on GitHub or contact the architecture team.
