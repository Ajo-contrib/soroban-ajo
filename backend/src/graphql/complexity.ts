import { GraphQLError, GraphQLSchema, DocumentNode } from 'graphql'
import {
  getComplexity,
  simpleEstimator,
  fieldExtensionsEstimator,
} from 'graphql-query-complexity'

// A naive per-request rate limit is meaningless for GraphQL: a single request
// can nest fields arbitrarily deep and fan out expensive reads. This assigns
// every field a cost (1 by default, override via the `complexity` field
// extension) multiplied by how many times a list field repeats it, and
// rejects the operation before any resolver runs if the total exceeds budget.
export const MAX_QUERY_COMPLEXITY = Number(process.env.GRAPHQL_MAX_COMPLEXITY) || 1000

export class QueryComplexityError extends GraphQLError {
  constructor(complexity: number, max: number) {
    super(`Query is too complex: ${complexity}. Maximum allowed complexity: ${max}.`, {
      extensions: { code: 'QUERY_TOO_COMPLEX', complexity, max },
    })
  }
}

export function assertQueryComplexity(params: {
  schema: GraphQLSchema
  document: DocumentNode
  variables?: Record<string, unknown>
  operationName?: string | null
  maxComplexity?: number
}): number {
  const maxComplexity = params.maxComplexity ?? MAX_QUERY_COMPLEXITY

  const complexity = getComplexity({
    schema: params.schema,
    query: params.document,
    variables: params.variables,
    operationName: params.operationName ?? undefined,
    estimators: [
      fieldExtensionsEstimator(),
      simpleEstimator({ defaultComplexity: 1 }),
    ],
  })

  if (complexity > maxComplexity) {
    throw new QueryComplexityError(complexity, maxComplexity)
  }

  return complexity
}
