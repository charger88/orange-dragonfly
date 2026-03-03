import { ODMemoryCache } from '../src/core/cache'

test('set/get/delete works', async() => {
  const cache = new ODMemoryCache()
  await cache.set('a', { ok: true })
  expect(await cache.get<{ ok: boolean }>('a')).toEqual({ ok: true })
  await cache.delete('a')
  expect(await cache.get('a')).toBeNull()
})

test('ttl expires values', async() => {
  const cache = new ODMemoryCache()
  await cache.set('a', 'v', 0.01)
  expect(await cache.get('a')).toBe('v')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(await cache.get('a')).toBeNull()
})

test('ttl auto-cleans the nearest expiry and reschedules the next one', async() => {
  jest.useFakeTimers()
  try {
    const cache = new ODMemoryCache()
    const store = (cache as unknown as { _store: Map<string, unknown> })._store

    await cache.set('a', 'first', 0.01)
    await cache.set('b', 'second', 0.02)

    expect(store.has('a')).toBe(true)
    expect(store.has('b')).toBe(true)

    jest.advanceTimersByTime(11)
    expect(store.has('a')).toBe(false)
    expect(store.has('b')).toBe(true)

    jest.advanceTimersByTime(10)
    expect(store.has('b')).toBe(false)
  } finally {
    jest.useRealTimers()
  }
})

test('increment initializes and advances counter', async() => {
  const cache = new ODMemoryCache()
  expect(await cache.increment('counter', 1)).toBe(1)
  expect(await cache.increment('counter', 1)).toBe(2)
})

test('increment resets after ttl', async() => {
  const cache = new ODMemoryCache()
  expect(await cache.increment('counter', 0.01)).toBe(1)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(await cache.increment('counter', 0.01)).toBe(1)
})

test('increment throws when the existing value is not a finite number', async() => {
  const cache = new ODMemoryCache()
  await cache.set('counter', 'x')
  await expect(cache.increment('counter')).rejects.toThrow(TypeError)
  expect(await cache.get('counter')).toBe('x')
})

test('ttl=0 throws RangeError', async() => {
  const cache = new ODMemoryCache()
  await expect(cache.set('k', 'v', 0)).rejects.toThrow(RangeError)
})

test('negative ttl throws RangeError', async() => {
  const cache = new ODMemoryCache()
  await expect(cache.set('k', 'v', -5)).rejects.toThrow(RangeError)
})

test('Infinity ttl throws RangeError', async() => {
  const cache = new ODMemoryCache()
  await expect(cache.set('k', 'v', Infinity)).rejects.toThrow(RangeError)
})

describe('maxSize and overflow strategies', () => {
  test('constructor throws RangeError for maxSize <= 0', () => {
    expect(() => new ODMemoryCache({ maxSize: 0 })).toThrow(RangeError)
    expect(() => new ODMemoryCache({ maxSize: -1 })).toThrow(RangeError)
  })

  test('no size limit by default', async() => {
    const cache = new ODMemoryCache()
    for (let i = 0; i < 100; i++) await cache.set(`k${i}`, i)
    expect(await cache.get('k99')).toBe(99)
  })

  test('ignore-new: new entries discarded when at limit', async() => {
    const cache = new ODMemoryCache({ maxSize: 2, overflowStrategy: 'ignore-new' })
    await cache.set('a', 1)
    await cache.set('b', 2)
    await cache.set('c', 3)
    expect(await cache.get('a')).toBe(1)
    expect(await cache.get('b')).toBe(2)
    expect(await cache.get('c')).toBeNull()
  })

  test('throw: rejects on overflow', async() => {
    const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'throw' })
    await cache.set('a', 1)
    await expect(cache.set('b', 2)).rejects.toThrow()
  })

  test('log: warns and discards on overflow', async() => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'log' })
      await cache.set('a', 1)
      await cache.set('b', 2)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(await cache.get('b')).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  test('callback: onOverflow returning false discards the new entry', async() => {
    const onOverflow = jest.fn(() => false)
    const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'callback', onOverflow })
    await cache.set('a', 1)
    await cache.set('b', 2)
    expect(onOverflow).toHaveBeenCalledWith('b')
    expect(await cache.get('b')).toBeNull()
  })

  test('callback: onOverflow returning true allows the new entry', async() => {
    const onOverflow = jest.fn(() => true)
    const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'callback', onOverflow })
    await cache.set('a', 1)
    await cache.set('b', 2)
    expect(onOverflow).toHaveBeenCalledWith('b')
    expect(await cache.get('b')).toBe(2)
  })

  test('forced-cleanup: evicts soonest-expiring entry by default', async() => {
    const cache = new ODMemoryCache({ maxSize: 2, overflowStrategy: 'forced-cleanup' })
    await cache.set('a', 1, 0.05)  // expires soon
    await cache.set('b', 2)        // no expiry
    await cache.set('c', 3)        // triggers eviction - 'a' should go
    expect(await cache.get('a')).toBeNull()
    expect(await cache.get('b')).toBe(2)
    expect(await cache.get('c')).toBe(3)
  })

  test('forced-cleanup: evictionComparator controls which entry is evicted', async() => {
    // Reversed: evict the entry with the LATEST expiry first (null = Infinity = evicted first)
    const cache = new ODMemoryCache({
      maxSize: 2,
      overflowStrategy: 'forced-cleanup',
      evictionComparator: (a, b) => (b.expiresAt ?? Infinity) - (a.expiresAt ?? Infinity),
    })
    await cache.set('a', 1, 0.05)  // expires soon
    await cache.set('b', 2)        // no expiry (Infinity) - evicted first with this comparator
    await cache.set('c', 3)        // triggers eviction - 'b' should go
    expect(await cache.get('a')).toBe(1)
    expect(await cache.get('b')).toBeNull()
    expect(await cache.get('c')).toBe(3)
  })

  test('updating an existing key never triggers overflow', async() => {
    const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'throw' })
    await cache.set('a', 1)
    await expect(cache.set('a', 2)).resolves.toBeUndefined()
    expect(await cache.get('a')).toBe(2)
  })

  test('expired entries are purged before overflow is triggered', async() => {
    const cache = new ODMemoryCache({ maxSize: 2, overflowStrategy: 'ignore-new' })
    await cache.set('a', 1, 0.01)
    await cache.set('b', 2)
    await new Promise(resolve => setTimeout(resolve, 20))
    // 'a' is expired - purge should free a slot so 'c' is accepted
    await cache.set('c', 3)
    expect(await cache.get('c')).toBe(3)
  })

  test('increment: overflow on new key returns null', async() => {
    const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'ignore-new' })
    await cache.set('a', 'x')
    expect(await cache.increment('counter')).toBeNull()
  })

  test('increment: updating existing key at maxSize is allowed', async() => {
    const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'throw' })
    await cache.increment('counter')
    await expect(cache.increment('counter')).resolves.toBe(2)
  })

  test('callback: no onOverflow function falls back to false (??)', async() => {
    // overflowStrategy='callback' but onOverflow is not provided -> _onOverflow?.(key) = undefined -> ?? false
    const cache = new ODMemoryCache({ maxSize: 1, overflowStrategy: 'callback' })
    await cache.set('a', 1)
    await cache.set('b', 2)  // triggers callback -> undefined ?? false -> discarded
    expect(await cache.get('b')).toBeNull()
  })

  test('forced-cleanup: _evict when all entries have null expiresAt (both use ?? Infinity)', async() => {
    // Both entries are permanent (null expiresAt), so both compare Infinity - Infinity = 0.
    // The first entry in iteration order is chosen as candidate and evicted.
    const cache = new ODMemoryCache({ maxSize: 2, overflowStrategy: 'forced-cleanup' })
    await cache.set('a', 1)
    await cache.set('b', 2)
    await cache.set('c', 3)  // triggers _evict with default comparator; both 'a' and 'b' have expiresAt=null
    // One of 'a'/'b' should be gone, 'c' should be present
    const aOrB = (await cache.get('a')) ?? (await cache.get('b'))
    expect(aOrB).not.toBeNull()  // at least one survived
    expect(await cache.get('c')).toBe(3)
  })

  test('increment: purgeExpired frees a slot so no overflow handling is needed', async() => {
    const cache = new ODMemoryCache({ maxSize: 2, overflowStrategy: 'ignore-new' })
    await cache.set('a', 'x', 0.01)  // will expire
    await cache.set('b', 'y')
    await new Promise(resolve => setTimeout(resolve, 20))
    // At this point 'a' is expired; incrementing a new key 'c' should trigger purge
    // which removes 'a', freeing a slot -> no overflow -> returns 1
    expect(await cache.increment('c')).toBe(1)
  })
})
