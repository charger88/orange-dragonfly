import { sanitizeInput, isDangerousKey } from '../src/utils/sanitize-input'

describe('isDangerousKey', () => {
  test('detects __proto__', () => {
    expect(isDangerousKey('__proto__')).toBe(true)
  })

  test('detects constructor', () => {
    expect(isDangerousKey('constructor')).toBe(true)
  })

  test('detects prototype', () => {
    expect(isDangerousKey('prototype')).toBe(true)
  })

  test('allows normal keys', () => {
    expect(isDangerousKey('name')).toBe(false)
    expect(isDangerousKey('id')).toBe(false)
    expect(isDangerousKey('__proto')).toBe(false)
    expect(isDangerousKey('proto__')).toBe(false)
    expect(isDangerousKey('')).toBe(false)
  })
})

describe('sanitizeInput', () => {
  test('passes through primitives unchanged', () => {
    expect(sanitizeInput('hello')).toBe('hello')
    expect(sanitizeInput(42)).toBe(42)
    expect(sanitizeInput(null)).toBe(null)
    expect(sanitizeInput(true)).toBe(true)
    expect(sanitizeInput(undefined)).toBe(undefined)
  })

  test('passes through clean objects unchanged', () => {
    const obj = { name: 'Alice', age: 30 }
    expect(sanitizeInput(obj)).toEqual({ name: 'Alice', age: 30 })
  })

  test('removes __proto__ from top level', () => {
    const obj = JSON.parse('{"name":"Alice","__proto__":{"admin":true}}')
    const result = sanitizeInput(obj)
    expect(result).toEqual({ name: 'Alice' })
    expect(Object.hasOwn(result, '__proto__')).toBe(false)
  })

  test('removes constructor from top level', () => {
    const obj = { name: 'Alice', constructor: { prototype: { admin: true } } }
    const result = sanitizeInput(obj)
    expect(result.name).toBe('Alice')
    expect(Object.keys(result)).toEqual(['name'])
  })

  test('removes prototype from top level', () => {
    const obj = { name: 'Alice', prototype: { admin: true } }
    const result = sanitizeInput(obj)
    expect(result.name).toBe('Alice')
    expect(Object.keys(result)).toEqual(['name'])
  })

  test('removes dangerous keys from nested objects', () => {
    const obj = JSON.parse('{"user":{"name":"Alice","__proto__":{"admin":true}}}')
    const result = sanitizeInput(obj)
    expect(result).toEqual({ user: { name: 'Alice' } })
  })

  test('removes dangerous keys from deeply nested objects', () => {
    const obj = JSON.parse('{"a":{"b":{"c":{"__proto__":{"polluted":true},"safe":"value"}}}}')
    const result = sanitizeInput(obj)
    expect(result).toEqual({ a: { b: { c: { safe: 'value' } } } })
  })

  test('sanitizes objects inside arrays', () => {
    const obj = JSON.parse('[{"name":"ok"},{"__proto__":{"admin":true},"name":"bad"}]')
    const result = sanitizeInput(obj)
    expect(result).toEqual([{ name: 'ok' }, { name: 'bad' }])
  })

  test('handles arrays of primitives', () => {
    expect(sanitizeInput([1, 2, 3])).toEqual([1, 2, 3])
    expect(sanitizeInput(['a', 'b'])).toEqual(['a', 'b'])
  })

  test('sanitizes enumerable array properties without iterating by length only', () => {
    const arr = [] as unknown[] & Record<string, unknown>
    arr['meta'] = JSON.parse('{"__proto__":{"admin":true},"safe":"ok"}')

    const result = sanitizeInput(arr) as unknown[] & Record<string, unknown>

    expect(result['meta']).toEqual({ safe: 'ok' })
  })

  test('handles empty objects and arrays', () => {
    expect(sanitizeInput({})).toEqual({})
    expect(sanitizeInput([])).toEqual([])
  })

  test('leaves non-plain objects unchanged', () => {
    const buf = Buffer.from([1, 2, 3])
    expect(sanitizeInput(buf)).toBe(buf)
    expect([...buf]).toEqual([1, 2, 3])
  })

  test('does not pollute Object.prototype', () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":"yes"}}')
    sanitizeInput(malicious)
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  test('removes multiple dangerous keys in the same object', () => {
    const obj = JSON.parse('{"__proto__":{},"safe":"value","prototype":{},"constructor":{}}')
    const result = sanitizeInput(obj)
    expect(Object.keys(result)).toEqual(['safe'])
  })
})
