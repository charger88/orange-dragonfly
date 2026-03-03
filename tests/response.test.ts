import { Readable } from 'stream'
import ODResponse from '../src/core/response'

const HTML_EXAMPLE = '<html><body>Hello world!</body></html>'

test('default response', () => {
  const res = new ODResponse()
  expect(res.code).toBe(200)
  expect(res.headers).toEqual([])
  expect(res.content).toBe('')
})

test('constructor with arguments', () => {
  const res = new ODResponse(201, 'Created', [{ name: 'X-Custom', value: 'yes' }])
  expect(res.code).toBe(201)
  expect(res.content).toBe('Created')
  expect(res.headers).toEqual([{ name: 'X-Custom', value: 'yes' }])
})

test('json', () => {
  const res = new ODResponse()
  res.content = { test: 123 }
  expect(res.code).toBe(200)
  expect(res.content).toEqual({ test: 123 })
})

test('html', () => {
  const res = new ODResponse()
  res.content = HTML_EXAMPLE
  expect(res.code).toBe(200)
  expect(res.content).toBe(HTML_EXAMPLE)
})

test('array content', () => {
  const res = new ODResponse()
  res.content = [{ id: 1 }, { id: 2 }]
  expect(res.content).toEqual([{ id: 1 }, { id: 2 }])
})

test('convert resolves content type for json', async () => {
  const res = new ODResponse()
  res.content = { test: 123 }
  const [contentType, body] = await res.convert()
  expect(contentType).toBe('application/json; charset=utf-8')
  expect(body).toBe(JSON.stringify({ test: 123 }))
})

test('convert can use compact JSON output', async () => {
  const res = new ODResponse(200, '', [], { compactJsonResponse: false })
  res.content = { test: 123 }
  const [contentType, body] = await res.convert()
  expect(contentType).toBe('application/json; charset=utf-8')
  expect(body).toBe(JSON.stringify({ test: 123 }, null, 2))
})

test('convert resolves content type for json array', async () => {
  const res = new ODResponse(200, '', [], { compactJsonResponse: true })
  res.content = [1, 2, 3]
  const [contentType, body] = await res.convert()
  expect(contentType).toBe('application/json; charset=utf-8')
  expect(body).toBe(JSON.stringify([1, 2, 3]))
})

test('convert resolves content type for plain text', async () => {
  const res = new ODResponse()
  res.content = 'Hello world'
  const [contentType, body] = await res.convert()
  expect(contentType).toBe('text/plain; charset=utf-8')
  expect(body).toBe('Hello world')
})

test('convert returns null content-type for Buffer', async () => {
  const res = new ODResponse()
  res.content = Buffer.from('binary data')
  const [contentType, body] = await res.convert()
  expect(contentType).toBeNull()
  expect(body).toEqual(Buffer.from('binary data'))
})

test('convert handles Blob with type', async () => {
  const res = new ODResponse()
  res.content = new Blob(['hello'], { type: 'image/png' })
  const [contentType, body] = await res.convert()
  expect(contentType).toBe('image/png')
  expect(Buffer.isBuffer(body)).toBe(true)
})

test('convert returns no body for 204', async () => {
  const res = new ODResponse()
  res.code = 204
  res.content = 'should be ignored'
  const [contentType, body] = await res.convert()
  expect(contentType).toBeNull()
  expect(body).toBe('')
})

test('convert returns no body for 304', async () => {
  const res = new ODResponse()
  res.code = 304
  res.content = { data: 'should be ignored' }
  const [contentType, body] = await res.convert()
  expect(contentType).toBeNull()
  expect(body).toBe('')
})

test('convert handles null content', async () => {
  const res = new ODResponse()
  res.content = null as any
  const [contentType, body] = await res.convert()
  expect(contentType).toBeNull()
  expect(body).toBe('')
})

test('add header', () => {
  const res = new ODResponse()
  res.addHeader('X-Version', '1.0.0')
  res.content = HTML_EXAMPLE
  expect(res.code).toBe(200)
  expect(res.headers).toEqual([{ name: 'X-Version', value: '1.0.0' }])
  expect(res.content).toBe(HTML_EXAMPLE)
})

test('addHeader is chainable', () => {
  const res = new ODResponse()
  const returned = res.addHeader('X-A', '1').addHeader('X-B', '2')
  expect(returned).toBe(res)
  expect(res.headers).toHaveLength(2)
})

test('setHeader replaces existing header (case-insensitive)', () => {
  const res = new ODResponse()
  res.addHeader('Vary', 'Origin')
  res.addHeader('Vary', 'Accept')
  res.addHeader('X-Other', 'keep')
  res.setHeader('vary', 'Origin, Accept')
  expect(res.headers.filter(h => h.name === 'Vary' || h.name === 'vary')).toEqual([
    { name: 'vary', value: 'Origin, Accept' },
  ])
  expect(res.headers.find(h => h.name === 'X-Other')).toBeDefined()
})

test('setHeader with null removes header entirely', () => {
  const res = new ODResponse()
  res.addHeader('X-Remove', 'value')
  res.addHeader('X-Keep', 'value')
  res.setHeader('X-Remove', null)
  expect(res.headers).toEqual([{ name: 'X-Keep', value: 'value' }])
})

test('setHeader is chainable', () => {
  const res = new ODResponse()
  const returned = res.setHeader('X-A', 'val')
  expect(returned).toBe(res)
})

test('sent flag starts as false', () => {
  const res = new ODResponse()
  expect(res.sent).toBe(false)
})

test('markSent sets sent to true', () => {
  const res = new ODResponse()
  res.markSent()
  expect(res.sent).toBe(true)
})

test('set error', () => {
  const res = new ODResponse()
  res.content = HTML_EXAMPLE
  res.setError(422, 'Validation error', { parameters: { login: 'Incorrect login' } })
  expect(res.code).toBe(422)
  expect(res.content).toEqual({ error: 'Validation error', parameters: { login: 'Incorrect login' } })
})

test('setError is chainable', () => {
  const res = new ODResponse()
  const returned = res.setError(500, 'Fail')
  expect(returned).toBe(res)
})

test('setError with default data', () => {
  const res = new ODResponse()
  res.setError(404, 'Not found')
  expect(res.content).toEqual({ error: 'Not found' })
})

test('headers can be replaced via setter', () => {
  const res = new ODResponse()
  res.addHeader('X-Old', 'old')
  res.headers = [{ name: 'X-New', value: 'new' }]
  expect(res.headers).toEqual([{ name: 'X-New', value: 'new' }])
})

test('stream() sets content to the Readable', () => {
  const res = new ODResponse()
  const readable = Readable.from(['hello'])
  res.stream(readable, 'text/plain')
  expect(res.content).toBe(readable)
})

test('stream() sets Content-Type header', () => {
  const res = new ODResponse()
  res.stream(Readable.from(['x']), 'application/pdf')
  const ct = res.headers.find(h => h.name === 'Content-Type')
  expect(ct).toBeDefined()
  expect(ct!.value).toBe('application/pdf')
})

test('stream() replaces an existing Content-Type header', () => {
  const res = new ODResponse()
  res.addHeader('Content-Type', 'text/plain')
  res.stream(Readable.from(['x']), 'image/png')
  const ctHeaders = res.headers.filter(h => h.name.toLowerCase() === 'content-type')
  expect(ctHeaders).toHaveLength(1)
  expect(ctHeaders[0].value).toBe('image/png')
})

test('stream() is chainable', () => {
  const res = new ODResponse()
  const returned = res.stream(Readable.from(['x']), 'text/plain')
  expect(returned).toBe(res)
})

test('convert() throws when content is a Readable', async () => {
  const res = new ODResponse()
  res.stream(Readable.from(['x']), 'text/plain')
  await expect(res.convert()).rejects.toThrow('Readable streams cannot be converted')
})

test('convert() throws for unknown content type (number)', async () => {
  const res = new ODResponse()
  res.content = 42 as any
  await expect(res.convert()).rejects.toThrow('Unknown response content of type: "number"')
})

test('convert() throws for unknown content type (boolean)', async () => {
  const res = new ODResponse()
  res.content = true as any
  await expect(res.convert()).rejects.toThrow('Unknown response content of type: "boolean"')
})

test('setHeader with no value argument removes the header (default null)', () => {
  const res = new ODResponse()
  res.addHeader('X-Target', 'value')
  res.addHeader('X-Keep', 'value')
  res.setHeader('X-Target')  // no second arg -> default null -> just removes, no push
  expect(res.headers.find(h => h.name === 'X-Target')).toBeUndefined()
  expect(res.headers.find(h => h.name === 'X-Keep')).toBeDefined()
})

test('convert handles Blob with no type (Blob.type is "" - not null/undefined)', async () => {
  const res = new ODResponse()
  res.content = new Blob(['data'])  // no type -> Blob.type = '' -> '' ?? null = '' (falsy but not nullish)
  const [contentType, body] = await res.convert()
  expect(contentType).toBe('')
  expect(Buffer.isBuffer(body)).toBe(true)
})
