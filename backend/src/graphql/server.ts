import { ApolloServer, ApolloServerPlugin } from '@apollo/server'
import { expressMiddleware } from '@apollo/server/express4'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { GraphQLError } from 'graphql'
import { Express } from 'express'
import { typeDefs } from './schema'
import { resolvers } from './resolvers'
import { createGraphQLContext } from './context'
import { assertQueryComplexity } from './complexity'
import { AppError } from '../errors/AppError'
import { createIpLimiter } from '../middleware/rateLimiter'
import { logger } from '../utils/logger'

const schema = makeExecutableSchema({ typeDefs, resolvers })

// Query-complexity is checked once per operation, before execution starts —
// this is what makes it a meaningful rate limit for GraphQL (see complexity.ts),
// unlike a flat per-request limit which can't distinguish a cheap query from an
// arbitrarily expensive nested one.
const complexityPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation({ request, document, operationName }) {
        assertQueryComplexity({
          schema,
          document,
          variables: request.variables,
          operationName: operationName ?? request.operationName,
        })
      },
    }
  },
}

export async function setupGraphQL(app: Express) {
  const server = new ApolloServer({
    schema,
    plugins: [complexityPlugin],
    formatError: (formattedError, error) => {
      const original =
        error instanceof GraphQLError && error.originalError ? error.originalError : error

      if (original instanceof AppError) {
        logger.warn('GraphQL AppError', { code: original.code, message: original.message })
        return {
          message: original.message,
          extensions: { code: original.code, http: { status: original.statusCode } },
        }
      }

      logger.error('GraphQL Error', { message: formattedError.message })
      return {
        message: formattedError.message,
        extensions: { code: formattedError.extensions?.code || 'INTERNAL_SERVER_ERROR' },
      }
    },
  })

  await server.start()

  // Coarse per-IP floor, matching REST's global `/api` limiter, in addition to
  // the query-complexity check above which bounds per-request cost.
  const graphqlIpLimiter = createIpLimiter('api')

  app.use(
    '/graphql',
    graphqlIpLimiter,
    expressMiddleware(server, {
      context: async ({ req }) => createGraphQLContext(req),
    })
  )

  return server
}
