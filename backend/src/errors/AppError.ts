/**
 * Base application error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
  public readonly isOperational: boolean
  
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: any,
    isOperational: boolean = true
  ) {
    super(message)
    this.isOperational = isOperational
    
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor)
    
    // Set the prototype explicitly
    Object.setPrototypeOf(this, AppError.prototype)
  }
  
  toJSON() {
    return {
      success: false,
      error: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
    }
  }

  /**
   * graphql-js reads `originalError.extensions` when it wraps a thrown error
   * (see locatedError/GraphQLError), so this alone is enough for AppError
   * subclasses thrown from a resolver to surface the right GraphQL error
   * `code`/status without any GraphQL-specific import in this file.
   */
  get extensions(): Record<string, unknown> {
    return { code: this.code, http: { status: this.statusCode } }
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details)
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`
    super(message, 'NOT_FOUND', 404)
    Object.setPrototypeOf(this, NotFoundError.prototype)
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 'UNAUTHORIZED', 401)
    Object.setPrototypeOf(this, UnauthorizedError.prototype)
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Access forbidden') {
    super(message, 'FORBIDDEN', 403)
    Object.setPrototypeOf(this, ForbiddenError.prototype)
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'CONFLICT', 409, details)
    Object.setPrototypeOf(this, ConflictError.prototype)
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, { retryAfter })
    Object.setPrototypeOf(this, RateLimitError.prototype)
  }
}

/**
 * Soroban/Contract specific errors
 */
export class ContractError extends AppError {
  constructor(message: string, contractError?: any) {
    super(message, 'CONTRACT_ERROR', 500, { contractError })
    Object.setPrototypeOf(this, ContractError.prototype)
  }
}

export class TransactionError extends AppError {
  constructor(message: string, txHash?: string, details?: any) {
    super(message, 'TRANSACTION_ERROR', 500, { txHash, ...details })
    Object.setPrototypeOf(this, TransactionError.prototype)
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(required: number, available: number) {
    super(
      `Insufficient balance. Required: ${required}, Available: ${available}`,
      'INSUFFICIENT_BALANCE',
      400,
      { required, available }
    )
    Object.setPrototypeOf(this, InsufficientBalanceError.prototype)
  }
}

/**
 * Network/External service errors
 */
export class NetworkError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'NETWORK_ERROR', 503, details)
    Object.setPrototypeOf(this, NetworkError.prototype)
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeout: number) {
    super(
      `Operation '${operation}' timed out after ${timeout}ms`,
      'TIMEOUT_ERROR',
      504,
      { operation, timeout }
    )
    Object.setPrototypeOf(this, TimeoutError.prototype)
  }
}

/**
 * Internal server error (500)
 */
export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', details?: any) {
    super(message, 'INTERNAL_SERVER_ERROR', 500, details, false)
    Object.setPrototypeOf(this, InternalServerError.prototype)
  }
}

/**
 * Error factory for creating errors from unknown sources
 */
export class ErrorFactory {
  static fromUnknown(error: unknown): AppError {
    if (error instanceof AppError) {
      return error
    }
    
    if (error instanceof Error) {
      return new InternalServerError(error.message, {
        originalError: error.name,
        stack: error.stack,
      })
    }
    
    return new InternalServerError('An unknown error occurred', { error })
  }
  
  static isOperational(error: unknown): boolean {
    if (error instanceof AppError) {
      return error.isOperational
    }
    return false
  }
}
