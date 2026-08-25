# Multi-Tenancy & Multi-Deployment Isolation Audit

## 1. Executive Summary

This audit evaluates the architectural readiness of the Soroban Ajo backend and smart contract ecosystem for **multi-tenancy** and **multi-deployment isolation**.

Historically, the platform was architected around a single Soroban contract address (`SOROBAN_CONTRACT_ID`) and single-deployment infrastructure. As the platform matures towards enterprise white-labeling, cross-network support (e.g., testnet + mainnet, or private subnets), and multiple contract instances, implicit single-contract assumptions present severe risks if left unaddressed.

This document details:
1. Architectural audit across Event Sourcing (`eventStore.ts`), Caching (`cacheKeys.ts`), ML Fraud Models (`mlFraudDetectionService.ts`), and Data Stores.
2. The concrete isolation boundaries implemented to support safe multi-tenant operation.
3. Guidelines for developers and operators managing multi-contract deployments.

---

## 2. Subsystem Audit & Risk Matrix

| Subsystem | Prior Implicit Assumption | Failure Mode in Multi-Deployment Setup | Resolution / Mitigation |
| :--- | :--- | :--- | :--- |
| **Event Sourcing (`eventStore.ts`)** | Single contract; aggregate IDs are globally unique across all instances. | **Cross-Tenant State Pollution**: Aggregate IDs (such as sequential group numbers `grp-1`) collide across contracts. Projection replay mixes events from separate contracts. | Added `contractAddress`, `tenantId`, and `network` metadata to `DomainEvent`. Extended `EventStore` queries with tenant-filtering capabilities (`getByAggregateId`, `getByType`, `getAll`, `getLatestVersion`). |
| **Cache Layer (`cacheKeys.ts`)** | Global Redis namespace with static prefixes (`group:details:...`). | **Cache Key Collision / Data Leak**: A group from Contract A overwrites or leaks data into a cached view for Contract B. Global invalidations wipe all tenants indiscriminately. | Introduced `createScopedCacheKeys(scope)` and `cacheKeys.scoped(tenantIdOrContractAddress)` providing `tenant:<scope>:*` namespacing with scoped pattern invalidations (`getCacheKeyPatterns.scoped(...)`). |
| **ML Fraud Engine (`mlFraudDetectionService.ts`)** | Single platform-wide distribution of user transactions and alert resolutions. | **Training Data Contamination & Skew**: Micro-savings high-frequency patterns skew fraud threshold tuning for large enterprise savings circles. An adversarial Sybil attack against Tenant A degrades ML fraud detection across Tenant B. | Added `contractAddress` and `tenantId` to `TransactionPattern` and `FraudAlert`. Partitioned `retrainModel()` datasets per tenant/contract to isolate training and validation metrics. |
| **Relational DB (Prisma)** | Models share public Postgres schema with wallet address uniqueness. | Users participating across different white-labeled deployments could have conflicting permission contexts if not properly bounded. | Preserved shared user identity model (Stellar public key) while scoping group memberships, contributions, and event sourcing records to contract / tenant instances. |

---

## 3. Detailed Architectural Mitigations

### 3.1 Event Sourcing Isolation (`eventStore.ts`)

`DomainEvent` metadata now explicitly supports multi-tenancy attributes:
```typescript
export interface DomainEvent<T = Record<string, unknown>> {
  id: string
  type: EventType
  aggregateId: string
  aggregateType: string
  payload: T
  metadata: {
    userId?: string
    timestamp: string
    version: number
    correlationId?: string
    contractAddress?: string
    tenantId?: string
    network?: string
  }
}
```

Query methods accept optional `EventQueryOptions`:
```typescript
export interface EventQueryOptions {
  contractAddress?: string
  tenantId?: string
  network?: string
}

// Scoped queries filter events matching the exact deployment context
const events = await eventStore.getByAggregateId('group-123', 0, {
  contractAddress: 'CA_TESTNET_123',
  tenantId: 'white-label-partner-a',
})
```

### 3.2 Redis Cache Partitioning (`cacheKeys.ts`)

To prevent key collisions across deployments sharing a Redis cluster, `cacheKeys` provides scoped instances:
```typescript
// Unscoped (Default / Single deployment):
cacheKeys.groupDetails('grp-1') // -> "group:details:grp-1"

// Scoped (Multi-tenant deployment):
const tenantCache = cacheKeys.scoped('org_acme_prod')
tenantCache.groupDetails('grp-1') // -> "tenant:org_acme_prod:group:details:grp-1"

// Scoped invalidation patterns:
const tenantPatterns = getCacheKeyPatterns.scoped('org_acme_prod')
await cacheService.invalidatePattern(tenantPatterns.tenantAll()) // Invalidate only tenant's keys
```

### 3.3 Fraud Detection & Model Versioning Isolation

When retraining candidate ML models:
1. `retrainModel({ contractAddress, tenantId })` filters reviewed alerts and user feedback specifically for that tenant/contract.
2. Metrics (precision, recall, F1 score) are evaluated strictly against the tenant's held-out validation set.
3. Candidate models are tagged with the tenant identifier (e.g. `fraud-statistical-org_acme-1718000000000`) and activated independently.

---

## 4. Best Practices for Developers & Operators

1. **Explicit Contract Context**: When dispatching blockchain listener events to the backend, always populate `metadata.contractAddress` and `metadata.network` from the listener configuration.
2. **Cache Isolation by Default**: In multi-tenant routes or services handling multiple white-labeled organizations, instantiate `cacheKeys.scoped(req.tenantId)` at request initialization.
3. **Model Maintenance**: Periodically trigger `retrainModel({ tenantId })` for high-volume tenants to maintain optimal z-score and statistical thresholds tailored to their specific user demographics.

---
