import { Request } from 'express'
import { AuthService } from '../services/authService'
import { verifyAdminToken } from '../middleware/adminAuth'
import { createDataLoaders } from './dataloader'
import { GraphQLContext } from './types/context'

/**
 * Builds the per-request GraphQL context, resolving the same Bearer token
 * REST's authMiddleware/adminAuth verify. Unlike REST, GraphQL doesn't reject
 * unauthenticated requests at the transport level (a query can mix public and
 * protected fields) — resolvers that require auth check `context.walletAddress`
 * / `context.admin` themselves and throw, mirroring each REST route's guard.
 */
export function createGraphQLContext(req: Request): GraphQLContext {
  const context: GraphQLContext = { loaders: createDataLoaders() }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return context
  }
  const token = authHeader.substring(7)

  try {
    const payload = AuthService.verifyToken(token)
    if (!payload.purpose || payload.purpose === 'auth') {
      context.walletAddress = payload.publicKey
    }
  } catch {
    // invalid/expired token: leave walletAddress unset, same as REST leaving
    // req.user unset for routes that don't hard-require authMiddleware
  }

  try {
    context.admin = verifyAdminToken(token)
  } catch {
    // not an admin token: leave context.admin unset
  }

  return context
}
