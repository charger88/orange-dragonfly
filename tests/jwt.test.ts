import { createHmac, createSign, generateKeyPairSync } from 'node:crypto'
import { decodeAndVerify } from '../src/utils/jwt'
import type { KeySource, ClaimsOptions, ODJWTAlgorithm } from '../src/utils/jwt'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url')
}

const NO_CLAIMS: ClaimsOptions = {}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** Creates a signed HMAC JWT for testing. */
function makeHSToken(
  payload: Record<string, unknown>,
  secret: string,
  alg: 'HS256' | 'HS384' | 'HS512' = 'HS256',
): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const hmacAlg = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg]
  const sig = createHmac(hmacAlg, secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

/** Creates a signed RSA JWT for testing. */
function makeRSToken(payload: Record<string, unknown>, privateKeyPem: string, alg: 'RS256' | 'RS384' | 'RS512' = 'RS256'): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const nodeAlg = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512' }[alg]
  const sig = createSign(nodeAlg).update(`${header}.${body}`).sign(privateKeyPem, 'base64url')
  return `${header}.${body}.${sig}`
}

const SECRET = 'test-secret-for-jwt-utils'
const hmacKeySource: KeySource = { type: 'secret', value: SECRET }

// RSA key pair generated once for the test suite
const { privateKey: rsaPrivate, publicKey: rsaPublic } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const rsaPrivatePem = rsaPrivate.export({ type: 'pkcs8', format: 'pem' }) as string
const rsaPublicPem = rsaPublic.export({ type: 'spki', format: 'pem' }) as string
const rsaKeySource: KeySource = { type: 'publicKey', value: rsaPublicPem }

// ---------------------------------------------------------------------------

describe('decodeAndVerify – HMAC tokens', () => {
  test('returns payload for a valid HS256 token', async () => {
    const token = makeHSToken({ sub: 'u1', exp: now() + 3600 }, SECRET)
    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS)
    expect(payload.sub).toBe('u1')
  })

  test('returns payload for a valid HS384 token', async () => {
    const token = makeHSToken({ sub: 'u2' }, SECRET, 'HS384')
    const payload = await decodeAndVerify(token, ['HS384'], hmacKeySource, 0, 60, NO_CLAIMS)
    expect(payload.sub).toBe('u2')
  })

  test('returns payload for a valid HS512 token', async () => {
    const token = makeHSToken({ sub: 'u3' }, SECRET, 'HS512')
    const payload = await decodeAndVerify(token, ['HS512'], hmacKeySource, 0, 60, NO_CLAIMS)
    expect(payload.sub).toBe('u3')
  })

  test('throws on invalid signature', async () => {
    const token = makeHSToken({ sub: 'u1' }, 'wrong-secret')
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT signature')
  })

  test('throws when algorithm is not in the allowed list', async () => {
    const token = makeHSToken({ sub: 'u1' }, SECRET, 'HS384')
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Algorithm "HS384" is not allowed')
  })

  test('throws when secret key source is used with an asymmetric algorithm', async () => {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`
    await expect(decodeAndVerify(token, ['RS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('options.secret is only valid for HMAC algorithms')
  })
})

// ---------------------------------------------------------------------------

describe('decodeAndVerify – token format', () => {
  test('throws on a token with fewer than 3 parts', async () => {
    await expect(decodeAndVerify('a.b', ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT format')
  })

  test('throws on a token with more than 3 parts', async () => {
    await expect(decodeAndVerify('a.b.c.d', ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT format')
  })

  test('throws on invalid base64url encoding', async () => {
    await expect(decodeAndVerify('!!!.!!!.!!!', ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT encoding')
  })

  test('sanitizes CR/LF characters in disallowed algorithm errors', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256\r\nforged-log' }))
    const body = b64url(JSON.stringify({}))
    await expect(decodeAndVerify(`${header}.${body}.`, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Algorithm "HS256 forged-log" is not allowed')
  })

  test('throws when header is not valid JSON', async () => {
    const header = Buffer.from('not-json').toString('base64url')
    const body = b64url(JSON.stringify({}))
    await expect(decodeAndVerify(`${header}.${body}.sig`, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT encoding')
  })

  test('throws when header is not a JSON object', async () => {
    const header = Buffer.from('null').toString('base64url')
    const body = b64url(JSON.stringify({}))
    await expect(decodeAndVerify(`${header}.${body}.sig`, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT header')
  })

  test('throws when payload is not a JSON object', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256' }))
    const body = Buffer.from('[]').toString('base64url')
    await expect(decodeAndVerify(`${header}.${body}.sig`, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT payload')
  })
})

// ---------------------------------------------------------------------------

describe('decodeAndVerify – expiry and time claims', () => {
  test('throws on expired token', async () => {
    const token = makeHSToken({ sub: 'u1', exp: now() - 10 }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Token expired')
  })

  test('accepts an expired token within expirationGap', async () => {
    const token = makeHSToken({ sub: 'u1', exp: now() - 5 }, SECRET)
    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 10, 60, NO_CLAIMS)
    expect(payload.sub).toBe('u1')
  })

  test('throws when nbf is in the future beyond clockTolerance', async () => {
    const token = makeHSToken({ sub: 'u1', nbf: now() + 200 }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Token not yet valid')
  })

  test('accepts token whose nbf is within clockTolerance', async () => {
    const token = makeHSToken({ sub: 'u1', nbf: now() + 30 }, SECRET)
    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS)
    expect(payload.sub).toBe('u1')
  })

  test('throws when iat is far in the future', async () => {
    const token = makeHSToken({ sub: 'u1', iat: now() + 200 }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('future issued-at')
  })

  test('throws when exp is not a number', async () => {
    const token = makeHSToken({ sub: 'u1', exp: 'not-a-number' as unknown as number }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('invalid exp claim')
  })

  test('throws when nbf is not a number', async () => {
    const token = makeHSToken({ sub: 'u1', nbf: 'not-a-number' as unknown as number }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('invalid nbf claim')
  })
})

// ---------------------------------------------------------------------------

describe('decodeAndVerify – claim validation', () => {
  test('accepts token whose issuer matches', async () => {
    const token = makeHSToken({ sub: 'u1', iss: 'https://auth.example.com' }, SECRET)
    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: ['https://auth.example.com'],
      audience: undefined,
      typ: undefined,
    })
    expect(payload.iss).toBe('https://auth.example.com')
  })

  test('throws when issuer does not match', async () => {
    const token = makeHSToken({ sub: 'u1', iss: 'https://other.example.com' }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: ['https://auth.example.com'],
      audience: undefined,
      typ: undefined,
    })).rejects.toThrow('Invalid token issuer')
  })

  test('throws when issuer claim is missing but issuer validation is configured', async () => {
    const token = makeHSToken({ sub: 'u1' }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: ['https://auth.example.com'],
      audience: undefined,
      typ: undefined,
    })).rejects.toThrow('Invalid token issuer')
  })

  test('accepts token whose audience matches (string aud)', async () => {
    const token = makeHSToken({ sub: 'u1', aud: 'api.example.com' }, SECRET)
    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: undefined,
      audience: ['api.example.com'],
      typ: undefined,
    })
    expect(payload.aud).toBe('api.example.com')
  })

  test('accepts token whose audience matches (array aud)', async () => {
    const token = makeHSToken({ sub: 'u1', aud: ['api.example.com', 'admin.example.com'] }, SECRET)
    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: undefined,
      audience: ['api.example.com'],
      typ: undefined,
    })
    expect(Array.isArray(payload.aud)).toBe(true)
  })

  test('throws when audience does not match', async () => {
    const token = makeHSToken({ sub: 'u1', aud: 'other.example.com' }, SECRET)
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: undefined,
      audience: ['api.example.com'],
      typ: undefined,
    })).rejects.toThrow('Invalid token audience')
  })

  test('accepts token with matching typ', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`
    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: undefined,
      audience: undefined,
      typ: ['jwt'],
    })
    expect(payload.sub).toBe('u1')
  })

  test('throws when typ does not match', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`
    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      issuer: undefined,
      audience: undefined,
      typ: ['at+jwt'],
    })).rejects.toThrow('Invalid token type')
  })
})

// ---------------------------------------------------------------------------

describe('decodeAndVerify â€“ crit header validation', () => {
  test('accepts a token when all crit values are allowed', async () => {
    const header = b64url(JSON.stringify({
      alg: 'HS256',
      crit: ['tenant'],
      tenant: 'blue',
    }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    const payload = await decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      crit: ['tenant'],
    })

    expect(payload.sub).toBe('u1')
  })

  test('throws when crit is present and no allowlist is configured', async () => {
    const header = b64url(JSON.stringify({
      alg: 'HS256',
      crit: ['tenant'],
      tenant: 'blue',
    }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid token crit header')
  })

  test('throws when crit contains a value outside the allowlist', async () => {
    const header = b64url(JSON.stringify({
      alg: 'HS256',
      crit: ['tenant'],
      tenant: 'blue',
    }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      crit: ['region'],
    })).rejects.toThrow('Invalid token crit header')
  })

  test('throws when crit references a missing header parameter', async () => {
    const header = b64url(JSON.stringify({
      alg: 'HS256',
      crit: ['tenant'],
    }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      crit: ['tenant'],
    })).rejects.toThrow('Invalid token crit header')
  })

  test('throws when crit is an empty array', async () => {
    const header = b64url(JSON.stringify({
      alg: 'HS256',
      crit: [],
    }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    await expect(decodeAndVerify(token, ['HS256'], hmacKeySource, 0, 60, {
      crit: ['tenant'],
    })).rejects.toThrow('Invalid token crit header')
  })
})

// ---------------------------------------------------------------------------

describe('decodeAndVerify – RSA tokens', () => {
  test('returns payload for a valid RS256 token', async () => {
    const token = makeRSToken({ sub: 'rsa-user', exp: now() + 3600 }, rsaPrivatePem)
    const payload = await decodeAndVerify(token, ['RS256'], rsaKeySource, 0, 60, NO_CLAIMS)
    expect(payload.sub).toBe('rsa-user')
  })

  test('throws on invalid RSA signature', async () => {
    const { privateKey: otherPrivate } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const otherPrivatePem = otherPrivate.export({ type: 'pkcs8', format: 'pem' }) as string
    const token = makeRSToken({ sub: 'rsa-user' }, otherPrivatePem)
    await expect(decodeAndVerify(token, ['RS256'], rsaKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT signature')
  })

  test('throws when publicKey source is used with HMAC algorithm', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ sub: 'u1' }))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`
    await expect(decodeAndVerify(token, ['HS256'], rsaKeySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('options.publicKey is not valid for HMAC algorithms')
  })
})

// ---------------------------------------------------------------------------

describe('decodeAndVerify – JWKS key source', () => {
  test('returns payload when key resolves successfully', async () => {
    const token = makeHSToken({ sub: 'jwks-user', exp: now() + 3600 }, SECRET)
    const keySource: KeySource = {
      type: 'jwks',
      resolve: async () => {
        // Return a key that matches our HMAC secret - use a real KeyObject
        const { createSecretKey } = await import('node:crypto')
        return [createSecretKey(Buffer.from(SECRET))]
      },
    }
    const payload = await decodeAndVerify(token, ['HS256'], keySource, 0, 60, NO_CLAIMS)
    expect(payload.sub).toBe('jwks-user')
  })

  test('throws when no JWKS key matches the signature', async () => {
    const token = makeHSToken({ sub: 'jwks-user' }, SECRET)
    const { createSecretKey } = await import('node:crypto')
    const keySource: KeySource = {
      type: 'jwks',
      resolve: async () => [createSecretKey(Buffer.from('wrong-key'))],
    }
    await expect(decodeAndVerify(token, ['HS256'], keySource, 0, 60, NO_CLAIMS))
      .rejects.toThrow('Invalid JWT signature')
  })
})

// ---------------------------------------------------------------------------

describe('decodeAndVerify – multiple algorithms', () => {
  test('accepts any algorithm in the allowed list', async () => {
    const token384 = makeHSToken({ sub: 'u1' }, SECRET, 'HS384')
    const payload = await decodeAndVerify(token384, ['HS256', 'HS384', 'HS512'] as ODJWTAlgorithm[], hmacKeySource, 0, 60, NO_CLAIMS)
    expect(payload.sub).toBe('u1')
  })
})
