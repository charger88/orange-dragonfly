export interface ODCache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds?: number | null): Promise<void>
  delete(key: string): Promise<void>
  /**
   * Atomically increments a counter by 1 and returns the new value.
   * Returns null when the counter could not be stored due to a cache overflow
   * (only possible when maxSize is configured and the overflow strategy discards the key).
   */
  increment(key: string, ttlSeconds?: number | null): Promise<number | null>
}

interface ODMemoryCacheValue {
  value: unknown
  expiresAt: number | null
}

export type ODMemoryCacheOverflowStrategy =
  | 'ignore-new'
  | 'throw'
  | 'log'
  | 'callback'
  | 'forced-cleanup'

export interface ODMemoryCacheEntry {
  key: string
  expiresAt: number | null
}

export interface ODMemoryCacheOptions {
  maxSize?: number | null
  overflowStrategy?: ODMemoryCacheOverflowStrategy
  /** Used by 'callback' strategy. Return true to allow saving, false to discard. */
  onOverflow?: (key: string) => boolean
  /** Used by 'forced-cleanup' strategy. Same sign convention as Array.sort - negative means evict `a` first. Defaults to soonest-expiry (null expiresAt = never expires = evicted last). */
  evictionComparator?: (a: ODMemoryCacheEntry, b: ODMemoryCacheEntry) => number
}

/**
 * In-memory cache implementation with TTL support and configurable overflow and eviction behavior.
 */
export class ODMemoryCache implements ODCache {
  private _store: Map<string, ODMemoryCacheValue> = new Map()
  private _maxSize: number | null
  private _overflowStrategy: ODMemoryCacheOverflowStrategy
  private _onOverflow: ((key: string) => boolean) | undefined
  private _evictionComparator: ((a: ODMemoryCacheEntry, b: ODMemoryCacheEntry) => number) | undefined
  private _expiryTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Initializes internal state for this OD Memory Cache.
   *
   * @param options Optional configuration values.
   */
  constructor(options: ODMemoryCacheOptions = {}) {
    if (options.maxSize != null && options.maxSize <= 0) {
      throw new RangeError('ODMemoryCache: maxSize must be a positive integer')
    }
    this._maxSize = options.maxSize ?? null
    this._overflowStrategy = options.overflowStrategy ?? 'ignore-new'
    this._onOverflow = options.onOverflow
    this._evictionComparator = options.evictionComparator
  }

  /**
   * Checks whether a cache entry has passed its expiration timestamp.
   *
   * @param v Input value.
   * @returns True when the check succeeds.
   */
  private _isExpired(v: ODMemoryCacheValue): boolean {
    return v.expiresAt !== null && v.expiresAt <= Date.now()
  }

  /**
   * Computes the absolute expiration timestamp for a TTL value, or null for non-expiring entries.
   *
   * @param ttlSeconds Time-to-live in seconds.
   * @returns Expiration timestamp in milliseconds, or null for non-expiring entries.
   */
  private _expiresAt(ttlSeconds: number | null | undefined): number | null {
    if (ttlSeconds === null || ttlSeconds === undefined) {
      return null
    }
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError(`ODMemoryCache: ttlSeconds must be a positive finite number, got: ${ttlSeconds}`)
    }
    return Date.now() + (ttlSeconds * 1000)
  }

  /**
   * Removes expired entries from the in-memory cache store.
   */
  private _purgeExpired(): void {
    for (const [key, value] of this._store) {
      if (this._isExpired(value)) {
        this._store.delete(key)
      }
    }
  }

  /**
   * Stops the currently scheduled expiration timer, if one exists.
   */
  private _clearExpiryTimer(): void {
    if (this._expiryTimer !== null) {
      clearTimeout(this._expiryTimer)
      this._expiryTimer = null
    }
  }

  /**
   * Schedules the next expiration sweep for the earliest expiring key.
   */
  private _scheduleNextExpiry(): void {
    this._clearExpiryTimer()
    let nextExpiry: number | null = null
    for (const value of this._store.values()) {
      if (value.expiresAt !== null && (nextExpiry === null || value.expiresAt < nextExpiry)) {
        nextExpiry = value.expiresAt
      }
    }
    if (nextExpiry === null) {
      return
    }

    const delay = Math.max(0, nextExpiry - Date.now())
    const timer = setTimeout(() => {
      this._expiryTimer = null
      this._purgeExpired()
      this._scheduleNextExpiry()
    }, delay)
    const timerWithUnref = timer as ReturnType<typeof setTimeout> & { unref?: () => void }
    timerWithUnref.unref?.()
    this._expiryTimer = timer
  }

  /**
   * Evicts cache entries until capacity constraints are satisfied according to the configured strategy.
   */
  private _evict(): void {
    const compare = this._evictionComparator
      ?? ((a: ODMemoryCacheEntry, b: ODMemoryCacheEntry) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))
    let candidate: [string, ODMemoryCacheValue] | undefined
    for (const entry of this._store) {
      if (!candidate || compare(
        { key: entry[0], expiresAt: entry[1].expiresAt },
        { key: candidate[0], expiresAt: candidate[1].expiresAt },
      ) < 0) {
        candidate = entry
      }
    }
    if (candidate) this._store.delete(candidate[0])
  }

  /**
   * Handles cache overflow according to the configured overflow strategy.
   *
   * @param key Lookup key.
   * @returns True when the new entry may be stored, or false when it should be discarded.
   */
  private _handleOverflow(key: string): boolean {
    switch (this._overflowStrategy) {
      case 'ignore-new':
        return false
      case 'throw':
        throw new Error(`ODMemoryCache overflow: cannot set key "${key}", max size of ${this._maxSize} reached`)
      case 'log':
        console.warn(`ODMemoryCache overflow: key "${key}" was not added, max size of ${this._maxSize} reached`)
        return false
      case 'callback':
        return this._onOverflow?.(key) ?? false
      case 'forced-cleanup':
        this._evict()
        return true
    }
  }

  /**
   * Returns the value exposed by this property descriptor.
   *
   * @param key Lookup key.
   * @returns A promise that resolves to the operation result.
   */
  async get<T>(key: string): Promise<T | null> {
    const current = this._store.get(key)
    if (!current) {
      return null
    }
    if (this._isExpired(current)) {
      this._store.delete(key)
      this._scheduleNextExpiry()
      return null
    }
    return current.value as T
  }

  /**
   * Performs the asynchronous set operation for this OD Memory Cache.
   *
   * @param key Lookup key.
   * @param value Value to use.
   * @param ttlSeconds Time-to-live in seconds.
   */
  async set<T>(key: string, value: T, ttlSeconds: number | null = null): Promise<void> {
    if (this._maxSize !== null && !this._store.has(key) && this._store.size >= this._maxSize) {
      this._purgeExpired()
      if (this._store.size >= this._maxSize) {
        if (!this._handleOverflow(key)) return
      }
    }
    this._store.set(key, { value, expiresAt: this._expiresAt(ttlSeconds) })
    this._scheduleNextExpiry()
  }

  /**
   * Performs the asynchronous delete operation for this OD Memory Cache.
   *
   * @param key Lookup key.
   */
  async delete(key: string): Promise<void> {
    if (this._store.delete(key)) {
      this._scheduleNextExpiry()
    }
  }

  /**
   * Performs the asynchronous increment operation for this OD Memory Cache.
   *
   * @param key Lookup key.
   * @param ttlSeconds Time-to-live in seconds.
   * @returns A promise that resolves to the operation result.
   */
  async increment(key: string, ttlSeconds: number | null = null): Promise<number | null> {
    const entry = this._store.get(key)
    const isExpired = entry !== undefined && this._isExpired(entry)
    if (isExpired) this._store.delete(key)
    const isExisting = entry !== undefined && !isExpired
    let current: number | null = null
    if (isExisting) {
      if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
        throw new TypeError(`ODMemoryCache increment: key "${key}" does not contain a finite number`)
      }
      current = entry.value
    }
    if (this._maxSize !== null && !isExisting && this._store.size >= this._maxSize) {
      this._purgeExpired()
      if (this._store.size >= this._maxSize) {
        if (!this._handleOverflow(key)) return null
      }
    }
    const next = (current ?? 0) + 1
    const expiresAt = isExisting ? entry.expiresAt : this._expiresAt(ttlSeconds)
    this._store.set(key, { value: next, expiresAt })
    this._scheduleNextExpiry()
    return next
  }
}
