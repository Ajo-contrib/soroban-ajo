/**
 * Batches multiple Soroban contract invocations into a single Stellar
 * transaction (one operation per call), reusing the same
 * build → simulate → assemble → sign → send → poll flow used for single
 * contract calls elsewhere in services/soroban.ts.
 *
 * Stellar transactions are atomic: either every operation in the envelope
 * applies, or none do. So on success every batched operation is reported
 * successful; on failure every operation is reported failed with the same
 * reason — there is no partial-success state to report within one tx.
 */
import * as SorobanClient from 'stellar-sdk'

export interface BatchOperation {
  id: string
  contractAddress: string
  methodName: string
  args: SorobanClient.xdr.ScVal[]
  description?: string
}

export interface BatchValidationResult {
  valid: boolean
  errors: string[]
}

export interface BatchGasEstimate {
  gasEstimate: number
  feeEstimate: number
  operationCount: number
}

export interface BatchOperationResult {
  id: string
  success: boolean
  error?: string
}

export interface BatchExecutionResult {
  success: boolean
  batchId: string
  gasUsed: number
  results: BatchOperationResult[]
  error?: string
}

// Stellar caps the number of operations in a single transaction at 100.
const MAX_BATCH_OPERATIONS = 100

function toInt128Parts(value: bigint): SorobanClient.xdr.Int128Parts {
  const mask64 = (1n << 64n) - 1n
  return new SorobanClient.xdr.Int128Parts({
    hi: new SorobanClient.xdr.Int64(value >> 64n),
    lo: new SorobanClient.xdr.Uint64(value & mask64),
  })
}

/**
 * Best-effort conversion of a plain JS value into a Soroban ScVal.
 * For arguments that need a specific numeric width (u64, i128, ...) or a
 * contract/account address, pass a pre-built `xdr.ScVal` directly instead of
 * relying on this inference.
 */
export function createScVal(value: any): SorobanClient.xdr.ScVal {
  if (value && typeof value === 'object' && typeof value.switch === 'function') {
    // Already an xdr.ScVal
    return value as SorobanClient.xdr.ScVal
  }
  if (typeof value === 'boolean') {
    return SorobanClient.xdr.ScVal.scvBool(value)
  }
  if (typeof value === 'bigint') {
    return SorobanClient.xdr.ScVal.scvI128(toInt128Parts(value))
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 0xffffffff
      ? SorobanClient.xdr.ScVal.scvU32(value)
      : SorobanClient.xdr.ScVal.scvI128(toInt128Parts(BigInt(Math.trunc(value))))
  }
  if (typeof value === 'string') {
    const looksLikeAddress = /^[GC][A-Z2-7]{55}$/.test(value)
    return looksLikeAddress
      ? SorobanClient.xdr.ScVal.scvAddress(SorobanClient.Address.fromString(value).toScAddress())
      : SorobanClient.xdr.ScVal.scvString(value)
  }
  throw new Error(`createScVal: unsupported argument type for value ${JSON.stringify(value)}`)
}

export class TransactionBatcher {
  constructor(
    private readonly server: SorobanClient.SorobanRpc.Server,
    private readonly networkPassphrase: string
  ) {}

  validateBatchable(operations: BatchOperation[]): BatchValidationResult {
    const errors: string[] = []

    if (operations.length === 0) {
      errors.push('Batch must contain at least one operation')
    }
    if (operations.length > MAX_BATCH_OPERATIONS) {
      errors.push(`Batch exceeds the maximum of ${MAX_BATCH_OPERATIONS} operations per transaction`)
    }

    const seenIds = new Set<string>()
    for (const op of operations) {
      if (!op.contractAddress) errors.push(`Operation ${op.id} is missing a contractAddress`)
      if (!op.methodName) errors.push(`Operation ${op.id} is missing a methodName`)
      if (seenIds.has(op.id)) errors.push(`Duplicate operation id: ${op.id}`)
      seenIds.add(op.id)
    }

    return { valid: errors.length === 0, errors }
  }

  private buildTransaction(
    operations: BatchOperation[],
    sourceAccount: SorobanClient.Account,
    timeoutSeconds = 30
  ) {
    const builder = new SorobanClient.TransactionBuilder(sourceAccount, {
      fee: String(100 * operations.length),
      networkPassphrase: this.networkPassphrase,
    })

    for (const op of operations) {
      const contract = new SorobanClient.Contract(op.contractAddress)
      builder.addOperation(contract.call(op.methodName, ...op.args))
    }

    return builder.setTimeout(timeoutSeconds).build()
  }

  async estimateBatchGas(
    operations: BatchOperation[],
    sourceAccount: SorobanClient.Account
  ): Promise<BatchGasEstimate> {
    const transaction = this.buildTransaction(operations, sourceAccount)
    const simulated = await this.server.simulateTransaction(transaction)

    if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
      throw new Error('Batch simulation failed')
    }

    const feeEstimate = Number(simulated.minResourceFee ?? 0)

    return {
      gasEstimate: feeEstimate,
      feeEstimate,
      operationCount: operations.length,
    }
  }

  async executeBatch(
    operations: BatchOperation[],
    sourceAccount: SorobanClient.Account,
    signTransaction: (
      xdr: string,
      opts: { networkPassphrase: string }
    ) => Promise<{ signedTxXdr: string }>,
    options: { simulateOnly?: boolean; timeout?: number } = {}
  ): Promise<BatchExecutionResult> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const transaction = this.buildTransaction(operations, sourceAccount, options.timeout)

    const simulated = await this.server.simulateTransaction(transaction)
    if (!SorobanClient.SorobanRpc.Api.isSimulationSuccess(simulated)) {
      return {
        success: false,
        batchId,
        gasUsed: 0,
        results: operations.map((op) => ({
          id: op.id,
          success: false,
          error: 'Simulation failed',
        })),
        error: 'Batch simulation failed',
      }
    }

    const gasUsed = Number(simulated.minResourceFee ?? 0)

    if (options.simulateOnly) {
      return {
        success: true,
        batchId,
        gasUsed,
        results: operations.map((op) => ({ id: op.id, success: true })),
      }
    }

    try {
      const assembled = SorobanClient.SorobanRpc.assembleTransaction(transaction, simulated).build()
      const signedXdr = await signTransaction(assembled.toXDR(), {
        networkPassphrase: this.networkPassphrase,
      })
      const signedTransaction = SorobanClient.TransactionBuilder.fromXDR(
        signedXdr.signedTxXdr,
        this.networkPassphrase
      )

      const sendResult = await this.server.sendTransaction(
        signedTransaction as SorobanClient.Transaction
      )
      if (sendResult.errorResult) {
        const error = `Transaction submitted with error: ${sendResult.errorResult.toXDR().toString('base64')}`
        return {
          success: false,
          batchId,
          gasUsed,
          results: operations.map((op) => ({ id: op.id, success: false, error })),
          error,
        }
      }

      let statusResponse = await this.server.getTransaction(sendResult.hash)
      let attempts = 0
      while (
        statusResponse.status !== SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS &&
        attempts < 10
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        statusResponse = await this.server.getTransaction(sendResult.hash)
        attempts++
      }

      const success =
        statusResponse.status === SorobanClient.SorobanRpc.Api.GetTransactionStatus.SUCCESS
      return {
        success,
        batchId,
        gasUsed,
        results: operations.map((op) => ({
          id: op.id,
          success,
          error: success ? undefined : `Transaction status: ${statusResponse.status}`,
        })),
        error: success ? undefined : `Transaction status: ${statusResponse.status}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Batch execution failed'
      return {
        success: false,
        batchId,
        gasUsed,
        results: operations.map((op) => ({ id: op.id, success: false, error: message })),
        error: message,
      }
    }
  }
}
