// Issue #25: Integrate Stellar SDK for contract interaction
// Complexity: Medium (150 pts)
// Status: Enhanced with retry mechanisms, error handling, and intelligent caching
// #80: Performance metrics and stable references for frontend re-render optimization

import { analytics, trackUserAction } from './analytics'
import { showNotification } from '../utils/notifications'
import { cacheService, CacheTags } from './cache'
import { httpRequest, interceptorManager } from '../utils/interceptors'
import * as SorobanClient from 'stellar-sdk'
import {
  requestAccess,
  signTransaction,
  isConnected,
  isAllowed,
  setAllowed,
} from '@stellar/freighter-api'
import { SorobanTransactionResponse } from '../types'

// Cache TTL configurations (in milliseconds)
const CACHE_TTL = {
  GROUP_STATUS: 30 * 1000, // 30 seconds - frequently changing
  GROUP_MEMBERS: 60 * 1000, // 1 minute - changes less often
  GROUP_LIST: 45 * 1000, // 45 seconds - moderate changes
  TRANSACTIONS: 2 * 60 * 1000, // 2 minutes - historical data
  USER_PROFILE: 5 * 60 * 1000, // 5 minutes - user data changes infrequently
} as const

// Setup interceptors for Soroban service
const setupInterceptors = () => {
  // Request interceptor: Add Soroban-specific headers
  interceptorManager.addRequestInterceptor((config) => {
    return {
      ...config,
      headers: {
        ...config.headers,
        'X-Soroban-Client': 'ajo-frontend',
        'X-Request-ID': `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      },
    }
  })

  // Error interceptor: Handle Soroban-specific errors
  interceptorManager.addErrorInterceptor((error) => {
    if (error.config.url?.includes('soroban') || error.config.url?.includes('stellar')) {
      analytics.trackError(
        error as Error,
        {
          operation: 'soroban_http',
          url: error.config.url,
          method: error.config.method,
        },
        'medium'
      )
    }
    throw error
  })
}

// Initialize interceptors
setupInterceptors()

// Retry configuration
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY = 1000
const RETRY_BACKOFF_MULTIPLIER = 2

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5 // failures before opening circuit
const CIRCUIT_BREAKER_TIMEOUT = 60000 // 1 minute before trying again

interface RetryOptions {
  maxRetries?: number
  initialDelay?: number
  backoffMultiplier?: number
  shouldRetry?: (error: any) => boolean
}

// Circuit breaker state
/**
 * Circuit Breaker pattern to prevent cascading failures in Soroban RPC calls.
 */
class CircuitBreaker {
  private failures: number = 0
  private lastFailureTime: number = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'

  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if timeout has passed
      if (Date.now() - this.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
        this.state = 'half-open'
        return false
      }
      return true
    }
    return false
  }

  recordSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  }

  recordFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()

    if (this.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.state = 'open'
      console.warn('[Circuit Breaker] Circuit opened due to repeated failures')
    }
  }

  reset(): void {
    this.failures = 0
    this.state = 'closed'
  }
}

const circuitBreaker = new CircuitBreaker()

// Retry wrapper with exponential backoff and circuit breaker
/**
 * Wrapper for async operations with exponential backoff and circuit breaker.
 *
 * @param operation - The operation to execute
 * @param operationName - Name of the operation (for logging)
 * @param options - Retry and backoff configuration
 * @returns Result of the operation
 * @throws The last error encountered if all retries fail
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = MAX_RETRIES,
    initialDelay = INITIAL_RETRY_DELAY,
    backoffMultiplier = RETRY_BACKOFF_MULTIPLIER,
    shouldRetry = isRetryableError,
  } = options

  // Check circuit breaker
  if (circuitBreaker.isOpen()) {
    throw new Error(
      `Circuit breaker is open for ${operationName}. Service temporarily unavailable.`
    )
  }

  let lastError: any
  let delay = initialDelay

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation()

      // Record success in circuit breaker
      circuitBreaker.recordSuccess()

      return result
    } catch (error) {
      lastError = error

      // Log the error
      analytics.trackError(
        error as Error,
        {
          operation: operationName,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
        },
        attempt === maxRetries ? 'high' : 'medium'
      )

      // Check if we should retry
      if (attempt < maxRetries && shouldRetry(error)) {
        console.warn(
          `[Retry] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`,
          error
        )

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay))

        // Exponential backoff
        delay *= backoffMultiplier
      } else {
        break
      }
    }
  }

  // Record failure in circuit breaker
  circuitBreaker.recordFailure()

  // All retries exhausted
  throw lastError
}

// Determine if an error is retryable
function isRetryableError(error: any): boolean {
  // Network errors
  if (error.name === 'NetworkError' || error.message?.includes('network')) {
    return true
  }

  // Timeout errors
  if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
    return true
  }

  // Rate limiting (429)
  if (error.status === 429 || error.code === 'RATE_LIMIT_EXCEEDED') {
    return true
  }

  // Temporary server errors (5xx)
  if (error.status >= 500 && error.status < 600) {
    return true
  }

  // Soroban-specific retryable errors
  if (error.code === 'TRANSACTION_PENDING' || error.code === 'TRY_AGAIN_LATER') {
    return true
  }

  return false
}

// Error classification for better user messaging
function classifyError(error: any): {
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
} {
  // User errors (non-retryable)
  if (error.code === 'INSUFFICIENT_BALANCE') {
    return { message: 'Insufficient balance to complete transaction', severity: 'medium' }
  }
  if (error.code === 'INVALID_PARAMETERS') {
    return { message: 'Invalid parameters provided', severity: 'medium' }
  }
  if (error.code === 'UNAUTHORIZED') {
    return { message: 'Wallet authorization required', severity: 'medium' }
  }

  // Network errors
  if (error.name === 'NetworkError' || error.message?.includes('network')) {
    return { message: 'Network connection error. Please check your connection.', severity: 'high' }
  }

  // Contract errors
  if (error.code === 'CONTRACT_ERROR') {
    return { message: 'Smart contract execution failed', severity: 'high' }
  }

  // Default
  return { message: 'An unexpected error occurred', severity: 'critical' }
}

export interface CreateGroupParams {
  groupName: string
  cycleLength: number
  contributionAmount: number
  maxMembers: number
}

/**
 * Core interface for interacting with Soroban smart contracts.
 */
export interface SorobanService {
  /**
   * Create a new savings group on the blockchain.
   *
   * @param params - Group configuration
   * @returns Transaction hash/group ID
   */
  createGroup: (params: CreateGroupParams) => Promise<string>

  /**
   * Join an existing savings group.
   *
   * @param groupId - The unique ID of the group
   */
  joinGroup: (groupId: string) => Promise<void>

  /**
   * Make a contribution to a savings group.
   *
   * @param groupId - The unique ID of the group
   * @param amount - Amount to contribute in XLM
   */
  contribute: (groupId: string, amount: number) => Promise<void>

  /**
   * Get the current status of a savings group.
   *
   * @param groupId - The unique ID of the group
   * @param useCache - Whether to prioritize cached data
   */
  getGroupStatus: (groupId: string, useCache?: boolean) => Promise<any>

  /**
   * Get members of a savings group with their contribution stats.
   *
   * @param groupId - The unique ID of the group
   * @param useCache - Whether to prioritize cached data
   */
  getGroupMembers: (groupId: string, useCache?: boolean) => Promise<any[]>

  /**
   * Get all groups a user is participating in.
   *
   * @param userId - User's Stellar public key
   * @param useCache - Whether to prioritize cached data
   */
  getUserGroups: (userId: string, useCache?: boolean) => Promise<any[]>

  /**
   * Fetch transaction history for a savings group.
   *
   * @param groupId - The unique ID of the group
   * @param cursor - Pagination cursor
   * @param limit - Max number of transactions to return
   */
  getTransactions: (
    groupId: string,
    cursor?: string,
    limit?: number
  ) => Promise<{ transactions: any[]; nextCursor?: string }>

  /** Invalidate group-specific status and members cache */
  invalidateGroupCache: (groupId: string) => void

  /** Invalidate user-specific groups list cache */
  invalidateUserCache: (userId: string) => void

  /** Clear all Soroban-related cache */
  clearCache: () => void

  /**
   * File an insurance claim for a defaulted contribution.
   *
   * @param groupId - The group ID where the default occurred
   * @param cycle - The cycle number where the default happened
   * @param claimant - Address of the member filing the claim
   * @param defaulter - Address of the member who defaulted
   * @param amount - Amount being claimed (in stroops)
   */
  fileInsuranceClaim: (
    groupId: string,
    cycle: number,
    claimant: string,
    defaulter: string,
    amount: number
  ) => Promise<string>

  /**
   * Process an insurance claim (approve/reject).
   *
   * @param claimId - The ID of the claim to process
   * @param approved - Whether to approve (true) or reject (false) the claim
   */
  processInsuranceClaim: (claimId: string, approved: boolean) => Promise<void>

  /**
   * Get details of a specific insurance claim.
   *
   * @param claimId - The ID of the claim to retrieve
   */
  getInsuranceClaim: (claimId: string) => Promise<any>

  /**
   * Get insurance pool information for a token.
   *
   * @param tokenAddress - Token contract address
   */
  getInsurancePool: (tokenAddress: string) => Promise<any>

  /**
   * Verify a claim automatically based on on-chain data.
   *
   * @param claimId - The ID of the claim to verify
   */
  verifyInsuranceClaim: (claimId: string) => Promise<boolean>

  /**
   * Set metadata for a group.
   *
   * @param groupId - The group ID to set metadata for
   * @param name - Group name (max 100 characters)
   * @param description - Group description (max 500 characters)
   * @param rules - Group rules (max 1000 characters)
   */
  setGroupMetadata: (
    groupId: string,
    name: string,
    description: string,
    rules: string
  ) => Promise<void>

  /**
   * Get metadata for a group.
   *
   * @param groupId - The group ID to get metadata for
   */
  getGroupMetadata: (groupId: string) => Promise<any>

  /**
   * Execute multiple contract operations in a single transaction.
   *
   * @param operations - Array of operations to batch
   * @param options - Batch execution options
   */
  executeBatch: (
    operations: any[],
    options?: { simulateOnly?: boolean; timeout?: number }
  ) => Promise<any>

  /**
   * Estimate gas cost for a batch of operations.
   *
   * @param operations - Array of operations to estimate
   */
  estimateBatchGas: (
    operations: any[]
  ) => Promise<{ gasEstimate: number; feeEstimate: number; operationCount: number }>

  /**
   * Make an HTTP request with interceptors.
   *
   * @param config - Request configuration
   */
  httpRequest: <T = any>(config: {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    headers?: Record<string, string>
    body?: any
    timeout?: number
    retries?: number
    cache?: boolean
    cacheTTL?: number
  }) => Promise<{
    data: T
    status: number
    statusText: string
    headers: Record<string, string>
    duration: number
    cached: boolean
  }>

  /**
   * Add a custom request interceptor.
   *
   * @param interceptor - Request interceptor function
   */
  addRequestInterceptor: (interceptor: (config: any) => any | Promise<any>) => number

  /**
   * Add a custom response interceptor.
   *
   * @param interceptor - Response interceptor function
   */
  addResponseInterceptor: (interceptor: (response: any) => any | Promise<any>) => number

  /**
   * Add a custom error interceptor.
   *
   * @param interceptor - Error interceptor function
   */
  addErrorInterceptor: (interceptor: (error: any) => any | Promise<any>) => number
}

/** Performance mark names for DevTools / Performance API */
const PERF_MARKS = {
  fetchStart: (op: string) => `soroban_${op}_start`,
  fetchEnd: (op: string) => `soroban_${op}_end`,
  cacheHit: (op: string) => `soroban_${op}_cache_hit`,
} as const

/**
 * Cached fetch wrapper with stale-while-revalidate.
 * Uses performance marks for metrics (#80); returns same reference for cached data to aid React re-render optimization.
 */
async function cachedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  options: {
    ttl?: number
    tags?: string[]
    forceRefresh?: boolean
    version?: string
    operationName?: string
  } = {}
): Promise<T> {
  const { ttl, tags, forceRefresh = false, version, operationName = 'fetch' } = options
  const op = operationName

  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(PERF_MARKS.fetchStart(op))
  }

  if (!forceRefresh) {
    const cached = cacheService.get<T>(cacheKey)
    if (cached !== null) {
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(PERF_MARKS.cacheHit(op))
        performance.measure(`soroban_${op}`, PERF_MARKS.fetchStart(op), PERF_MARKS.cacheHit(op))
      }
      return cached
    }
  }

  const data = await fetcher()
  cacheService.set(cacheKey, data, { ttl, tags, version })

  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(PERF_MARKS.fetchEnd(op))
    performance.measure(`soroban_${op}`, PERF_MARKS.fetchStart(op), PERF_MARKS.fetchEnd(op))
  }

  return data
}

/**
 * Initializes and returns the Soroban service implementation.
 * Configures RPC servers, network passphrases, and contract IDs.
 */
export const initializeSoroban = (): SorobanService => {
  const isTestEnvironment = process.env.NODE_ENV === 'test'

  // Create SorobanRpc client with RPC_URL
  const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
  const NETWORK_PASSPHRASE =
    process.env.NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015'
  const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || ''

  const server = new SorobanClient.SorobanRpc.Server(RPC_URL)

  return {
    createGroup: async (params: CreateGroupParams) => {
      return analytics.measureAsync('create_group', async () => {
        try {
          // Wrap in retry logic
          const groupId = await withRetry(
            async () => {
              if (isTestEnvironment || !CONTRACT_ID) {
                // Mock execution for test environment or missing contract
                await new Promise((resolve) => setTimeout(resolve, 2000))
                return `mock_group_${Date.now()}`
              }

              // Verify wallet connection
              if (!(await isConnected())) {
                throw new Error('Freighter wallet is not installed.')
              }
              if (!(await isAllowed())) {
                await setAllowed()
              }

              const accessResult = await requestAccess()
              if (accessResult.error || !accessResult.address) {
                const error: any = new Error(accessResult.error || 'User public key not available.')
                error.code = 'UNAUTHORIZED'
                throw error
              }
              const publicKey = accessResult.address

              const sourceAccount = await server.getAccount(publicKey)

              // Pack parameters for Soroban XDR
              const callArgs = [
                SorobanClient.xdr.ScVal.scvString(params.groupName),
                SorobanClient.xdr.ScVal.scvU32(params.cycleLength),
                SorobanClient.xdr.ScVal.scvU32(params.contributionAmount),
                SorobanClient.xdr.ScVal.scvU32(params.maxMembers),
              ]

              const contract = new SorobanClient.Contract(CONTRACT_ID)
              const transaction = new SorobanClient.TransactionBuilder(sourceAccount, {
                fee: '100', // Basic fee, update upon simulateTransaction response
                networkPassphrase: NETWORK_PASSPHRASE,
              })
                .addOperation(contract.call('create_group', ...callArgs))
                .setTimeout(30)
                .build()

              // Simulate the transaction to get real footprint and fee estimations
              const simulated = await server.simulateTransaction(transaction)

              if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
                const error: any = new Error('Transaction simulation failed')
                error.code = 'CONTRACT_ERROR'
                throw error
              }

              // Assemble real transaction with data payload footprint
              const assembled = SorobanClient.SorobanRpc.assembleTransaction(
                transaction,
                simulated
              ).build()

              // Request Freighter signature
              const signedXdr = await signTransaction(assembled.toXDR(), {
                networkPassphrase: NETWORK_PASSPHRASE,
              })
              const signedTransaction = SorobanClient.TransactionBuilder.fromXDR(
                signedXdr.signedTxXdr,
                NETWORK_PASSPHRASE
              )

              const sendResult = await server.sendTransaction(
                signedTransaction as SorobanClient.Transaction
              )

              if (sendResult.errorResult) {
                throw new Error(
                  `Transaction submitted with error: ${sendResult.errorResult.toXDR().toString('base64')}`
                )
              }

              // Wait.
              let statusResponse = await server.getTransaction(sendResult.hash)
              let attempts = 0
              while (
                statusResponse.status !==
                  SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
                attempts < 10
              ) {
                await new Promise((resolve) => setTimeout(resolve, 2000))
                statusResponse = await server.getTransaction(sendResult.hash)
                attempts++
              }

              if (
                statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS
              ) {
                throw new Error('Transaction did not complete successfully in time.')
              }

              // Since create_group likely returns the new group_id as an integer or string (based on Rust traits string vs integer sequence):
              // For robustness, parse the returned value from the resultXdr footprint, but default to tx-hash if unprocessable.
              return sendResult.hash
            },
            'createGroup',
            {
              shouldRetry: (error) => {
                // Don't retry validation errors
                if (error.code === 'INVALID_PARAMETERS' || error.code === 'UNAUTHORIZED')
                  return false
                return isRetryableError(error)
              },
            }
          )

          trackUserAction.groupCreated(groupId, params)
          showNotification.success('Group created successfully!')

          // Invalidate groups list cache
          cacheService.invalidateByTag(CacheTags.groups)

          return groupId
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'createGroup', params }, severity)
          showNotification.error(_message)
          throw error
        }
      })
    },

    joinGroup: async (groupId: string) => {
      return analytics.measureAsync('join_group', async () => {
        try {
          await withRetry(async () => {
            const isTestEnvironment = process.env.NODE_ENV === 'test'
            if (isTestEnvironment || !CONTRACT_ID) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              return
            }

            // Verify wallet connection
            if (!(await isConnected())) {
              throw new Error('Freighter wallet is not installed.')
            }
            if (!(await isAllowed())) {
              await setAllowed()
            }

            const accessResult = await requestAccess()
            if (accessResult.error || !accessResult.address) {
              const error: any = new Error(accessResult.error || 'User public key not available.')
              error.code = 'UNAUTHORIZED'
              throw error
            }
            const publicKey = accessResult.address

            const sourceAccount = await server.getAccount(publicKey)

            // Pack parameters for Soroban XDR
            const callArgs = [
              SorobanClient.xdr.ScVal.scvString(groupId),
              SorobanClient.xdr.ScVal.scvAddress(
                SorobanClient.Address.fromString(publicKey).toScAddress()
              ),
            ]

            const contract = new SorobanClient.Contract(CONTRACT_ID)
            const transaction = new SorobanClient.TransactionBuilder(sourceAccount, {
              fee: '100',
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(contract.call('join_group', ...callArgs))
              .setTimeout(30)
              .build()

            // Simulate the transaction to get real footprint and fee estimations
            const simulated = await server.simulateTransaction(transaction)

            if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
              const error: any = new Error('Transaction simulation failed')
              error.code = 'CONTRACT_ERROR'
              throw error
            }

            // Assemble real transaction with data payload footprint
            const assembled = SorobanClient.SorobanRpc.assembleTransaction(
              transaction,
              simulated
            ).build()

            // Request Freighter signature
            const signedXdr = await signTransaction(assembled.toXDR(), {
              networkPassphrase: NETWORK_PASSPHRASE,
            })
            const signedTransaction = SorobanClient.TransactionBuilder.fromXDR(
              signedXdr.signedTxXdr,
              NETWORK_PASSPHRASE
            )

            const sendResult = await server.sendTransaction(
              signedTransaction as SorobanClient.Transaction
            )

            if (sendResult.errorResult) {
              throw new Error(
                `Transaction submitted with error: ${sendResult.errorResult.toXDR().toString('base64')}`
              )
            }

            // Wait for SUCCESS.
            let statusResponse = await server.getTransaction(sendResult.hash)
            let attempts = 0
            while (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
              attempts < 10
            ) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              statusResponse = await server.getTransaction(sendResult.hash)
              attempts++
            }

            if (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS
            ) {
              throw new Error('Transaction did not complete successfully in time.')
            }
          }, 'joinGroup')

          trackUserAction.groupJoined(groupId)
          showNotification.success('Successfully joined group!')

          // Invalidate group-specific and groups list cache
          cacheService.invalidateByTag(CacheTags.group(groupId))
          cacheService.invalidateByTag(CacheTags.groups)
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'joinGroup', groupId }, severity)
          showNotification.error(_message)
          throw error
        }
      })
    },

    contribute: async (groupId: string, amount: number) => {
      return analytics.measureAsync('contribute', async () => {
        try {
          await withRetry(
            async () => {
              if (amount <= 0) {
                const error: any = new Error('Amount must be greater than zero')
                error.code = 'INVALID_PARAMETERS'
                throw error
              }
              // Simulate real contract call with delay
              await new Promise((resolve) => setTimeout(resolve, 2000))
            },
            'contribute',
            {
              shouldRetry: (error) => {
                // Don't retry insufficient balance errors
                if (error.code === 'INSUFFICIENT_BALANCE') return false
                return isRetryableError(error)
              },
            }
          )

          trackUserAction.contributionMade(groupId, amount)
          showNotification.success(`Contribution of ${amount} XLM successful!`)

          // Invalidate group status and transaction caches
          cacheService.invalidateByTag(CacheTags.group(groupId))
          cacheService.invalidateByTag(CacheTags.transactions)
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'contribute', groupId, amount },
            severity
          )
          showNotification.error(_message)
          throw error
        }
      })
    },

    getGroupStatus: async (groupId: string, useCache: boolean = true) => {
      return analytics.measureAsync('get_group_status', async () => {
        try {
          const cacheKey = CacheKeys.groupStatus(groupId)

          return await cachedFetch(
            cacheKey,
            async () => {
              return await withRetry(async () => {
                // Mock data for test environment
                if (isTestEnvironment || !CONTRACT_ID) {
                  await new Promise((resolve) => setTimeout(resolve, 300))
                  return {
                    groupId,
                    currentCycle: 2,
                    nextRecipient: 'GDEF456GHIJKLMNOPQRSTUVWXYZ789012ABCDEFGHIJKLMNOPQR',
                    pendingContributions: 1,
                    totalCollected: 150,
                    daysUntilPayout: 5,
                  }
                }

                // Real blockchain query
                if (!(await isConnected())) {
                  throw new Error('Freighter wallet is not installed.')
                }
                if (!(await isAllowed())) {
                  await setAllowed()
                }

                const accessResult = await requestAccess()
                if (accessResult.error || !accessResult.address) {
                  const error: any = new Error(
                    accessResult.error || 'User public key not available.'
                  )
                  error.code = 'UNAUTHORIZED'
                  throw error
                }

                const sourceAccount = await server.getAccount(accessResult.address)
                const contract = new SorobanClient.Contract(CONTRACT_ID)

                // Call get_group_status from the contract
                const statusTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call(
                      'get_group_status',
                      SorobanClient.xdr.ScVal.scvU64(
                        new SorobanClient.xdr.Uint64(parseInt(groupId))
                      )
                    )
                  )
                  .setTimeout(30)
                  .build()

                const statusSim = await server.simulateTransaction(statusTx)

                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(statusSim)) {
                  throw new Error('Failed to fetch group status from contract')
                }

                // Parse the GroupStatus struct from contract
                const rawStatus = SorobanClient.scValToNative(statusSim.result!.retval)

                // Also fetch the group details for additional context
                const groupTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call(
                      'get_group',
                      SorobanClient.xdr.ScVal.scvU64(
                        new SorobanClient.xdr.Uint64(parseInt(groupId))
                      )
                    )
                  )
                  .setTimeout(30)
                  .build()

                const groupSim = await server.simulateTransaction(groupTx)

                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(groupSim)) {
                  throw new Error('Failed to fetch group details from contract')
                }

                const groupData = SorobanClient.scValToNative(groupSim.result!.retval)

                // Calculate days until payout based on cycle timing
                const currentTime = Number(rawStatus.current_time)
                const cycleEndTime = Number(rawStatus.cycle_end_time)
                const secondsUntilPayout = Math.max(0, cycleEndTime - currentTime)
                const daysUntilPayout = Math.ceil(secondsUntilPayout / 86400)

                // Calculate total collected in current cycle
                const contributionAmount = Number(groupData.contribution_amount) / 10_000_000 // stroops to XLM
                const contributionsReceived = Number(rawStatus.contributions_received)
                const totalCollected = contributionAmount * contributionsReceived

                // Determine pending contributions count
                const pendingContributions = Number(rawStatus.total_members) - contributionsReceived

                // Map to frontend GroupStatus type
                return {
                  groupId,
                  currentCycle: Number(rawStatus.current_cycle),
                  nextRecipient: rawStatus.has_next_recipient
                    ? String(rawStatus.next_recipient)
                    : 'N/A',
                  pendingContributions,
                  totalCollected,
                  daysUntilPayout,
                }
              }, 'getGroupStatus')
            },
            {
              ttl: CACHE_TTL.GROUP_STATUS,
              tags: [CacheTags.groups, CacheTags.group(groupId)],
              forceRefresh: !useCache,
              operationName: 'getGroupStatus',
            }
          )
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'getGroupStatus', groupId }, severity)
          throw error
        }
      })
    },

    getGroupMembers: async (groupId: string, useCache: boolean = true) => {
      return analytics.measureAsync('get_group_members', async () => {
        try {
          const cacheKey = CacheKeys.groupMembers(groupId)

          return await cachedFetch(
            cacheKey,
            async () => {
              return await withRetry(async () => {
                if (isTestEnvironment || !CONTRACT_ID) {
                  // Mock data for development
                  await new Promise((resolve) => setTimeout(resolve, 300))
                  return [
                    {
                      address: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ456789ABCDEFGHIJKLMNOP',
                      groupId,
                      joinedDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
                      contributions: 3,
                      totalContributed: 150,
                      cyclesCompleted: 3,
                      status: 'active' as const,
                    },
                    {
                      address: 'GDEF456GHIJKLMNOPQRSTUVWXYZ789012ABCDEFGHIJKLMNOPQR',
                      groupId,
                      joinedDate: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000).toISOString(),
                      contributions: 3,
                      totalContributed: 150,
                      cyclesCompleted: 3,
                      status: 'active' as const,
                    },
                    {
                      address: 'GHIJ789KLMNOPQRSTUVWXYZ012345ABCDEFGHIJKLMNOPQRSTUV',
                      groupId,
                      joinedDate: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
                      contributions: 2,
                      totalContributed: 100,
                      cyclesCompleted: 2,
                      status: 'active' as const,
                    },
                  ]
                }

                // Real contract call
                if (!(await isConnected())) {
                  throw new Error('Freighter wallet is not installed.')
                }
                if (!(await isAllowed())) {
                  await setAllowed()
                }

                const accessResult = await requestAccess()
                if (accessResult.error || !accessResult.address) {
                  const error: any = new Error(
                    accessResult.error || 'User public key not available.'
                  )
                  error.code = 'UNAUTHORIZED'
                  throw error
                }

                const sourceAccount = await server.getAccount(accessResult.address)
                const contract = new SorobanClient.Contract(CONTRACT_ID)

                // First, get the group to know current cycle
                const groupTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call(
                      'get_group',
                      SorobanClient.xdr.ScVal.scvU64(
                        new SorobanClient.xdr.Uint64(parseInt(groupId))
                      )
                    )
                  )
                  .setTimeout(30)
                  .build()

                const groupSim = await server.simulateTransaction(groupTx)
                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(groupSim)) {
                  throw new Error('Failed to fetch group data')
                }

                const groupData = SorobanClient.scValToNative(groupSim.result!.retval)
                const currentCycle = Number(groupData.current_cycle)
                const createdAt = Number(groupData.created_at)

                // Call list_members to get member addresses
                const membersTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call(
                      'list_members',
                      SorobanClient.xdr.ScVal.scvU64(
                        new SorobanClient.xdr.Uint64(parseInt(groupId))
                      )
                    )
                  )
                  .setTimeout(30)
                  .build()

                const membersSim = await server.simulateTransaction(membersTx)
                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(membersSim)) {
                  throw new Error('Failed to fetch members')
                }

                const memberAddresses = SorobanClient.scValToNative(
                  membersSim.result!.retval
                ) as string[]

                // For each member, calculate their contribution history
                const membersWithStats = await Promise.all(
                  memberAddresses.map(async (address, index) => {
                    // Calculate contributions by checking each cycle
                    let totalContributions = 0
                    let cyclesCompleted = 0

                    // Check contribution status for each completed cycle
                    for (let cycle = 1; cycle < currentCycle; cycle++) {
                      try {
                        const statusTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                          fee: '100',
                          networkPassphrase: NETWORK_PASSPHRASE,
                        })
                          .addOperation(
                            contract.call(
                              'get_contribution_status',
                              SorobanClient.xdr.ScVal.scvU64(
                                new SorobanClient.xdr.Uint64(parseInt(groupId))
                              ),
                              SorobanClient.xdr.ScVal.scvU32(cycle)
                            )
                          )
                          .setTimeout(30)
                          .build()

                        const statusSim = await server.simulateTransaction(statusTx)
                        if (SorobanClient.SorobanRpc.Api.isSimulationSuccess(statusSim)) {
                          const contributions = SorobanClient.scValToNative(
                            statusSim.result!.retval
                          ) as Array<[string, boolean]>
                          const memberContribution = contributions.find(
                            ([addr]) => addr === address
                          )
                          if (memberContribution && memberContribution[1]) {
                            totalContributions++
                            cyclesCompleted++
                          }
                        }
                      } catch {
                        // Skip if cycle data not available
                      }
                    }

                    // Estimate join date (creator is first, others joined later)
                    // Since contract doesn't store individual join dates, we estimate
                    const estimatedJoinDate = new Date(
                      (createdAt + index * 86400) * 1000
                    ).toISOString()

                    return {
                      address,
                      groupId,
                      joinedDate: estimatedJoinDate,
                      contributions: totalContributions,
                      totalContributed:
                        (totalContributions * Number(groupData.contribution_amount)) / 10_000_000,
                      cyclesCompleted,
                      status: groupData.is_complete ? 'completed' : ('active' as const),
                    }
                  })
                )

                return membersWithStats
              }, 'getGroupMembers')
            },
            {
              ttl: CACHE_TTL.GROUP_MEMBERS,
              tags: [CacheTags.groups, CacheTags.group(groupId)],
              forceRefresh: !useCache,
              operationName: 'getGroupMembers',
            }
          )
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'getGroupMembers', groupId }, severity)
          throw error
        }
      })
    },

    getUserGroups: async (userId: string, useCache: boolean = true) => {
      return analytics.measureAsync('get_user_groups', async () => {
        try {
          const cacheKey = CacheKeys.userGroups(userId)

          return await cachedFetch(
            cacheKey,
            async () => {
              return await withRetry(async () => {
                if (isTestEnvironment || !CONTRACT_ID) {
                  // ── Mock data so the UI works during development ──────────
                  // Remove this block once the contract is deployed and
                  // CONTRACT_ID is set in your .env file.
                  await new Promise((resolve) => setTimeout(resolve, 500))
                  return [
                    {
                      id: 'group-1',
                      name: 'Family Savings Circle',
                      description: 'Monthly family savings group',
                      creator: userId, // marks this as a group the user created
                      cycleLength: 30,
                      contributionAmount: 50,
                      maxMembers: 8,
                      currentMembers: 5,
                      totalContributions: 1250,
                      status: 'active' as const,
                      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
                      nextPayoutDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
                      frequency: 'monthly' as const,
                    },
                    {
                      id: 'group-2',
                      name: 'Work Colleagues Pool',
                      description: 'Bi-weekly savings with colleagues',
                      creator: 'GOTHER_ADDRESS_HERE', // marks this as joined
                      cycleLength: 14,
                      contributionAmount: 25,
                      maxMembers: 10,
                      currentMembers: 8,
                      totalContributions: 800,
                      status: 'active' as const,
                      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                      nextPayoutDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
                      frequency: 'weekly' as const,
                    },
                    {
                      id: 'group-3',
                      name: 'Community Fund',
                      description: 'Completed savings round',
                      creator: userId,
                      cycleLength: 30,
                      contributionAmount: 100,
                      maxMembers: 5,
                      currentMembers: 5,
                      totalContributions: 2500,
                      status: 'completed' as const,
                      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
                      nextPayoutDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
                      frequency: 'monthly' as const,
                    },
                  ]
                }

                // ── Real contract call (runs when CONTRACT_ID is set) ──────
                // Verify wallet connection
                if (!(await isConnected())) {
                  throw new Error('Freighter wallet is not installed.')
                }
                if (!(await isAllowed())) {
                  await setAllowed()
                }

                const accessResult = await requestAccess()
                if (accessResult.error || !accessResult.address) {
                  const error: any = new Error(
                    accessResult.error || 'User public key not available.'
                  )
                  error.code = 'UNAUTHORIZED'
                  throw error
                }

                const sourceAccount = await server.getAccount(accessResult.address)
                const contract = new SorobanClient.Contract(CONTRACT_ID)

                // Call the contract's get_user_groups(address) function.
                // Adjust the function name to match your actual Rust contract.
                const transaction = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call('get_user_groups', SorobanClient.xdr.ScVal.scvString(userId))
                  )
                  .setTimeout(30)
                  .build()

                const simulated = await server.simulateTransaction(transaction)

                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
                  throw new Error('get_user_groups simulation failed')
                }

                // Parse the returned ScVal into a JS array of Group objects.
                // The exact shape depends on your contract's return type.
                const rawGroups = SorobanClient.scValToNative(simulated.result!.retval)

                // Map contract response to the Group type expected by the UI.
                // Adjust field names to match your contract's actual field names.
                return (rawGroups as any[]).map((g: any) => ({
                  id: String(g.id),
                  name: String(g.name),
                  description: g.description ? String(g.description) : undefined,
                  creator: String(g.creator),
                  cycleLength: Number(g.cycle_length),
                  contributionAmount: Number(g.contribution_amount) / 10_000_000, // stroops → XLM
                  maxMembers: Number(g.max_members),
                  currentMembers: Number(g.current_members),
                  totalContributions: Number(g.total_contributions) / 10_000_000,
                  status: g.status as 'active' | 'completed' | 'paused',
                  createdAt: new Date(Number(g.created_at) * 1000).toISOString(),
                  nextPayoutDate: new Date(Number(g.next_payout_date) * 1000).toISOString(),
                }))
              }, 'getUserGroups')
            },
            {
              ttl: CACHE_TTL.GROUP_LIST,
              tags: [CacheTags.groups, CacheTags.user(userId)],
              forceRefresh: !useCache,
              operationName: 'getUserGroups',
            }
          )
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'getUserGroups', userId }, severity)
          throw error
        }
      })
    },

    getTransactions: async (groupId: string, cursor?: string, limit: number = 10) => {
      return analytics.measureAsync('get_transactions', async () => {
        try {
          const cacheKey = CacheKeys.transactions(groupId, cursor, limit)

          return await cachedFetch(
            cacheKey,
            async () => {
              return await withRetry(async () => {
                // Here we will use the Stellar SDK to query contract events
                // For now, return the mock data format so the UI works
                return {
                  transactions: [
                    {
                      id: `tx-1-${cursor || 'start'}`,
                      groupId,
                      type: 'contribution',
                      amount: 500,
                      date: '2026-02-10T12:00:00Z',
                      member: 'GAAAA...AAAA',
                      status: 'completed',
                      hash: '0x123...', // Added for details
                    },
                    {
                      id: `tx-2-${cursor || 'start'}`,
                      groupId,
                      type: 'contribution',
                      amount: 500,
                      date: '2026-02-11T12:00:00Z',
                      member: 'GBBBB...BBBB',
                      status: 'completed',
                      hash: '0x456...',
                    },
                    {
                      id: `tx-3-${cursor || 'start'}`,
                      groupId,
                      type: 'payout',
                      amount: 4000,
                      date: '2026-02-12T12:00:00Z',
                      member: 'GCCCC...CCCC',
                      status: 'completed',
                      hash: '0x789...',
                    },
                  ],
                  nextCursor: cursor ? undefined : 'cursor-2', // Mock pagination
                }
              }, 'getTransactions')
            },
            {
              ttl: CACHE_TTL.TRANSACTIONS,
              tags: [CacheTags.transactions, CacheTags.group(groupId)],
              operationName: 'getTransactions',
            }
          )
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'getTransactions', groupId }, severity)
          throw error
        }
      })
    },

    invalidateGroupCache: (groupId: string) => {
      cacheService.invalidateByTag(CacheTags.group(groupId))
      analytics.trackEvent({
        category: 'Cache',
        action: 'Invalidation',
        label: 'group',
        metadata: { groupId },
      })
    },

    invalidateUserCache: (userId: string) => {
      cacheService.invalidateByTag(CacheTags.user(userId))
      analytics.trackEvent({
        category: 'Cache',
        action: 'Invalidation',
        label: 'user',
        metadata: { userId },
      })
    },

    clearCache: () => {
      cacheService.clear()
      analytics.trackEvent({
        category: 'Cache',
        action: 'Invalidation',
        label: 'full_clear',
      })
    },

    // Insurance claim methods
    fileInsuranceClaim: async (
      groupId: string,
      cycle: number,
      claimant: string,
      defaulter: string,
      amount: number
    ) => {
      return analytics.measureAsync('file_insurance_claim', async () => {
        try {
          const claimId = await withRetry(async () => {
            if (isTestEnvironment || !CONTRACT_ID) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              return `mock_claim_${Date.now()}`
            }

            if (!(await isConnected())) {
              throw new Error('Freighter wallet is not installed.')
            }
            if (!(await isAllowed())) {
              await setAllowed()
            }

            const accessResult = await requestAccess()
            if (accessResult.error || !accessResult.address) {
              const error: any = new Error(accessResult.error || 'User public key not available.')
              error.code = 'UNAUTHORIZED'
              throw error
            }
            const publicKey = accessResult.address

            const sourceAccount = await server.getAccount(publicKey)

            const callArgs = [
              SorobanClient.xdr.ScVal.scvU64(new SorobanClient.xdr.Uint64(parseInt(groupId))),
              SorobanClient.xdr.ScVal.scvU32(cycle),
              SorobanClient.xdr.ScVal.scvAddress(
                SorobanClient.Address.fromString(claimant).toScAddress()
              ),
              SorobanClient.xdr.ScVal.scvAddress(
                SorobanClient.Address.fromString(defaulter).toScAddress()
              ),
              SorobanClient.xdr.ScVal.scvI128(new SorobanClient.xdr.Int128(amount)),
            ]

            const contract = new SorobanClient.Contract(CONTRACT_ID)
            const transaction = new SorobanClient.TransactionBuilder(sourceAccount, {
              fee: '100',
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(contract.call('file_insurance_claim', ...callArgs))
              .setTimeout(30)
              .build()

            const simulated = await server.simulateTransaction(transaction)

            if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
              const error: any = new Error('Transaction simulation failed')
              error.code = 'CONTRACT_ERROR'
              throw error
            }

            const assembled = SorobanClient.SorobanRpc.assembleTransaction(
              transaction,
              simulated
            ).build()

            const signedXdr = await signTransaction(assembled.toXDR(), {
              networkPassphrase: NETWORK_PASSPHRASE,
            })
            const signedTransaction = SorobanClient.TransactionBuilder.fromXDR(
              signedXdr.signedTxXdr,
              NETWORK_PASSPHRASE
            )

            const sendResult = await server.sendTransaction(
              signedTransaction as SorobanClient.Transaction
            )

            if (sendResult.errorResult) {
              throw new Error(
                `Transaction submitted with error: ${sendResult.errorResult.toXDR().toString('base64')}`
              )
            }

            let statusResponse = await server.getTransaction(sendResult.hash)
            let attempts = 0
            while (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
              attempts < 10
            ) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              statusResponse = await server.getTransaction(sendResult.hash)
              attempts++
            }

            if (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS
            ) {
              throw new Error('Transaction did not complete successfully in time.')
            }

            return sendResult.hash
          }, 'fileInsuranceClaim')

          trackUserAction.insuranceClaimFiled(claimId, groupId, amount)
          showNotification.success('Insurance claim filed successfully!')

          cacheService.invalidateByTag(CacheTags.insurance)
          return claimId
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'fileInsuranceClaim', groupId, cycle, amount },
            severity
          )
          showNotification.error(_message)
          throw error
        }
      })
    },

    processInsuranceClaim: async (claimId: string, approved: boolean) => {
      return analytics.measureAsync('process_insurance_claim', async () => {
        try {
          await withRetry(async () => {
            if (isTestEnvironment || !CONTRACT_ID) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              return
            }

            if (!(await isConnected())) {
              throw new Error('Freighter wallet is not installed.')
            }
            if (!(await isAllowed())) {
              await setAllowed()
            }

            const accessResult = await requestAccess()
            if (accessResult.error || !accessResult.address) {
              const error: any = new Error(accessResult.error || 'User public key not available.')
              error.code = 'UNAUTHORIZED'
              throw error
            }
            const publicKey = accessResult.address

            const sourceAccount = await server.getAccount(publicKey)

            const callArgs = [
              SorobanClient.xdr.ScVal.scvU64(new SorobanClient.xdr.Uint64(parseInt(claimId))),
              SorobanClient.xdr.ScVal.scvBool(approved),
            ]

            const contract = new SorobanClient.Contract(CONTRACT_ID)
            const transaction = new SorobanClient.TransactionBuilder(sourceAccount, {
              fee: '100',
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(contract.call('process_insurance_claim', ...callArgs))
              .setTimeout(30)
              .build()

            const simulated = await server.simulateTransaction(transaction)

            if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
              const error: any = new Error('Transaction simulation failed')
              error.code = 'CONTRACT_ERROR'
              throw error
            }

            const assembled = SorobanClient.SorobanRpc.assembleTransaction(
              transaction,
              simulated
            ).build()

            const signedXdr = await signTransaction(assembled.toXDR(), {
              networkPassphrase: NETWORK_PASSPHRASE,
            })
            const signedTransaction = SorobanClient.TransactionBuilder.fromXDR(
              signedXdr.signedTxXdr,
              NETWORK_PASSPHRASE
            )

            const sendResult = await server.sendTransaction(
              signedTransaction as SorobanClient.Transaction
            )

            if (sendResult.errorResult) {
              throw new Error(
                `Transaction submitted with error: ${sendResult.errorResult.toXDR().toString('base64')}`
              )
            }

            let statusResponse = await server.getTransaction(sendResult.hash)
            let attempts = 0
            while (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
              attempts < 10
            ) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              statusResponse = await server.getTransaction(sendResult.hash)
              attempts++
            }

            if (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS
            ) {
              throw new Error('Transaction did not complete successfully in time.')
            }
          }, 'processInsuranceClaim')

          trackUserAction.insuranceClaimProcessed(claimId, approved)
          showNotification.success(`Claim ${approved ? 'approved' : 'rejected'} successfully!`)

          cacheService.invalidateByTag(CacheTags.insurance)
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'processInsuranceClaim', claimId, approved },
            severity
          )
          showNotification.error(_message)
          throw error
        }
      })
    },

    getInsuranceClaim: async (claimId: string) => {
      return analytics.measureAsync('get_insurance_claim', async () => {
        try {
          return await cachedFetch(
            `insurance_claim:${claimId}`,
            async () => {
              return await withRetry(async () => {
                if (isTestEnvironment || !CONTRACT_ID) {
                  await new Promise((resolve) => setTimeout(resolve, 300))
                  return {
                    id: claimId,
                    groupId: '1',
                    cycle: 2,
                    claimant: 'GABC123...',
                    defaulter: 'GDEF456...',
                    amount: 100000000,
                    status: 'PENDING',
                    createdAt: Date.now() - 3600000,
                  }
                }

                if (!(await isConnected())) {
                  throw new Error('Freighter wallet is not installed.')
                }
                if (!(await isAllowed())) {
                  await setAllowed()
                }

                const accessResult = await requestAccess()
                if (accessResult.error || !accessResult.address) {
                  const error: any = new Error(
                    accessResult.error || 'User public key not available.'
                  )
                  error.code = 'UNAUTHORIZED'
                  throw error
                }

                const sourceAccount = await server.getAccount(accessResult.address)
                const contract = new SorobanClient.Contract(CONTRACT_ID)

                const claimTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call(
                      'get_insurance_claim',
                      SorobanClient.xdr.ScVal.scvU64(
                        new SorobanClient.xdr.Uint64(parseInt(claimId))
                      )
                    )
                  )
                  .setTimeout(30)
                  .build()

                const claimSim = await server.simulateTransaction(claimTx)

                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(claimSim)) {
                  throw new Error('Failed to fetch insurance claim from contract')
                }

                const rawClaim = SorobanClient.scValToNative(claimSim.result!.retval)

                return {
                  id: rawClaim.id.toString(),
                  groupId: rawClaim.group_id.toString(),
                  cycle: rawClaim.cycle,
                  claimant: String(rawClaim.claimant),
                  defaulter: String(rawClaim.defaulter),
                  amount: Number(rawClaim.amount),
                  status:
                    rawClaim.status === 0
                      ? 'PENDING'
                      : rawClaim.status === 1
                        ? 'APPROVED'
                        : rawClaim.status === 2
                          ? 'REJECTED'
                          : 'PAID',
                  createdAt: Number(rawClaim.created_at) * 1000, // Convert from seconds to milliseconds
                }
              }, 'getInsuranceClaim')
            },
            {
              ttl: CACHE_TTL.GROUP_STATUS,
              tags: [CacheTags.insurance],
              operationName: 'getInsuranceClaim',
            }
          )
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'getInsuranceClaim', claimId },
            severity
          )
          throw error
        }
      })
    },

    getInsurancePool: async (tokenAddress: string) => {
      return analytics.measureAsync('get_insurance_pool', async () => {
        try {
          return await cachedFetch(
            `insurance_pool:${tokenAddress}`,
            async () => {
              return await withRetry(async () => {
                if (isTestEnvironment || !CONTRACT_ID) {
                  await new Promise((resolve) => setTimeout(resolve, 300))
                  return {
                    balance: 5000000000, // 500 XLM in stroops
                    totalPayouts: 1000000000, // 100 XLM in stroops
                    pendingClaimsCount: 2,
                  }
                }

                if (!(await isConnected())) {
                  throw new Error('Freighter wallet is not installed.')
                }
                if (!(await isAllowed())) {
                  await setAllowed()
                }

                const accessResult = await requestAccess()
                if (accessResult.error || !accessResult.address) {
                  const error: any = new Error(
                    accessResult.error || 'User public key not available.'
                  )
                  error.code = 'UNAUTHORIZED'
                  throw error
                }

                const sourceAccount = await server.getAccount(accessResult.address)
                const contract = new SorobanClient.Contract(CONTRACT_ID)

                const poolTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call(
                      'get_insurance_pool',
                      SorobanClient.xdr.ScVal.scvAddress(
                        SorobanClient.Address.fromString(tokenAddress).toScAddress()
                      )
                    )
                  )
                  .setTimeout(30)
                  .build()

                const poolSim = await server.simulateTransaction(poolTx)

                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(poolSim)) {
                  throw new Error('Failed to fetch insurance pool from contract')
                }

                const rawPool = SorobanClient.scValToNative(poolSim.result!.retval)

                return {
                  balance: Number(rawPool.balance),
                  totalPayouts: Number(rawPool.total_payouts),
                  pendingClaimsCount: Number(rawPool.pending_claims_count),
                }
              }, 'getInsurancePool')
            },
            {
              ttl: CACHE_TTL.GROUP_STATUS,
              tags: [CacheTags.insurance],
              operationName: 'getInsurancePool',
            }
          )
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'getInsurancePool', tokenAddress },
            severity
          )
          throw error
        }
      })
    },

    verifyInsuranceClaim: async (claimId: string) => {
      return analytics.measureAsync('verify_insurance_claim', async () => {
        try {
          return await withRetry(async () => {
            if (isTestEnvironment || !CONTRACT_ID) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
              return Math.random() > 0.3 // Mock verification with 70% success rate
            }

            if (!(await isConnected())) {
              throw new Error('Freighter wallet is not installed.')
            }
            if (!(await isAllowed())) {
              await setAllowed()
            }

            const accessResult = await requestAccess()
            if (accessResult.error || !accessResult.address) {
              const error: any = new Error(accessResult.error || 'User public key not available.')
              error.code = 'UNAUTHORIZED'
              throw error
            }

            const sourceAccount = await server.getAccount(accessResult.address)
            const contract = new SorobanClient.Contract(CONTRACT_ID)

            const verifyTx = new SorobanClient.TransactionBuilder(sourceAccount, {
              fee: '100',
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(
                contract.call(
                  'verify_insurance_claim',
                  SorobanClient.xdr.ScVal.scvU64(new SorobanClient.xdr.Uint64(parseInt(claimId)))
                )
              )
              .setTimeout(30)
              .build()

            const verifySim = await server.simulateTransaction(verifyTx)

            if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(verifySim)) {
              throw new Error('Failed to verify insurance claim')
            }

            const isValid = SorobanClient.scValToNative(verifySim.result!.retval)
            return Boolean(isValid)
          }, 'verifyInsuranceClaim')
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'verifyInsuranceClaim', claimId },
            severity
          )
          showNotification.error(_message)
          throw error
        }
      })
    },

    setGroupMetadata: async (groupId: string, name: string, description: string, rules: string) => {
      return analytics.measureAsync('set_group_metadata', async () => {
        try {
          await withRetry(async () => {
            // Validate metadata length limits
            if (name.length > 100) {
              const error: any = new Error('Group name exceeds maximum length of 100 characters')
              error.code = 'INVALID_PARAMETERS'
              throw error
            }
            if (description.length > 500) {
              const error: any = new Error(
                'Group description exceeds maximum length of 500 characters'
              )
              error.code = 'INVALID_PARAMETERS'
              throw error
            }
            if (rules.length > 1000) {
              const error: any = new Error('Group rules exceed maximum length of 1000 characters')
              error.code = 'INVALID_PARAMETERS'
              throw error
            }

            if (isTestEnvironment || !CONTRACT_ID) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              return
            }

            if (!(await isConnected())) {
              throw new Error('Freighter wallet is not installed.')
            }
            if (!(await isAllowed())) {
              await setAllowed()
            }

            const accessResult = await requestAccess()
            if (accessResult.error || !accessResult.address) {
              const error: any = new Error(accessResult.error || 'User public key not available.')
              error.code = 'UNAUTHORIZED'
              throw error
            }
            const publicKey = accessResult.address

            const sourceAccount = await server.getAccount(publicKey)

            const callArgs = [
              SorobanClient.xdr.ScVal.scvU64(new SorobanClient.xdr.Uint64(parseInt(groupId))),
              SorobanClient.xdr.ScVal.scvString(name),
              SorobanClient.xdr.ScVal.scvString(description),
              SorobanClient.xdr.ScVal.scvString(rules),
            ]

            const contract = new SorobanClient.Contract(CONTRACT_ID)
            const transaction = new SorobanClient.TransactionBuilder(sourceAccount, {
              fee: '100',
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(contract.call('set_group_metadata', ...callArgs))
              .setTimeout(30)
              .build()

            const simulated = await server.simulateTransaction(transaction)

            if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
              const error: any = new Error('Transaction simulation failed')
              error.code = 'CONTRACT_ERROR'
              throw error
            }

            const assembled = SorobanClient.SorobanRpc.assembleTransaction(
              transaction,
              simulated
            ).build()

            const signedXdr = await signTransaction(assembled.toXDR(), {
              networkPassphrase: NETWORK_PASSPHRASE,
            })
            const signedTransaction = SorobanClient.TransactionBuilder.fromXDR(
              signedXdr.signedTxXdr,
              NETWORK_PASSPHRASE
            )

            const sendResult = await server.sendTransaction(
              signedTransaction as SorobanClient.Transaction
            )

            if (sendResult.errorResult) {
              throw new Error(
                `Transaction submitted with error: ${sendResult.errorResult.toXDR().toString('base64')}`
              )
            }

            let statusResponse = await server.getTransaction(sendResult.hash)
            let attempts = 0
            while (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
              attempts < 10
            ) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              statusResponse = await server.getTransaction(sendResult.hash)
              attempts++
            }

            if (
              statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS
            ) {
              throw new Error('Transaction did not complete successfully in time.')
            }
          }, 'setGroupMetadata')

          trackUserAction.groupMetadataUpdated(groupId, { name, description, rules })
          showNotification.success('Group metadata updated successfully!')

          cacheService.invalidateByTag(CacheTags.group(groupId))
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'setGroupMetadata', groupId }, severity)
          showNotification.error(_message)
          throw error
        }
      })
    },

    getGroupMetadata: async (groupId: string) => {
      return analytics.measureAsync('get_group_metadata', async () => {
        try {
          return await cachedFetch(
            `group_metadata:${groupId}`,
            async () => {
              return await withRetry(async () => {
                if (isTestEnvironment || !CONTRACT_ID) {
                  await new Promise((resolve) => setTimeout(resolve, 300))
                  return {
                    name: 'Test Group',
                    description: 'This is a test group for development purposes.',
                    rules:
                      '1. Be respectful\n2. Contribute on time\n3. Follow the group guidelines',
                    updatedAt: Date.now() - 86400000,
                  }
                }

                if (!(await isConnected())) {
                  throw new Error('Freighter wallet is not installed.')
                }
                if (!(await isAllowed())) {
                  await setAllowed()
                }

                const accessResult = await requestAccess()
                if (accessResult.error || !accessResult.address) {
                  const error: any = new Error(
                    accessResult.error || 'User public key not available.'
                  )
                  error.code = 'UNAUTHORIZED'
                  throw error
                }

                const sourceAccount = await server.getAccount(accessResult.address)
                const contract = new SorobanClient.Contract(CONTRACT_ID)

                const metadataTx = new SorobanClient.TransactionBuilder(sourceAccount, {
                  fee: '100',
                  networkPassphrase: NETWORK_PASSPHRASE,
                })
                  .addOperation(
                    contract.call(
                      'get_group_metadata',
                      SorobanClient.xdr.ScVal.scvU64(
                        new SorobanClient.xdr.Uint64(parseInt(groupId))
                      )
                    )
                  )
                  .setTimeout(30)
                  .build()

                const metadataSim = await server.simulateTransaction(metadataTx)

                if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(metadataSim)) {
                  throw new Error('Failed to fetch group metadata from contract')
                }

                const rawMetadata = SorobanClient.scValToNative(metadataSim.result!.retval)

                return {
                  name: rawMetadata.name,
                  description: rawMetadata.description,
                  rules: rawMetadata.rules,
                  updatedAt: Number(rawMetadata.updated_at) * 1000, // Convert from seconds to milliseconds
                }
              }, 'getGroupMetadata')
            },
            {
              ttl: CACHE_TTL.GROUP_STATUS,
              tags: [CacheTags.group(groupId)],
              operationName: 'getGroupMetadata',
            }
          )
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(error as Error, { operation: 'getGroupMetadata', groupId }, severity)
          throw error
        }
      })
    },

    executeBatch: async (
      operations: any[],
      options: { simulateOnly?: boolean; timeout?: number } = {}
    ) => {
      return analytics.measureAsync('execute_batch', async () => {
        try {
          // Import the transaction batcher
          const { TransactionBatcher, createScVal } = await import('../utils/transactionBatcher')

          if (!(await isConnected())) {
            throw new Error('Freighter wallet is not installed.')
          }
          if (!(await isAllowed())) {
            await setAllowed()
          }

          const accessResult = await requestAccess()
          if (accessResult.error || !accessResult.address) {
            const error: any = new Error(accessResult.error || 'User public key not available.')
            error.code = 'UNAUTHORIZED'
            throw error
          }

          const sourceAccount = await server.getAccount(accessResult.address)
          const batcher = new TransactionBatcher(server, NETWORK_PASSPHRASE)

          // Convert operations to batch format
          const batchOperations = operations.map((op, index) => ({
            id: op.id || `op_${index}`,
            contractAddress: op.contractAddress || CONTRACT_ID,
            methodName: op.methodName,
            args: op.args.map((arg: any) => createScVal(arg)),
            description: op.description,
          }))

          // Validate operations
          const validation = batcher.validateBatchable(batchOperations)
          if (!validation.valid) {
            throw new Error(`Batch validation failed: ${validation.errors.join(', ')}`)
          }

          // Execute the batch
          const result = await batcher.executeBatch(
            batchOperations,
            sourceAccount,
            signTransaction,
            options
          )

          if (result.success) {
            trackUserAction.batchExecuted(result.batchId, {
              operationCount: operations.length,
              gasUsed: result.gasUsed,
              simulateOnly: options.simulateOnly || false,
            })

            if (!options.simulateOnly) {
              showNotification.success(
                `Batch executed successfully! ${result.results.filter((r) => r.success).length}/${result.results.length} operations completed.`
              )

              // Invalidate relevant caches
              cacheService.invalidateByTag(CacheTags.groups)
            }
          } else {
            showNotification.error(`Batch execution failed: ${result.error}`)
          }

          return result
        } catch (error) {
          const { message: _message, severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'executeBatch', operationCount: operations.length },
            severity
          )
          showNotification.error(_message)
          throw error
        }
      })
    },

    estimateBatchGas: async (operations: any[]) => {
      return analytics.measureAsync('estimate_batch_gas', async () => {
        try {
          // Import the transaction batcher
          const { TransactionBatcher, createScVal } = await import('../utils/transactionBatcher')

          if (!(await isConnected())) {
            throw new Error('Freighter wallet is not installed.')
          }
          if (!(await isAllowed())) {
            await setAllowed()
          }

          const accessResult = await requestAccess()
          if (accessResult.error || !accessResult.address) {
            const error: any = new Error(accessResult.error || 'User public key not available.')
            error.code = 'UNAUTHORIZED'
            throw error
          }

          const sourceAccount = await server.getAccount(accessResult.address)
          const batcher = new TransactionBatcher(server, NETWORK_PASSPHRASE)

          // Convert operations to batch format
          const batchOperations = operations.map((op, index) => ({
            id: op.id || `op_${index}`,
            contractAddress: op.contractAddress || CONTRACT_ID,
            methodName: op.methodName,
            args: op.args.map((arg: any) => createScVal(arg)),
            description: op.description,
          }))

          // Validate operations first
          const validation = batcher.validateBatchable(batchOperations)
          if (!validation.valid) {
            throw new Error(`Batch validation failed: ${validation.errors.join(', ')}`)
          }

          // Estimate gas
          const estimate = await batcher.estimateBatchGas(batchOperations, sourceAccount)

          return estimate
        } catch (error) {
          const { severity } = classifyError(error)
          analytics.trackError(
            error as Error,
            { operation: 'estimateBatchGas', operationCount: operations.length },
            severity
          )
          throw error
        }
      })
    },

    httpRequest: async <T = any>(config: {
      url: string
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      headers?: Record<string, string>
      body?: any
      timeout?: number
      retries?: number
      cache?: boolean
      cacheTTL?: number
    }) => {
      return await httpRequest<T>(config)
    },

    addRequestInterceptor: (interceptor: (config: any) => any | Promise<any>) => {
      return interceptorManager.addRequestInterceptor(interceptor)
    },

    addResponseInterceptor: (interceptor: (response: any) => any | Promise<any>) => {
      return interceptorManager.addResponseInterceptor(interceptor)
    },

    addErrorInterceptor: (interceptor: (error: any) => any | Promise<any>) => {
      return interceptorManager.addErrorInterceptor(interceptor)
    },
  }
}
export interface AccountBalanceInfo {
  /** Raw XLM balance string from Horizon e.g. "1234.5600000" */
  nativeBalance: string
  /** Minimum reserve in XLM the account must keep: (2 + subentries) × 0.5 */
  minReserve: number
  /** Number of subentries on the account (trustlines, offers, data, signers) */
  subentryCount: number
}

export interface TransactionSimulation {
  success: boolean
  /** Fee in stroops */
  feeStroops: number
  /** Fee as XLM number */
  feeXLM: number
  /** Human-readable description of what will happen */
  expectedOutcome: string
  error?: string
}

export interface RecentTx {
  id: string
  type: 'contribution' | 'withdrawal' | 'payout' | 'fee' | 'other'
  amount: string
  timestamp: Date
  status: 'success' | 'pending' | 'failed'
  groupName?: string
}

// ── Horizon server (separate from the Soroban RPC server above) ───────────────

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org'

const horizonServer = new SorobanClient.Horizon.Server(HORIZON_URL)

// Is this a testnet deployment?
export const IS_TESTNET =
  (process.env.NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015') ===
  SorobanClient.Networks.TESTNET

// ── Balance helpers ───────────────────────────────────────────────────────────

/**
 * Fetch the native XLM balance and minimum reserve for a Stellar account.
 * Throws if the account does not exist on-chain.
 *
 * @param publicKey - The Stellar public key to check
 * @returns Balance and reserve information
 */
export async function getAccountBalanceInfo(publicKey: string): Promise<AccountBalanceInfo> {
  const account = await horizonServer.loadAccount(publicKey)

  const nativeEntry = account.balances.find(
    (b): b is SorobanClient.Horizon.HorizonApi.BalanceLine<'native'> => b.asset_type === 'native'
  )
  const nativeBalance = nativeEntry?.balance ?? '0'

  // Stellar minimum reserve formula: (2 + subentries) × base_reserve (0.5 XLM)
  const BASE_RESERVE = 0.5
  const subentryCount = account.subentry_count
  const minReserve = (2 + subentryCount) * BASE_RESERVE

  return { nativeBalance, minReserve, subentryCount }
}

/**
 * Return the total XLM locked inside active Ajo groups for this address.
 *
 * TODO: Replace the stub below with a real contract call once the contract
 * exposes a `get_locked_balance(address)` view function. Example pattern:
 *
 *   const contract = new SorobanClient.Contract(CONTRACT_ID)
 *   const sourceAccount = await server.getAccount(publicKey)
 *   const tx = new SorobanClient.TransactionBuilder(sourceAccount, {
 *     fee: '100',
 *     networkPassphrase: NETWORK_PASSPHRASE,
 *   })
 *     .addOperation(
 *       contract.call(
 *         'get_locked_balance',
 *         SorobanClient.xdr.ScVal.scvAddress(
 *           SorobanClient.xdr.ScAddress.scAddressTypeAccount(
 *             SorobanClient.xdr.AccountID.publicKeyTypeEd25519(
 *               SorobanClient.StrKey.decodeEd25519PublicKey(publicKey)
 *             )
 *           )
 *         )
 *       )
 *     )
 *     .setTimeout(30)
 *     .build()
 *   const sim = await server.simulateTransaction(tx)
 *   if (SorobanClient.SorobanRpc.Api.isSimulationSuccess(sim)) {
 *     return SorobanClient.scValToNative(sim.result!.retval) / 10_000_000
 *   }
 *   return 0
 */
export async function getLockedBalance(_publicKey: string): Promise<number> {
  // Stub: returns 0 until contract view function is available
  return 0
}

// ── Transaction simulation ────────────────────────────────────────────────────

/**
 * Dry-run a built Soroban transaction to get an accurate fee estimate
 * and verify it will succeed before asking the user to sign.
 *
 * @param builtTxXdr - The XDR string of the transaction built with TransactionBuilder
 * @param expectedOutcome - Human-readable description for the preview modal
 * @returns Simulation result with fee estimates or error
 */
export async function simulateSorobanTransaction(
  builtTxXdr: string,
  expectedOutcome: string
): Promise<TransactionSimulation> {
  try {
    const transaction = SorobanClient.TransactionBuilder.fromXDR(
      builtTxXdr,
      process.env.NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015'
    ) as SorobanClient.Transaction

    // Use the existing `server` (SorobanRpc.Server) declared at the top of soroban.ts
    const simResult = await server.simulateTransaction(transaction)

    if (SorobanClient.SorobanRpc.Api.isSimulationError(simResult)) {
      return {
        success: false,
        feeStroops: 0,
        feeXLM: 0,
        expectedOutcome: '',
        error: simResult.error,
      }
    }

    if (SorobanClient.SorobanRpc.Api.isSimulationSuccess(simResult)) {
      const feeStroops = parseInt(simResult.minResourceFee, 10)
      const feeXLM = feeStroops / 10_000_000

      return {
        success: true,
        feeStroops,
        feeXLM,
        expectedOutcome,
      }
    }

    return {
      success: false,
      feeStroops: 0,
      feeXLM: 0,
      expectedOutcome: '',
      error: 'Unexpected simulation response',
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Simulation failed'
    return {
      success: false,
      feeStroops: 0,
      feeXLM: 0,
      expectedOutcome: '',
      error: message,
    }
  }
}

// ── Recent transactions ───────────────────────────────────────────────────────

/**
 * Fetch recent Horizon operations for a public key and map them to
 * the RecentTx shape used by WalletConnector's transaction tab.
 *
 * @param publicKey - Valid Stellar public key
 * @param limit - Max number of recent operations to fetch (default: 10)
 * @returns Array of recent transactions
 */
export async function getRecentTxHistory(publicKey: string, limit = 10): Promise<RecentTx[]> {
  try {
    const ops = await horizonServer
      .operations()
      .forAccount(publicKey)
      .limit(limit)
      .order('desc')
      .call()

    return ops.records.map((op): RecentTx => {
      const isPayment = op.type === 'payment' || op.type === 'create_account'
      const amount = isPayment && 'amount' in op ? String((op as any).amount) : '0'

      let type: RecentTx['type'] = 'other'
      if (op.type === 'payment') {
        type = (op as any).to === publicKey ? 'payout' : 'contribution'
      } else if (op.type === 'create_account') {
        type = 'contribution'
      }

      return {
        id: op.id,
        type,
        amount,
        timestamp: new Date(op.created_at),
        status: 'success',
      }
    })
  } catch {
    return []
  }
}

// ── Testnet funding ───────────────────────────────────────────────────────────

/**
 * Fund a testnet account via Friendbot.
 * On mainnet this always returns false.
 *
 * @param publicKey - Stellar public key to fund
 * @returns True if successfully funded
 */
export async function fundWithFriendbot(publicKey: string): Promise<boolean> {
  if (!IS_TESTNET) return false
  try {
    const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Return the "Add Funds" URL:
 * - Testnet → Friendbot page
 * - Mainnet → External exchange page
 *
 * @param publicKey - Stellar public key
 * @returns URL string
 */
export function getAddFundsUrl(publicKey: string): string {
  return IS_TESTNET
    ? `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
    : 'https://stellarx.com/markets/XLM'
}

// ── Penalty Management ───────────────────────────────────────────────────────

/**
 * Get penalty record for a specific member in a group
 *
 * @param groupId - The group ID
 * @param member - The member's address
 * @param useCache - Whether to use cached data
 * @returns Member penalty record
 */
export async function getMemberPenaltyRecord(
  groupId: string,
  member: string,
  useCache: boolean = true
): Promise<MemberPenaltyRecord> {
  const cacheKey = `member_penalty_record_${groupId}_${member}`

  if (useCache) {
    const cached = cacheService.get(cacheKey)
    if (cached) {
      return cached
    }
  }

  try {
    const contract = new SorobanClient.Contract(contractId)
    const account = new SorobanClient.Address(member)

    const result = await contract.call(
      'get_member_penalty_record',
      new SorobanClient.Address(member),
      new SorobanClient.U64(BigInt(groupId))
    )

    const record = result.val.toXDR('base64')

    // Parse the XDR result - this would need proper XDR parsing
    // For now, returning a mock structure that matches the contract
    const penaltyRecord: MemberPenaltyRecord = {
      member,
      groupId,
      lateCount: 0, // Extract from XDR
      onTimeCount: 0, // Extract from XDR
      totalPenalties: 0, // Extract from XDR
      reliabilityScore: 100, // Extract from XDR
    }

    if (useCache) {
      cacheService.set(cacheKey, penaltyRecord, 60 * 1000) // 1 minute cache
    }

    return penaltyRecord
  } catch (error) {
    console.error('Failed to get member penalty record:', error)
    throw error
  }
}

/**
 * Get aggregated penalty statistics for a group
 *
 * @param groupId - The group ID
 * @param useCache - Whether to use cached data
 * @returns Group penalty statistics
 */
export async function getGroupPenaltyStats(
  groupId: string,
  useCache: boolean = true
): Promise<PenaltyStats> {
  const cacheKey = `group_penalty_stats_${groupId}`

  if (useCache) {
    const cached = cacheService.get(cacheKey)
    if (cached) {
      return cached
    }
  }

  try {
    // Get all members first
    const members = await getGroupMembers(groupId, useCache)

    if (!members || members.length === 0) {
      const emptyStats: PenaltyStats = {
        totalPenalties: 0,
        averageReliabilityScore: 100,
        totalLateContributions: 0,
        totalOnTimeContributions: 0,
        membersWithPenalties: 0,
        totalMembers: 0,
      }

      if (useCache) {
        cacheService.set(cacheKey, emptyStats, 60 * 1000)
      }

      return emptyStats
    }

    // Get penalty records for all members
    const penaltyPromises = members.map((member) =>
      getMemberPenaltyRecord(groupId, member.address, useCache)
    )

    const penaltyRecords = await Promise.all(penaltyPromises)

    // Calculate aggregate statistics
    const stats: PenaltyStats = {
      totalPenalties: penaltyRecords.reduce((sum, record) => sum + record.totalPenalties, 0),
      averageReliabilityScore:
        penaltyRecords.reduce((sum, record) => sum + record.reliabilityScore, 0) /
        penaltyRecords.length,
      totalLateContributions: penaltyRecords.reduce((sum, record) => sum + record.lateCount, 0),
      totalOnTimeContributions: penaltyRecords.reduce((sum, record) => sum + record.onTimeCount, 0),
      membersWithPenalties: penaltyRecords.filter((record) => record.totalPenalties > 0).length,
      totalMembers: penaltyRecords.length,
    }

    if (useCache) {
      cacheService.set(cacheKey, stats, 60 * 1000)
    }

    return stats
  } catch (error) {
    console.error('Failed to get group penalty stats:', error)
    throw error
  }
}

/**
 * Get penalty history for a group or specific member
 *
 * @param groupId - The group ID
 * @param member - Optional member address to filter by
 * @param limit - Maximum number of records to return
 * @param useCache - Whether to use cached data
 * @returns Array of penalty history items
 */
export async function getPenaltyHistory(
  groupId: string,
  member?: string,
  limit: number = 50,
  useCache: boolean = true
): Promise<PenaltyHistoryItem[]> {
  const cacheKey = `penalty_history_${groupId}_${member || 'all'}_${limit}`

  if (useCache) {
    const cached = cacheService.get(cacheKey)
    if (cached) {
      return cached
    }
  }

  try {
    // This would need to be implemented in the smart contract
    // For now, returning mock data
    const mockHistory: PenaltyHistoryItem[] = [
      {
        id: '1',
        groupId,
        member: member || 'GBX4Q7...',
        cycle: 1,
        penaltyAmount: 10,
        isLate: true,
        timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        reason: 'Late contribution',
      },
      {
        id: '2',
        groupId,
        member: member || 'GBX4Q7...',
        cycle: 2,
        penaltyAmount: 0,
        isLate: false,
        timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        reason: 'On-time contribution',
      },
    ]

    if (useCache) {
      cacheService.set(cacheKey, mockHistory, 2 * 60 * 1000) // 2 minute cache
    }

    return mockHistory.slice(0, limit)
  } catch (error) {
    console.error('Failed to get penalty history:', error)
    throw error
  }
}

/**
 * Get all penalty records for a user across all groups
 *
 * @param userId - The user's address
 * @param useCache - Whether to use cached data
 * @returns Array of member penalty records
 */
export async function getUserPenaltyRecords(
  userId: string,
  useCache: boolean = true
): Promise<MemberPenaltyRecord[]> {
  const cacheKey = `user_penalty_records_${userId}`

  if (useCache) {
    const cached = cacheService.get(cacheKey)
    if (cached) {
      return cached
    }
  }

  try {
    // Get all groups the user is a member of
    const userGroups = await getUserGroups(userId, useCache)

    if (!userGroups || userGroups.length === 0) {
      return []
    }

    // Get penalty records for each group
    const penaltyPromises = userGroups.map((group) =>
      getMemberPenaltyRecord(group.id, userId, useCache)
    )

    const penaltyRecords = await Promise.all(penaltyPromises)

    if (useCache) {
      cacheService.set(cacheKey, penaltyRecords, 5 * 60 * 1000) // 5 minute cache
    }

    return penaltyRecords
  } catch (error) {
    console.error('Failed to get user penalty records:', error)
    throw error
  }
}

/**
 * Invalidate penalty-related cache for a group
 *
 * @param groupId - The group ID
 */
export function invalidateGroupPenaltyCache(groupId: string): void {
  const patterns = [
    `member_penalty_record_${groupId}_`,
    `group_penalty_stats_${groupId}`,
    `penalty_history_${groupId}_`,
  ]

  patterns.forEach((pattern) => {
    cacheService.invalidateByPattern(pattern)
  })
}

/**
 * Invalidate all penalty-related cache
 */
export function invalidateAllPenaltyCache(): void {
  const patterns = [
    'member_penalty_record_',
    'group_penalty_stats_',
    'penalty_history_',
    'user_penalty_records_',
  ]

  patterns.forEach((pattern) => {
    cacheService.invalidateByPattern(pattern)
  })
}
