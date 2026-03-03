import { Readable } from 'stream'
import { readFileSync } from 'fs'
import path from 'path'
import ODApp from '../../src/core/app'
import ODRequest from '../../src/core/request'
import StaticController from '../controllers/static'

const STORAGE_DIR = path.resolve(process.cwd(), 'example', 'storage')

let app: ODApp

beforeAll(async() => {
  app = await ODApp
    .create()
    .useController(StaticController)
    .init()
})

async function readStream(readable: Readable): Promise<string> {
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    readable.on('data', (chunk: Buffer) => chunks.push(chunk))
    readable.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    readable.on('error', reject)
  })
}

describe('StaticController', () => {
  test('GET /static/:file streams an existing .txt file', async() => {
    const req = new ODRequest({ method: 'GET', url: '/static/static-file.txt' })
    const res = await app.processRequest(req)
    expect(res.code).toBe(200)
    expect(res.content).toBeInstanceOf(Readable)
    const ct = res.headers.find(h => h.name === 'Content-Type')
    expect(ct?.value).toBe('text/plain')
    const body = await readStream(res.content as Readable)
    const expected = readFileSync(path.join(STORAGE_DIR, 'static-file.txt'), 'utf-8')
    expect(body).toBe(expected)
  })

  test('GET /static/:file streams an existing .html file with correct content-type', async() => {
    const req = new ODRequest({ method: 'GET', url: '/static/hello.html' })
    const res = await app.processRequest(req)
    try {
      expect(res.code).toBe(200)
      expect(res.content).toBeInstanceOf(Readable)
      const ct = res.headers.find(h => h.name === 'Content-Type')
      expect(ct?.value).toBe('text/html')
    } finally {
      if (res.content instanceof Readable) {
        res.content.destroy()
      }
    }
  })

  test('GET /static/:file returns 404 for a missing file', async() => {
    const req = new ODRequest({ method: 'GET', url: '/static/nonexistent.txt' })
    const res = await app.processRequest(req)
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('GET /static/:file returns 404 for path traversal attempt', async() => {
    const encoded = encodeURIComponent('../setup.ts')
    const req = new ODRequest({ method: 'GET', url: `/static/${encoded}` })
    const res = await app.processRequest(req)
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('GET /static/:file returns 404 for a non-existent sub-path', async() => {
    const encoded = encodeURIComponent('subdir/file.txt')
    const req = new ODRequest({ method: 'GET', url: `/static/${encoded}` })
    const res = await app.processRequest(req)
    expect(res.code).toBe(404)
    expect(res.content).toEqual({ error: 'File not found' })
  })

  test('OPTIONS /static/:file returns 204 with Allow header', async() => {
    const req = new ODRequest({ method: 'OPTIONS', url: '/static/static-file.txt' })
    const res = await app.processRequest(req)
    expect(res.code).toBe(204)
    const allow = res.headers.find(h => h.name === 'Allow')
    expect(allow?.value).toContain('GET')
  })
})
