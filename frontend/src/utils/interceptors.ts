/**
 * Minimal fetch-based HTTP client with a request/response/error interceptor
 * chain, used by services (e.g. soroban.ts) that need to hook into outgoing
 * requests for tracing headers, logging, and centralized error reporting.
 */
import { cacheService } from '../services/cache'

export interface HttpRequestConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: any
  timeout?: number
  retries?: number
  cache?: boolean
  cacheTTL?: number
}

export interface HttpResponse<T = any> {
  data: T
  status: number
  statusText: string
  config: HttpRequestConfig
  duration: number
}

export interface HttpError extends Error {
  config: HttpRequestConfig
  status?: number
}

type RequestInterceptor = (
  config: HttpRequestConfig
) => HttpRequestConfig | Promise<HttpRequestConfig>
type ResponseInterceptor = (response: HttpResponse) => HttpResponse | Promise<HttpResponse>
type ErrorInterceptor = (error: HttpError) => HttpError | Promise<HttpError>

class InterceptorManager {
  private requestInterceptors: RequestInterceptor[] = []
  private responseInterceptors: ResponseInterceptor[] = []
  private errorInterceptors: ErrorInterceptor[] = []

  addRequestInterceptor(interceptor: RequestInterceptor): () => void {
    this.requestInterceptors.push(interceptor)
    return () => {
      const idx = this.requestInterceptors.indexOf(interceptor)
      if (idx !== -1) this.requestInterceptors.splice(idx, 1)
    }
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
    this.responseInterceptors.push(interceptor)
    return () => {
      const idx = this.responseInterceptors.indexOf(interceptor)
      if (idx !== -1) this.responseInterceptors.splice(idx, 1)
    }
  }

  addErrorInterceptor(interceptor: ErrorInterceptor): () => void {
    this.errorInterceptors.push(interceptor)
    return () => {
      const idx = this.errorInterceptors.indexOf(interceptor)
      if (idx !== -1) this.errorInterceptors.splice(idx, 1)
    }
  }

  async runRequestInterceptors(config: HttpRequestConfig): Promise<HttpRequestConfig> {
    let result = config
    for (const interceptor of this.requestInterceptors) {
      result = await interceptor(result)
    }
    return result
  }

  async runResponseInterceptors(response: HttpResponse): Promise<HttpResponse> {
    let result = response
    for (const interceptor of this.responseInterceptors) {
      result = await interceptor(result)
    }
    return result
  }

  async runErrorInterceptors(error: HttpError): Promise<HttpError> {
    let result = error
    for (const interceptor of this.errorInterceptors) {
      result = await interceptor(result)
    }
    return result
  }
}

export const interceptorManager = new InterceptorManager()

function cacheKeyFor(config: HttpRequestConfig): string {
  return `http:${config.method || 'GET'}:${config.url}:${config.body ? JSON.stringify(config.body) : ''}`
}

export async function httpRequest<T = any>(rawConfig: HttpRequestConfig): Promise<HttpResponse<T>> {
  const config = await interceptorManager.runRequestInterceptors(rawConfig)
  const method = config.method || 'GET'
  const useCache = config.cache && method === 'GET'
  const key = useCache ? cacheKeyFor(config) : null

  if (key) {
    const cached = cacheService.get<HttpResponse<T>>(key)
    if (cached) return cached
  }

  const start = Date.now()
  const maxRetries = config.retries ?? 0
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = config.timeout ? setTimeout(() => controller.abort(), config.timeout) : null

    try {
      const res = await fetch(config.url, {
        method,
        headers: config.headers,
        body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
        signal: controller.signal,
      })

      const data = (await res.json().catch(() => null)) as T

      if (!res.ok) {
        const error = Object.assign(new Error(`HTTP ${res.status}: ${res.statusText}`), {
          config,
          status: res.status,
        }) as HttpError
        throw error
      }

      let response: HttpResponse<T> = {
        data,
        status: res.status,
        statusText: res.statusText,
        config,
        duration: Date.now() - start,
      }
      response = (await interceptorManager.runResponseInterceptors(response)) as HttpResponse<T>

      if (key) {
        cacheService.set(key, response, { ttl: config.cacheTTL })
      }

      return response
    } catch (err) {
      lastError = err
      if (attempt === maxRetries) break
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  const httpError: HttpError =
    lastError instanceof Error && 'config' in lastError
      ? (lastError as HttpError)
      : Object.assign(
          new Error(lastError instanceof Error ? lastError.message : 'Request failed'),
          { config }
        )

  throw await interceptorManager.runErrorInterceptors(httpError)
}
