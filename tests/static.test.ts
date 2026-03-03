import { Readable } from 'stream'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'
import { serveStaticFiles } from '../src/utils/static'

const STORAGE_DIR = path.resolve(process.cwd(), 'example', 'storage')
const createdResponses: ODResponse[] = []

function makeResponse() {
  const response = new ODResponse()
  createdResponses.push(response)
  return response
}

// --- Shared temp directory with a richer layout for sub-path and MIME-type tests ---

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'od-static-'))
  mkdirSync(path.join(tmpDir, 'assets'))
  writeFileSync(path.join(tmpDir, 'top.txt'),             'top-level')
  writeFileSync(path.join(tmpDir, 'binary.xyz'),          'binary content')
  writeFileSync(path.join(tmpDir, 'assets', 'logo.png'),  'png bytes')
  writeFileSync(path.join(tmpDir, 'assets', 'style.css'), 'body{}')
})

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore: Windows may hold handles briefly after stream tests */ }
})

afterEach(() => {
  for (const response of createdResponses.splice(0)) {
    if (response.content instanceof Readable) response.content.destroy()
  }
})

// --- Basic success ---

describe('serveStaticFiles', () => {
  test('returns 200 with Readable stream for an existing file', async () => {
    const res = await serveStaticFiles('static-file.txt', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(200)
    expect(res.content).toBeInstanceOf(Readable)
  })

  test('streams the correct bytes', async () => {
    const res = await serveStaticFiles('static-file.txt', STORAGE_DIR, makeResponse())
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      (res.content as Readable).on('data', (c: Buffer) => chunks.push(c))
      ;(res.content as Readable).on('end', resolve)
      ;(res.content as Readable).on('error', reject)
    })
    const body = Buffer.concat(chunks).toString('utf-8')
    const expected = readFileSync(path.join(STORAGE_DIR, 'static-file.txt'), 'utf-8')
    expect(body).toBe(expected)
  })

  test('returns the same ODResponse instance', async () => {
    const response = makeResponse()
    const returned = await serveStaticFiles('static-file.txt', STORAGE_DIR, response)
    expect(returned).toBe(response)
  })

  test('resets a stale status code when serving a full file', async () => {
    const response = makeResponse()
    response.code = 304

    const res = await serveStaticFiles('static-file.txt', STORAGE_DIR, response)

    expect(res.code).toBe(200)
  })

  test('preserves pre-existing headers on the response', async () => {
    const response = makeResponse()
    response.addHeader('X-Custom', 'keep')
    await serveStaticFiles('static-file.txt', STORAGE_DIR, response)
    expect(response.headers.find(h => h.name === 'X-Custom')).toBeDefined()
  })

  test('replaces singleton static headers instead of duplicating them', async () => {
    const response = makeResponse()
    response.addHeader('Cache-Control', 'private')
    response.addHeader('ETag', '"stale"')
    response.addHeader('Last-Modified', 'Thu, 01 Jan 1970 00:00:00 GMT')
    response.addHeader('Accept-Ranges', 'none')
    response.addHeader('Content-Length', '999')

    await serveStaticFiles('static-file.txt', STORAGE_DIR, response)

    expect(response.headers.filter(h => h.name === 'Cache-Control')).toHaveLength(1)
    expect(response.headers.find(h => h.name === 'Cache-Control')?.value).toBe('public, max-age=3600')
    expect(response.headers.filter(h => h.name === 'ETag')).toHaveLength(1)
    expect(response.headers.find(h => h.name === 'ETag')?.value).not.toBe('"stale"')
    expect(response.headers.filter(h => h.name === 'Last-Modified')).toHaveLength(1)
    expect(response.headers.find(h => h.name === 'Last-Modified')?.value).not.toBe('Thu, 01 Jan 1970 00:00:00 GMT')
    expect(response.headers.find(h => h.name === 'Accept-Ranges')).toBeUndefined()
    expect(response.headers.filter(h => h.name === 'Content-Length')).toHaveLength(1)
    expect(response.headers.find(h => h.name === 'Content-Length')?.value)
      .toBe(String(readFileSync(path.join(STORAGE_DIR, 'static-file.txt')).length))
  })

  // --- Sub-path support ---

  test('serves a file in a sub-directory (sub-path)', async () => {
    const res = await serveStaticFiles('assets/logo.png', tmpDir, makeResponse())
    expect(res.code).toBe(200)
    expect(res.content).toBeInstanceOf(Readable)
    const ct = res.headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('image/png')
  })

  test('serves a file at the top level of baseDir', async () => {
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    expect(res.code).toBe(200)
    const ct = res.headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('text/plain')
  })

  // --- MIME types ---

  test('sets Content-Type for .txt', async () => {
    const ct = (await serveStaticFiles('static-file.txt', STORAGE_DIR, makeResponse()))
      .headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('text/plain')
  })

  test('sets Content-Type for .html', async () => {
    const ct = (await serveStaticFiles('hello.html', STORAGE_DIR, makeResponse()))
      .headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('text/html')
  })

  test('falls back to application/octet-stream for an unknown extension', async () => {
    const res = await serveStaticFiles('binary.xyz', tmpDir, makeResponse())
    expect(res.code).toBe(200)
    const ct = res.headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('application/octet-stream')
  })

  test('mimeTypes option adds a new extension mapping', async () => {
    const res = await serveStaticFiles('binary.xyz', tmpDir, makeResponse(), null, {
      mimeTypes: { '.xyz': 'application/xyz' },
    })
    expect(res.code).toBe(200)
    const ct = res.headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('application/xyz')
  })

  test('mimeTypes option overrides a built-in mapping', async () => {
    const res = await serveStaticFiles('assets/style.css', tmpDir, makeResponse(), null, {
      mimeTypes: { '.css': 'text/css; charset=utf-8' },
    })
    expect(res.code).toBe(200)
    const ct = res.headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('text/css; charset=utf-8')
  })

  // --- Not found ---

  test('returns 404 for a missing file', async () => {
    const res = await serveStaticFiles('nonexistent.txt', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for a missing file in a sub-path', async () => {
    const res = await serveStaticFiles('assets/missing.png', tmpDir, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 when the path points to a directory, not a file', async () => {
    const res = await serveStaticFiles('assets', tmpDir, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('clears stale static headers when returning 404', async () => {
    const response = makeResponse()
    response.addHeader('Content-Type', 'text/plain')
    response.addHeader('Content-Length', '999')
    response.addHeader('Content-Range', 'bytes 0-0/1')
    response.addHeader('Cache-Control', 'public, max-age=3600')
    response.addHeader('ETag', '"stale"')
    response.addHeader('Last-Modified', 'Thu, 01 Jan 1970 00:00:00 GMT')
    response.addHeader('Accept-Ranges', 'bytes')

    const res = await serveStaticFiles('nonexistent.txt', STORAGE_DIR, response)

    expect(res.code).toBe(404)
    expect(res.headers.find(h => h.name === 'Content-Type')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Length')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Range')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Cache-Control')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'ETag')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Last-Modified')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Accept-Ranges')).toBeUndefined()
  })

  // --- Security: path traversal (all return 404 to avoid leaking filesystem structure) ---

  test('returns 404 for an empty path', async () => {
    const res = await serveStaticFiles('', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for a literal path traversal (../)', async () => {
    const res = await serveStaticFiles('../setup.ts', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for a deep literal traversal (../../)', async () => {
    const res = await serveStaticFiles('../../package.json', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for a percent-encoded traversal (%2F)', async () => {
    const res = await serveStaticFiles('..%2Fsetup.ts', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for an absolute path', async () => {
    const res = await serveStaticFiles('/etc/passwd', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for a traversal hidden inside a sub-path', async () => {
    const res = await serveStaticFiles('assets/../../package.json', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for invalid percent-encoding', async () => {
    const res = await serveStaticFiles('%GG', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for a null-byte injection', async () => {
    const res = await serveStaticFiles('file.txt\0.jpg', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for paths containing a colon', async () => {
    const res = await serveStaticFiles('file.txt:secret', STORAGE_DIR, makeResponse())
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('returns 404 for a symlink pointing outside baseDir (symlink escape)', async () => {
    // Create a file outside tmpDir, then symlink to it from inside tmpDir
    const outsideFile = path.join(os.tmpdir(), `od-outside-${Date.now()}.txt`)
    const symlinkPath = path.join(tmpDir, 'escape-link.txt')
    writeFileSync(outsideFile, 'sensitive')
    let symlinkCreated = false
    try {
      symlinkSync(outsideFile, symlinkPath)
      symlinkCreated = true
    } catch {
      // Symlinks may require elevated privileges (e.g. Windows without Developer Mode)
    }
    try {
      if (symlinkCreated) {
        const res = await serveStaticFiles('escape-link.txt', tmpDir, makeResponse())
        expect(res.code).toBe(404)
      }
    } finally {
      try { if (symlinkCreated) rmSync(symlinkPath) } catch { /* ignore */ }
      try { rmSync(outsideFile) } catch { /* ignore */ }
    }
  })
})

// --- cacheControl option ---

describe('serveStaticFiles – cacheControl option', () => {
  test('omits Cache-Control header when cacheControl is false', async () => {
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), null, { cacheControl: false })
    expect(res.code).toBe(200)
    expect(res.headers.find(h => h.name === 'Cache-Control')).toBeUndefined()
  })

  test('removes an existing Cache-Control header when cacheControl is false', async () => {
    const response = makeResponse()
    response.addHeader('Cache-Control', 'private')
    const res = await serveStaticFiles('top.txt', tmpDir, response, null, { cacheControl: false })
    expect(res.headers.find(h => h.name === 'Cache-Control')).toBeUndefined()
  })

  test('uses a custom Cache-Control value', async () => {
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), null, { cacheControl: 'no-store' })
    expect(res.headers.find(h => h.name === 'Cache-Control')?.value).toBe('no-store')
  })

  test('adds default Cache-Control when option is omitted', async () => {
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    expect(res.headers.find(h => h.name === 'Cache-Control')?.value).toBe('public, max-age=3600')
  })
})

describe('serveStaticFiles – strongEtags option', () => {
  test('uses a weak ETag by default', async () => {
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    const etag = res.headers.find(h => h.name === 'ETag')?.value
    expect(etag?.startsWith('W/')).toBe(true)
    expect(res.headers.find(h => h.name === 'Accept-Ranges')).toBeUndefined()
  })

  test('uses a strong content-hash ETag when strongEtags is true', async () => {
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), null, { strongEtags: true })
    const etag = res.headers.find(h => h.name === 'ETag')?.value
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)
    expect(res.headers.find(h => h.name === 'Accept-Ranges')?.value).toBe('bytes')
  })
})

// --- baseDir not found ---

describe('serveStaticFiles – missing baseDir', () => {
  test('returns 404 when baseDir itself does not exist', async () => {
    const res = await serveStaticFiles('file.txt', '/nonexistent/od-test-base-dir', makeResponse())
    expect(res.code).toBe(404)
  })
})

// --- Conditional requests ---

function makeRequest(headers: Record<string, string>, method: string = 'GET'): ODRequest {
  return new ODRequest({ method, url: '/', headers })
}

describe('serveStaticFiles – conditional requests', () => {
  test('returns 304 when If-None-Match matches the ETag', async () => {
    // First, fetch to get the actual ETag
    const first = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    const etag = first.headers.find(h => h.name === 'ETag')?.value
    expect(etag).toBeDefined()

    const req = makeRequest({ 'if-none-match': etag! })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(304)
  })

  test('returns 304 when If-None-Match is the wildcard *', async () => {
    const req = makeRequest({ 'if-none-match': '*' })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(304)
  })

  test('returns 304 when If-None-Match weakly matches the current ETag in a list', async () => {
    const first = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    const etag = first.headers.find(h => h.name === 'ETag')?.value
    expect(etag).toBeDefined()

    const strongForm = etag!.replace(/^W\//, '')
    const req = makeRequest({ 'if-none-match': `"stale", ${strongForm}` })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(304)
  })

  test('returns 200 when If-None-Match does not match', async () => {
    const req = makeRequest({ 'if-none-match': '"stale-etag"' })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(200)
  })

  test('returns 412 for non-GET/HEAD requests when If-None-Match matches', async () => {
    const first = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    const etag = first.headers.find(h => h.name === 'ETag')?.value
    expect(etag).toBeDefined()

    const req = makeRequest({ 'if-none-match': etag! }, 'PUT')
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(412)
    expect(res.content).toEqual({ error: 'Precondition Failed' })
  })

  test('ignores If-Modified-Since when If-None-Match is present but does not match', async () => {
    const first = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    const lastModified = first.headers.find(h => h.name === 'Last-Modified')?.value
    expect(lastModified).toBeDefined()

    const req = makeRequest({
      'if-none-match': '"stale-etag"',
      'if-modified-since': lastModified!,
    })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(200)
  })

  test('returns 304 when If-Modified-Since is at or after the file mtime', async () => {
    // Fetch the Last-Modified value first
    const first = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    const lastModified = first.headers.find(h => h.name === 'Last-Modified')?.value
    expect(lastModified).toBeDefined()

    const req = makeRequest({ 'if-modified-since': lastModified! })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(304)
  })

  test('ignores non-HTTP If-Modified-Since values', async () => {
    const req = makeRequest({ 'if-modified-since': '2999-01-01T00:00:00Z' })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(200)
  })

  test('removes body-specific headers on a 304 response', async () => {
    const first = await serveStaticFiles('top.txt', tmpDir, makeResponse())
    const etag = first.headers.find(h => h.name === 'ETag')?.value
    expect(etag).toBeDefined()

    const response = makeResponse()
    response.addHeader('Content-Type', 'text/plain')
    response.addHeader('Content-Length', '999')
    response.addHeader('Content-Range', 'bytes 0-0/1')

    const req = makeRequest({ 'if-none-match': etag! })
    const res = await serveStaticFiles('top.txt', tmpDir, response, req)

    expect(res.code).toBe(304)
    expect(res.headers.find(h => h.name === 'Content-Type')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Length')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Range')).toBeUndefined()
  })

  test('returns 200 when If-Modified-Since is before the file mtime', async () => {
    const req = makeRequest({ 'if-modified-since': 'Thu, 01 Jan 1970 00:00:00 GMT' })
    const res = await serveStaticFiles('top.txt', tmpDir, makeResponse(), req)
    expect(res.code).toBe(200)
  })
})

// --- Range requests ---

// Write a known-content file for range tests
let rangeFile: string
let rangeContent: string

beforeAll(() => {
  rangeContent = 'ABCDEFGHIJ' // 10 bytes
  rangeFile = 'range-test.txt'
  writeFileSync(path.join(tmpDir, rangeFile), rangeContent)
})

describe('serveStaticFiles – range requests', () => {
  test('returns 206 with correct Content-Range for an explicit range', async () => {
    const req = makeRequest({ range: 'bytes=0-4' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes 0-4/10')
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('5')
  })

  test('accepts a mixed-case Range unit token', async () => {
    const req = makeRequest({ range: 'Bytes=0-4' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes 0-4/10')
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('5')
  })

  test('streams only the requested byte range', async () => {
    const req = makeRequest({ range: 'bytes=2-5' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      (res.content as Readable).on('data', (c: Buffer) => chunks.push(c))
      ;(res.content as Readable).on('end', resolve)
      ;(res.content as Readable).on('error', reject)
    })
    expect(Buffer.concat(chunks).toString()).toBe('CDEF')
  })

  test('returns 206 for a suffix range (bytes=-3)', async () => {
    const req = makeRequest({ range: 'bytes=-3' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes 7-9/10')
  })

  test('returns 206 for an open-ended range (bytes=7-)', async () => {
    const req = makeRequest({ range: 'bytes=7-' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes 7-9/10')
  })

  test('ignores Range and serves the full file when strongEtags is false', async () => {
    const req = makeRequest({ range: 'bytes=0-4' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req)
    expect(res.code).toBe(200)
    expect(res.headers.find(h => h.name === 'Content-Range')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('10')

    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      (res.content as Readable).on('data', (c: Buffer) => chunks.push(c))
      ;(res.content as Readable).on('end', resolve)
      ;(res.content as Readable).on('error', reject)
    })
    expect(Buffer.concat(chunks).toString()).toBe(rangeContent)
  })

  test('returns 200 when If-Range does not match the current representation', async () => {
    const req = makeRequest({ range: 'bytes=0-4', 'if-range': '"stale-etag"' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(200)
    expect(res.headers.find(h => h.name === 'Content-Range')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('10')

    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      (res.content as Readable).on('data', (c: Buffer) => chunks.push(c))
      ;(res.content as Readable).on('end', resolve)
      ;(res.content as Readable).on('error', reject)
    })
    expect(Buffer.concat(chunks).toString()).toBe(rangeContent)
  })

  test('returns 206 when If-Range matches the current Last-Modified value', async () => {
    const first = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), null, { strongEtags: true })
    const lastModified = first.headers.find(h => h.name === 'Last-Modified')?.value
    expect(lastModified).toBeDefined()

    const req = makeRequest({ range: 'bytes=0-4', 'if-range': lastModified! })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes 0-4/10')
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('5')
  })

  test('returns 200 when If-Range date is newer but not an exact Last-Modified match', async () => {
    const first = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), null, { strongEtags: true })
    const lastModified = first.headers.find(h => h.name === 'Last-Modified')?.value
    expect(lastModified).toBeDefined()

    const newerDate = new Date(Date.parse(lastModified!) + 1000).toUTCString()
    const req = makeRequest({ range: 'bytes=0-4', 'if-range': newerDate })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(200)
    expect(res.headers.find(h => h.name === 'Content-Range')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('10')
  })

  test('returns 206 when If-Range matches the current strong ETag', async () => {
    const first = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), null, { strongEtags: true })
    const etag = first.headers.find(h => h.name === 'ETag')?.value
    expect(etag).toBeDefined()

    const req = makeRequest({ range: 'bytes=0-4', 'if-range': etag! })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes 0-4/10')
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('5')
  })

  test('returns 416 for an out-of-range request', async () => {
    const req = makeRequest({ range: 'bytes=100-200' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(416)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes */10')
  })

  test('returns 200 for a syntactically invalid Range unit (RFC 7233: ignore and serve full content)', async () => {
    const req = makeRequest({ range: 'lines=0-5' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(200)
  })

  test('returns 200 for range values with trailing garbage (syntactically invalid)', async () => {
    const req = makeRequest({ range: 'bytes=0-4junk' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(200)
  })

  test('returns 200 when last-byte-pos < first-byte-pos (RFC 7233: syntactically invalid, not 416)', async () => {
    const req = makeRequest({ range: 'bytes=5-2' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(200)
  })

  test('returns 200 for multi-range requests (RFC 7233: multi-range not supported)', async () => {
    // RFC 7233 §4.1 allows servers that do not support multi-range to respond with 200
    // instead of multipart/byteranges. The comma signals multi-range.
    const req = makeRequest({ range: 'bytes=0-2,5-7' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(200)
  })

  test('clamps end to file size when requested range extends beyond EOF', async () => {
    // File is 10 bytes (0-9). bytes=3-999 -> clamp to bytes=3-9 -> serve 206
    const req = makeRequest({ range: 'bytes=3-999' })
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(206)
    expect(res.headers.find(h => h.name === 'Content-Range')?.value).toBe('bytes 3-9/10')
  })

  test('returns 200 (no range) when request has no Range header', async () => {
    const req = makeRequest({})
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req)
    expect(res.code).toBe(200)
  })

  test('ignores Range on HEAD requests and sends no body bytes', async () => {
    const req = makeRequest({ range: 'bytes=0-4' }, 'HEAD')
    const res = await serveStaticFiles(rangeFile, tmpDir, makeResponse(), req, { strongEtags: true })
    expect(res.code).toBe(200)
    expect(res.headers.find(h => h.name === 'Content-Range')).toBeUndefined()
    expect(res.headers.find(h => h.name === 'Content-Length')?.value).toBe('10')

    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      (res.content as Readable).on('data', (c: Buffer) => chunks.push(c))
      ;(res.content as Readable).on('end', resolve)
      ;(res.content as Readable).on('error', reject)
    })
    expect(Buffer.concat(chunks).toString()).toBe('')
  })
})
