const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false
  const proto = Object.getPrototypeOf(input)
  return proto === Object.prototype || proto === null
}

/**
 * Checks whether a key is unsafe to copy into nested objects (prototype-pollution guard).
 *
 * @param key Lookup key.
 * @returns True when the check succeeds.
 */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key)
}

/**
 * Recursively sanitizes input objects by removing dangerous keys that could lead to prototype pollution.
 *
 * @param input Input payload.
 * @returns The sanitized value.
 */
export function sanitizeInput<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input
  if (Array.isArray(input)) {
    const arrayInput = input as unknown as Record<string, unknown>
    for (const key of Object.keys(arrayInput)) {
      if (DANGEROUS_KEYS.has(key)) {
        delete arrayInput[key]
      } else {
        arrayInput[key] = sanitizeInput(arrayInput[key])
      }
    }
    return input
  }
  if (!isPlainObject(input)) return input

  const objectInput = input as Record<string, unknown>
  for (const key of Object.keys(objectInput)) {
    if (DANGEROUS_KEYS.has(key)) {
      delete objectInput[key]
    } else {
      objectInput[key] = sanitizeInput(objectInput[key])
    }
  }
  return input
}
