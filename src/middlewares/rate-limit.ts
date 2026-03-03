import ODContext from '../core/context'
import { ODMiddlewareFunction, ODMiddlewareFunctionValue } from '../core/middleware'

export interface ODRateLimitRule {
  limit: number
  windowSeconds: number
}

export interface ODRateLimitOptions {
  global?: ODRateLimitRule | null
  controllers?: Record<string, ODRateLimitRule>
  actions?: Record<string, ODRateLimitRule>
  statusCode?: number
  message?: string
  keyPrefix?: string
}

interface ODRateLimitResolvedRule {
  scope: 'global' | 'controller' | 'action'
  scopeKey: string
  rule: ODRateLimitRule
}

/**
 * Asserts rule and throws when validation fails.
 *
 * @param name Rule name used in validation error messages.
 * @param rule Rate-limit rule to validate.
 */
function assertRule(name: string, rule: ODRateLimitRule): void {
  if (!Number.isInteger(rule.limit) || rule.limit <= 0) {
    throw new Error(`${name}.limit must be a positive integer`)
  }
  if (typeof rule.windowSeconds !== 'number' || !Number.isFinite(rule.windowSeconds) || rule.windowSeconds <= 0) {
    throw new Error(`${name}.windowSeconds must be a positive finite number`)
  }
  if (Math.floor(rule.windowSeconds * 1000) <= 0) {
    throw new Error(`${name}.windowSeconds must be at least 0.001 seconds`)
  }
}

/**
 * Resolves rate-limit rules for the current request context, including function-based rule definitions.
 *
 * @param context Request context.
 * @param options Optional configuration values.
 * @returns The computed result.
 */
function getResolvedRules(context: ODContext, options: ODRateLimitOptions): ODRateLimitResolvedRule[] {
  const rules: ODRateLimitResolvedRule[] = []
  if (options.global) {
    rules.push({ scope: 'global', scopeKey: 'global', rule: options.global })
  }

  const controllerName = context.route.controller.name
  const actionKey = `${controllerName}.${context.route.action}`

  const controllerRule = options.controllers?.[controllerName]
  if (controllerRule) {
    rules.push({ scope: 'controller', scopeKey: controllerName, rule: controllerRule })
  }

  const actionRule = options.actions?.[actionKey]
  if (actionRule) {
    rules.push({ scope: 'action', scopeKey: actionKey, rule: actionRule })
  }
  return rules
}

/**
 * Creates global rate-limiting middleware for application-wide throttling.
 *
 * @param limit Maximum number of requests allowed in the window.
 * @param windowSeconds Rate-limit window size in seconds.
 * @param options Optional configuration values.
 * @returns A configured middleware function.
 */
export function ODGlobalRateLimitMiddleware(
  limit: number,
  windowSeconds: number,
  options: Omit<ODRateLimitOptions, 'global'> = {},
): ODMiddlewareFunction {
  return ODRateLimitMiddleware({ ...options, global: { limit, windowSeconds } })
}

/**
 * Creates rate-limiting middleware that enforces request quotas using the app cache.
 *
 * @param options Optional configuration values.
 * @returns A configured middleware function.
 */
export default function ODRateLimitMiddleware(options: ODRateLimitOptions): ODMiddlewareFunction {
  const statusCode = options.statusCode ?? 429
  const message = options.message ?? 'Rate limit exceeded'
  const keyPrefix = options.keyPrefix ?? 'odrl'

  if (options.global) {
    assertRule('global', options.global)
  }
  for (const [name, rule] of Object.entries(options.controllers ?? {})) {
    assertRule(`controllers.${name}`, rule)
  }
  for (const [name, rule] of Object.entries(options.actions ?? {})) {
    assertRule(`actions.${name}`, rule)
  }

  return async(context: ODContext): ODMiddlewareFunctionValue => {
    const rules = getResolvedRules(context, options)
    // Colons in IPv6 addresses would split the cache key into unexpected segments;
    // replace them so the key structure is always colon-delimited by the framework.
    const safeIp = context.request.ip.replace(/:/g, '-')

    // Collect results from all applicable rules before setting headers so that
    // the most restrictive (lowest remaining) values are shown to the client,
    // not whichever rule happened to run last.
    let headerLimit: number | null = null
    let headerRemaining: number | null = null
    let headerReset: number | null = null
    let blockLimit: number | null = null
    let blockWindowSeconds: number | null = null
    let blockRetryAfter: number | null = null

    for (const { scope, scopeKey, rule } of rules) {
      const windowMs = Math.floor(rule.windowSeconds * 1000)
      const now = Date.now()
      const windowId = Math.floor(now / windowMs)
      const windowStart = windowId * windowMs
      const windowEnd = windowStart + windowMs
      const retryAfter = Math.max(1, Math.ceil((windowEnd - now) / 1000))
      const cacheKey = `${keyPrefix}:${scope}:${scopeKey}:${safeIp}:${windowId}`
      const count = await context.app.cache.increment(cacheKey, rule.windowSeconds)
      // null means the cache is full and the key could not be stored; skip rate limiting
      // for this request rather than incorrectly blocking or allowing based on stale data.
      if (count === null) continue
      const remaining = Math.max(0, rule.limit - count)
      const reset = Math.floor(windowEnd / 1000)

      // Track the most restrictive remaining (lowest) across all rules.
      // When remaining ties, prefer the later reset because that window keeps
      // the client blocked for longer.
      if (
        headerRemaining === null
        || remaining < headerRemaining
        || (remaining === headerRemaining && (headerReset === null || reset > headerReset))
      ) {
        headerLimit = rule.limit
        headerRemaining = remaining
        headerReset = reset
      }

      if (count > rule.limit) {
        // Surface the longest retry-after so clients wait until every
        // exceeded rule has actually reset before retrying.
        if (blockRetryAfter === null || retryAfter > blockRetryAfter) {
          blockLimit = rule.limit
          blockWindowSeconds = rule.windowSeconds
          blockRetryAfter = retryAfter
        }
      }
    }

    if (headerRemaining !== null) {
      context.response.setHeader('X-RateLimit-Limit', String(headerLimit))
      context.response.setHeader('X-RateLimit-Remaining', String(headerRemaining))
      context.response.setHeader('X-RateLimit-Reset', String(headerReset))
    }

    if (blockRetryAfter !== null) {
      context.response.setHeader('Retry-After', String(blockRetryAfter))
      return context.response.setError(statusCode, message, {
        method: context.route.method.toUpperCase(),
        path: context.route.path,
        limit: blockLimit,
        windowSeconds: blockWindowSeconds,
        retryAfter: blockRetryAfter,
      })
    }

    return
  }
}
