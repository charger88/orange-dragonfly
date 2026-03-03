import ODRequest, { normalizeIp } from '../src/core/request'
import ODRequestError from '../src/core/request-error'
import MagicQueryParser from '../src/utils/magic-query-parser'

test('basic request', () => {
  const body = { first_name: 'Donald', last_name: 'Joe' }
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'user-agent': 'Just a test' }, body: JSON.stringify(body) })
  expect(req.method).toBe('POST')
  expect(req.path).toBe('/')
  expect(req.query).toEqual({})
  expect(req.getHeader('user-agent')).toBe('Just a test')
  expect(req.body).toEqual(body)
})

test('path and no user agent', () => {
  const req = new ODRequest({ method: 'GET', url: '/framework/123/dragonfly/orange' })
  expect(req.method).toBe('GET')
  expect(req.path).toBe('/framework/123/dragonfly/orange')
  expect(req.query).toEqual({})
  expect(req.getHeader('user-agent', 'Other user agent')).toBe('Other user agent')
  expect(req.body).toEqual('')
})

test('host', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { Host: '127.0.0.1:8080' } })
  expect(req.method).toBe('GET')
  expect(req.host).toBe('127.0.0.1:8080')
  expect(req.hostname).toBe('127.0.0.1')
  expect(req.port).toBe(8080)
})

test('query', () => {
  const req = new ODRequest({ method: 'GET', url: '/framework/123/dragonfly/orange?a=1&b[]=2&b[\'three\']=3&b[]=4&c=string&null_property&empty_string=' })
  expect(req.path).toBe('/framework/123/dragonfly/orange')
  expect(req.query).toEqual({
    a: '1',
    b: { 0: '2', three: '3', 2: '4' },
    c: 'string',
    null_property: null,
    empty_string: ''
  })
  expect(req.getQueryParam('b')).toEqual({ 0: '2', three: '3', 2: '4' })
  expect(req.getQueryParam('c')).toBe('string')
})

test('query - parameter as array', () => {
  const req = new ODRequest({ method: 'GET', url: '/framework/123/dragonfly/orange?arr[]=2&arr[]=3&arr[]=4' })
  expect(req.path).toBe('/framework/123/dragonfly/orange')
  expect(req.query).toEqual({
    arr: ['2', '3', '4']
  })
  expect(req.getQueryParam('arr')).toEqual(['2', '3', '4'])
})

test('query parsing surfaces sanitizer failures as request errors', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic['self'] = cyclic
  const queryParser = {
    parse: () => cyclic,
  } as unknown as MagicQueryParser
  const req = new ODRequest({ method: 'GET', url: '/path?a=1' }, { queryParser })

  let thrown: unknown
  try {
    void req.query
  } catch (e) {
    thrown = e
  }

  expect(thrown).toBeInstanceOf(ODRequestError)
  expect((thrown as ODRequestError).statusCode).toBe(400)
  expect((thrown as Error).message).toBe('Invalid query string')
})

test('querySearchParams - returns URLSearchParams', () => {
  const req = new ODRequest({ method: 'GET', url: '/path?a=1&b=hello&c=3' })
  const params = req.querySearchParams
  expect(params).toBeInstanceOf(URLSearchParams)
  expect(params.get('a')).toBe('1')
  expect(params.get('b')).toBe('hello')
  expect(params.get('c')).toBe('3')
})

test('querySearchParams - no query string', () => {
  const req = new ODRequest({ method: 'GET', url: '/path' })
  const params = req.querySearchParams
  expect(params.toString()).toBe('')
})

test('querySearchParams - multiple values for same key', () => {
  const req = new ODRequest({ method: 'GET', url: '/path?x=1&x=2&x=3' })
  const params = req.querySearchParams
  expect(params.getAll('x')).toEqual(['1', '2', '3'])
})

test('querySearchParams - is cached', () => {
  const req = new ODRequest({ method: 'GET', url: '/path?a=1' })
  expect(req.querySearchParams).toBe(req.querySearchParams)
})

test('content type', () => {
  const regular = new ODRequest({ method: 'GET', url: '/', headers: { 'content-type': 'application/json' } })
  expect(regular.contentType).toBe('application/json')
  expect(regular.contentTypeDetails).toBe('')
  const withCharset = new ODRequest({ method: 'GET', url: '/', headers: { 'content-type': 'text/html; charset=utf-8' } })
  expect(withCharset.contentType).toBe('text/html')
  expect(withCharset.contentTypeDetails).toBe('charset=utf-8')
})

test('expected response content type', () => {
  const noAccept = new ODRequest({ method: 'GET', url: '/' })
  expect(noAccept.expectedResponseContentType).toBe(null)
  const contentTypeNoAccept = new ODRequest({ method: 'GET', url: '/', headers: { 'content-type': 'application/json' } })
  expect(contentTypeNoAccept.expectedResponseContentType).toBe('application/json')
  const contentType = new ODRequest({ method: 'GET', url: '/', headers: { 'content-type': 'application/json', accept: 'text/html' } })
  expect(contentType.expectedResponseContentType).toBe('text/html')
})

test('expectedResponseContentType respects q-values (RFC 7231)', () => {
  // JSON has higher q=1.0; html has q=0.9 - should prefer JSON
  const req = new ODRequest({ method: 'GET', url: '/', headers: { accept: 'text/html;q=0.9, application/json;q=1.0' } })
  expect(req.expectedResponseContentType).toBe('application/json')
})

test('expectedResponseContentType prefers highest-q non-wildcard type', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { accept: 'text/xml;q=0.5, text/plain;q=0.8, application/json' } })
  expect(req.expectedResponseContentType).toBe('application/json')
})

test('expectedResponseContentType returns null when only wildcards remain after q filtering', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { accept: '*/*;q=0.9, text/*;q=0.8' } })
  expect(req.expectedResponseContentType).toBeNull()
})

test('expectedResponseContentType ignores explicitly rejected media types (q=0)', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { accept: 'text/html;q=0, application/json;q=0.5' } })
  expect(req.expectedResponseContentType).toBe('application/json')
})

test('multipart form data', () => {
  const requestData = `------WebKitFormBoundaryb1SSVmgvUwx2BwAo
Content-Disposition: form-data; name="sa"

------WebKitFormBoundaryb1SSVmgvUwx2BwAo
Content-Disposition: form-data; name="ta"
content-type: text/plain;charset=windows-1251
content-transfer-encoding: 8BIT

Some value
------WebKitFormBoundaryb1SSVmgvUwx2BwAo
Content-Disposition: form-data; name="zz[q1]"

ZZQ1
------WebKitFormBoundaryb1SSVmgvUwx2BwAo
Content-Disposition: form-data; name="zz[q2]"

ZZQ2
------WebKitFormBoundaryb1SSVmgvUwx2BwAo--`
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryb1SSVmgvUwx2BwAo' }, body: requestData })
  expect(req.method).toBe('POST')
  expect(req.path).toBe('/')
  expect(req.query).toEqual({})
  expect(req.contentType).toBe('multipart/form-data')
  expect(req.contentTypeDetails).toBe('boundary=----WebKitFormBoundaryb1SSVmgvUwx2BwAo')
  expect(req.body).toEqual({
    sa: '',
    ta: 'Some value',
    zz: {
      q1: 'ZZQ1',
      q2: 'ZZQ2'
    }
  })
})

test('Buffer body is accepted', () => {
  const body = JSON.stringify({ key: 'value' })
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, body: Buffer.from(body) })
  expect(req.body).toEqual({ key: 'value' })
})

test('rawBody returns Buffer', () => {
  const req = new ODRequest({ method: 'POST', url: '/', body: 'hello' })
  expect(Buffer.isBuffer(req.rawBody)).toBe(true)
  expect(req.rawBody.toString()).toBe('hello')
})

test('rawBody returns Buffer when constructed with Buffer', () => {
  const buf = Buffer.from('binary')
  const req = new ODRequest({ method: 'POST', url: '/', body: buf })
  expect(req.rawBody).toEqual(buf)
})

test('body setter resets parsed body', () => {
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 1 }) })
  expect(req.body).toEqual({ a: 1 })
  req.body = JSON.stringify({ b: 2 })
  expect(req.body).toEqual({ b: 2 })
})

test('contentType trims whitespace', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { 'content-type': ' application/json ; charset=utf-8' } })
  expect(req.contentType).toBe('application/json')
})

test('method is uppercased', () => {
  const req = new ODRequest({ method: 'get', url: '/' })
  expect(req.method).toBe('GET')
})

test('headers are lowercased', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { 'X-Custom-Header': 'value' } })
  expect(req.getHeader('x-custom-header')).toBe('value')
})

test('default ip is 0.0.0.0', () => {
  const req = new ODRequest({ method: 'GET', url: '/' })
  expect(req.ip).toBe('0.0.0.0')
})

test('request id is generated by default', () => {
  const req = new ODRequest({ method: 'GET', url: '/' })
  expect(typeof req.id).toBe('string')
  expect(req.id).toMatch(/^[0-9a-f-]{36}$/i)
})

test('request id can be provided', () => {
  const req = new ODRequest({ method: 'GET', url: '/', id: 'custom-id' })
  expect(req.id).toBe('custom-id')
})

test('custom ip', () => {
  const req = new ODRequest({ method: 'GET', url: '/', ip: '192.168.1.1' })
  expect(req.ip).toBe('192.168.1.1')
})

test('port returns null when no port specified', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { Host: 'example.com' } })
  expect(req.port).toBeNull()
})

test('url-encoded body parsing', () => {
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=John&age=30' })
  expect(req.body).toEqual({ name: 'John', age: '30' })
})

test('url-encoded parsing uses configured query parser', () => {
  const req = new ODRequest(
    { method: 'POST', url: '/', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'age=30&active=true' },
    { queryParser: new MagicQueryParser({ integerParameters: ['age'], booleanParameters: ['active'] }) },
  )
  expect(req.body).toEqual({ age: 30, active: true })
})

test('application/*+json content types are parsed as JSON', () => {
  const req = new ODRequest({
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify({ title: 'Bad Request' }),
  })
  expect(req.body).toEqual({ title: 'Bad Request' })
})

test('invalid application/*+json body throws ODRequestError', () => {
  const req = new ODRequest({
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/problem+json' },
    body: 'not json',
  })
  expect(() => req.body).toThrow(ODRequestError)
})

test('invalid json body falls back to string', () => {
  const req = new ODRequest({ method: 'POST', url: '/', body: 'not json' })
  expect(req.body).toBe('not json')
})

test('plain body without content-type parses JSON primitives', () => {
  const zero = new ODRequest({ method: 'POST', url: '/', body: '0' })
  const bool = new ODRequest({ method: 'POST', url: '/', body: 'false' })
  const empty = new ODRequest({ method: 'POST', url: '/', body: '""' })
  expect(zero.body).toBe(0)
  expect(bool.body).toBe(false)
  expect(empty.body).toBe('')
})

test('invalid json with application/json content type throws ODRequestError', () => {
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, body: 'not json' })
  expect(() => req.body).toThrow(ODRequestError)
})

test('invalid json with application/json throws with status 400', () => {
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, body: 'not json' })
  try {
    req.body
    fail('Expected ODRequestError')
  } catch (e) {
    expect(e).toBeInstanceOf(ODRequestError)
    expect((e as ODRequestError).statusCode).toBe(400)
  }
})

test('url getter returns the raw URL string', () => {
  const req = new ODRequest({ method: 'GET', url: '/path?q=1&r=2' })
  expect(req.url).toBe('/path?q=1&r=2')
})

test('getQueryParam returns null for a present valueless parameter', () => {
  const req = new ODRequest({ method: 'GET', url: '/path?flag' })
  expect(req.getQueryParam('flag', 'fallback')).toBeNull()
  expect(req.getQueryParam('missing', 'fallback')).toBe('fallback')
})

test('expectedResponseContentType returns null for wildcard accept */*', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { accept: '*/*' } })
  expect(req.expectedResponseContentType).toBeNull()
})

test('expectedResponseContentType returns null for partial wildcard accept', () => {
  const req = new ODRequest({ method: 'GET', url: '/', headers: { accept: 'text/*' } })
  expect(req.expectedResponseContentType).toBeNull()
})

test('multipart body without boundary throws ODRequestError', () => {
  const req = new ODRequest({
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'multipart/form-data' },
    body: '--boundary\r\nContent-Disposition: form-data; name="x"\r\n\r\nval\r\n--boundary--',
  })
  expect(() => req.body).toThrow(ODRequestError)
})

test('body setter accepts a string and converts it to Buffer', () => {
  const req = new ODRequest({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
  expect(req.body).toEqual({ a: 1 })
  req.body = '{"b":2}'  // string assignment -> typeof rawBody === 'string' branch
  expect(req.body).toEqual({ b: 2 })
})

test('body with no content-type that parses to null falls back to null', () => {
  const req = new ODRequest({ method: 'POST', url: '/', body: 'null' })
  expect(req.body).toBe(null)
})

test('unknown content-type returns raw body string', () => {
  const req = new ODRequest({
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'text/xml' },
    body: '<root/>',
  })
  expect(req.body).toBe('<root/>')
})

describe('normalizeIp', () => {
  test('strips IPv4-mapped IPv6 prefix (::ffff:)', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('::FFFF:192.168.1.1')).toBe('192.168.1.1')
  })

  test('returns plain IPv4 unchanged', () => {
    expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1')
  })

  test('returns plain IPv6 unchanged', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1')
  })

  test('does not strip ::ffff: if followed by non-IPv4 content', () => {
    expect(normalizeIp('::ffff:not-an-ip')).toBe('::ffff:not-an-ip')
  })
})

describe('trustedProxy option', () => {
  test('resolves client IP from X-Forwarded-For when connecting IP is trusted', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('1.2.3.4')
  })

  test('ignores X-Forwarded-For when connecting IP is not in trusted list', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '9.9.9.9', headers: { 'x-forwarded-for': '1.2.3.4' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('9.9.9.9')
  })

  test('ignores X-Forwarded-For when trustedProxy is empty', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4' } },
      { trustedProxy: [] },
    )
    expect(req.ip).toBe('10.0.0.1')
  })

  test('rejects an invalid IP from X-Forwarded-For (e.g. injected hostname)', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': 'evil.example.com' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('10.0.0.1')
  })

  test('rejects an octect out of range (e.g. 999.0.0.1) from X-Forwarded-For', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': '999.0.0.1' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('10.0.0.1')
  })

  test('normalizes IPv4-mapped IPv6 from X-Forwarded-For', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': '::ffff:5.6.7.8' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('5.6.7.8')
  })

  test('normalizes the connecting IP from IPv4-mapped IPv6 before proxy check', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '::ffff:10.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('1.2.3.4')
  })

  test('accepts a valid IPv6 address from X-Forwarded-For', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': '2001:db8::1, 10.0.0.1' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('2001:db8::1')
  })

  test('rejects malformed IPv6 values from X-Forwarded-For', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': '::::, 10.0.0.1' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('10.0.0.1')
  })

  test('uses rightmost untrusted IP, not leftmost (spoof prevention)', () => {
    // Attacker sends X-Forwarded-For: 127.0.0.1, 1.2.3.4 behind trusted proxy 10.0.0.1
    // The leftmost 127.0.0.1 is attacker-controlled; 1.2.3.4 is the real client.
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.1', headers: { 'x-forwarded-for': '127.0.0.1, 1.2.3.4, 10.0.0.1' } },
      { trustedProxy: ['10.0.0.1'] },
    )
    expect(req.ip).toBe('1.2.3.4')
  })

  test('multiple trusted proxies in XFF chain are all skipped', () => {
    const req = new ODRequest(
      { method: 'GET', url: '/', ip: '10.0.0.2', headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1, 10.0.0.2' } },
      { trustedProxy: ['10.0.0.1', '10.0.0.2'] },
    )
    expect(req.ip).toBe('5.6.7.8')
  })
})

describe('protocol field', () => {
  test('defaults to http', () => {
    const req = new ODRequest({ method: 'GET', url: '/' })
    expect(req.protocol).toBe('http')
  })

  test('accepts https', () => {
    const req = new ODRequest({ method: 'GET', url: '/', protocol: 'https' })
    expect(req.protocol).toBe('https')
  })

  test('https protocol is reflected in the parsed URL', () => {
    const req = new ODRequest({ method: 'GET', url: '/path', headers: { host: 'example.com' }, protocol: 'https' })
    expect(req.protocol).toBe('https')
    // path/host still extracted correctly
    expect(req.path).toBe('/path')
    expect(req.hostname).toBe('example.com')
  })
})
