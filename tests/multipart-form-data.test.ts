import MultipartFormDataParser, { parseMultipartFormData } from '../src/utils/multipart-form-data'

describe('extractBoundary', () => {
  test('extracts boundary from content-type details', () => {
    expect(MultipartFormDataParser.extractBoundary('boundary=----WebKitFormBoundary123')).toBe('----WebKitFormBoundary123')
  })

  test('extracts quoted boundary', () => {
    expect(MultipartFormDataParser.extractBoundary('boundary="----WebKitFormBoundary123"')).toBe('----WebKitFormBoundary123')
  })

  test('returns null when no boundary parameter', () => {
    expect(MultipartFormDataParser.extractBoundary('charset=utf-8')).toBeNull()
  })

  test('extracts boundary from multiple params', () => {
    expect(MultipartFormDataParser.extractBoundary('charset=utf-8; boundary=abc123')).toBe('abc123')
  })

  test('extracts boundary when whitespace surrounds the equals sign', () => {
    expect(MultipartFormDataParser.extractBoundary('charset=utf-8; boundary = "abc123"')).toBe('abc123')
  })

  test('handles empty string', () => {
    expect(MultipartFormDataParser.extractBoundary('')).toBeNull()
  })

  test('case-insensitive boundary key', () => {
    expect(MultipartFormDataParser.extractBoundary('Boundary=test123')).toBe('test123')
  })
})

describe('parse', () => {
  const parser = new MultipartFormDataParser()

  test('parses simple form fields with LF line endings', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field1"',
      '',
      'value1',
      '--boundary',
      'Content-Disposition: form-data; name="field2"',
      '',
      'value2',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(2)
    expect(parts[0].name).toBe('field1')
    expect(parts[0].value).toBe('value1')
    expect(parts[0].filename).toBeNull()
    expect(parts[0].contentType).toBeNull()
    expect(parts[1].name).toBe('field2')
    expect(parts[1].value).toBe('value2')
  })

  test('parses simple form fields with CRLF line endings', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field1"',
      '',
      'value1',
      '--boundary--',
    ].join('\r\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toBe('field1')
    expect(parts[0].value).toBe('value1')
  })

  test('parses file upload parts', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      'Content-Type: text/plain',
      '',
      'file content here',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toBe('file')
    expect(parts[0].filename).toBe('test.txt')
    expect(parts[0].contentType).toBe('text/plain')
    expect(Buffer.isBuffer(parts[0].value)).toBe(true)
    expect(parts[0].value.toString()).toBe('file content here')
  })

  test('accepts RFC parameter tokens in Content-Disposition', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name=file; filename=test.txt',
      'Content-Type: text/plain',
      '',
      'file content here',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toBe('file')
    expect(parts[0].filename).toBe('test.txt')
    expect(Buffer.isBuffer(parts[0].value)).toBe(true)
  })

  test('parses empty field value', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="empty"',
      '',
      '',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toBe('empty')
    expect(parts[0].value).toBe('')
  })

  test('handles boundary that already includes -- prefix', () => {
    const body = [
      '----boundary',
      'Content-Disposition: form-data; name="field"',
      '',
      'val',
      '----boundary--',
    ].join('\n')

    const parts = parser.parse(body, '--boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].value).toBe('val')
  })

  test('parses parts with extra headers', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="data"',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: 8bit',
      '',
      'hello',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].headers['content-type']).toBe('text/plain')
    expect(parts[0].headers['content-transfer-encoding']).toBe('8bit')
    expect(parts[0].value).toBe('hello')
  })

  test('skips parts without Content-Disposition', () => {
    const body = [
      '--boundary',
      'Content-Type: text/plain',
      '',
      'no disposition',
      '--boundary',
      'Content-Disposition: form-data; name="ok"',
      '',
      'has disposition',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toBe('ok')
  })

  test('skips parts whose disposition type is not form-data', () => {
    const body = [
      '--boundary',
      'Content-Disposition: attachment; name="file"; filename="test.txt"',
      'Content-Type: text/plain',
      '',
      'file content here',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(0)
  })

  test('handles multiline values', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="text"',
      '',
      'line one',
      'line two',
      'line three',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].value).toBe('line one\nline two\nline three')
  })

  test('parses folded header (continuation line starting with whitespace)', () => {
    // RFC 2822 folded header: a line starting with whitespace is a continuation of the previous header
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      ' more-info',  // folded continuation line
      '',
      'value',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    // The continuation should be appended to the previous header value
    expect(parts[0].headers['content-disposition']).toBe('form-data; name="field" more-info')
    expect(parts[0].value).toBe('value')
  })

  test('skips part when Content-Disposition has no name parameter (name === null)', () => {
    // Content-Disposition exists but has no name="..." -> _parseContentDisposition returns null -> continue
    const body = [
      '--boundary',
      'Content-Disposition: form-data; filename="file.txt"',
      'Content-Type: application/octet-stream',
      '',
      'binary data',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(0)
  })

  test('_parsePartHeaders ignores header line without a colon', () => {
    // 'not-a-valid-header' has no ':' -> colonIndex === -1 -> branch not taken, line skipped
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      'not-a-valid-header',
      '',
      'value',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].value).toBe('value')
    expect(parts[0].headers['not-a-valid-header']).toBeUndefined()
  })

  test('invalid header lines do not keep the previous header open for folded continuations', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      'not-a-valid-header',
      ' ; filename="test.txt"',
      '',
      'value',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].headers['content-disposition']).toBe('form-data; name="field"')
    expect(parts[0].filename).toBeNull()
    expect(parts[0].value).toBe('value')
  })

  test('throws when the closing delimiter is missing', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      '',
      'value',
    ].join('\n')

    expect(() => parser.parse(body, 'boundary')).toThrow('Multipart closing boundary delimiter not found')
  })

  test('throws when no boundary positions are found', () => {
    // Neither --boundary nor boundary appears in the body
    expect(() => parser.parse('no boundary content here', 'boundary')).toThrow('Multipart boundary delimiter not found')
  })

  test('throws when a part is missing the header/body separator', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      'value-without-blank-line',
      '--boundary--',
    ].join('\n')

    expect(() => parser.parse(body, 'boundary')).toThrow('Multipart part is missing header/body separator')
  })

  test('boundary mid-value (not at line start) is not treated as a delimiter', () => {
    // '--boundary' inside a value is preceded by a space, not \n -> not added to positions
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      '',
      'value with --boundary inside',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].value).toBe('value with --boundary inside')
  })

  test('close delimiter bytes inside a value do not truncate later parts', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field1"',
      '',
      'value with --boundary-- inside',
      '--boundary',
      'Content-Disposition: form-data; name="field2"',
      '',
      'value2',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(2)
    expect(parts[0].name).toBe('field1')
    expect(parts[0].value).toBe('value with --boundary-- inside')
    expect(parts[1].name).toBe('field2')
    expect(parts[1].value).toBe('value2')
  })

  test('boundary-like line prefixes with extra suffix are not treated as delimiters', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      '',
      'line one',
      '--boundaryXYZ',
      'line two',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toBe('field')
    expect(parts[0].value).toBe('line one\n--boundaryXYZ\nline two')
  })

  test('LF-delimited parts still parse when the value contains CRLF sequences', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      '',
      'line one\r\n\r\nline two',
      '--boundary--',
    ].join('\n')

    const parts = parser.parse(body, 'boundary')
    expect(parts).toHaveLength(1)
    expect(parts[0].name).toBe('field')
    expect(parts[0].value).toBe('line one\r\n\r\nline two')
  })

  test('file parts copy their payload instead of keeping a view of the full request buffer', () => {
    const body = Buffer.from([
      '--boundary',
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      'Content-Type: text/plain',
      '',
      'file content here',
      '--boundary--',
    ].join('\n'))

    const parts = parser.parse(body, 'boundary')
    const value = parts[0].value as Buffer
    const contentOffset = body.indexOf('file content here')
    body.write('mutated', contentOffset, 'utf-8')

    expect(Buffer.isBuffer(value)).toBe(true)
    expect(value.toString()).toBe('file content here')
  })

  test('decodes text parts using the declared charset', () => {
    const header = Buffer.from([
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      'Content-Type: text/plain; charset=latin1',
      '',
    ].join('\r\n') + '\r\n')
    const value = Buffer.from([0x63, 0x61, 0x66, 0xe9])
    const footer = Buffer.from('\r\n--boundary--')
    const body = Buffer.concat([header, value, footer])

    const parts = parser.parse(body, 'boundary')

    expect(parts[0].value).toBe('caf\u00e9')
  })

  test('throws when a text part declares an unsupported charset', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="field"',
      'Content-Type: text/plain; charset=unsupported-charset',
      '',
      'value',
      '--boundary--',
    ].join('\n')

    expect(() => parser.parse(body, 'boundary')).toThrow('Unsupported multipart text charset: unsupported-charset')
  })
})

describe('toObject', () => {
  const parser = new MultipartFormDataParser()

  test('converts parts to key-value object', () => {
    const parts = [
      { name: 'a', value: '1', filename: null, contentType: null, headers: {} },
      { name: 'b', value: '2', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({ a: '1', b: '2' })
  })

  test('groups duplicate field names into arrays', () => {
    const parts = [
      { name: 'items', value: 'x', filename: null, contentType: null, headers: {} },
      { name: 'items', value: 'y', filename: null, contentType: null, headers: {} },
      { name: 'items', value: 'z', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({ items: ['x', 'y', 'z'] })
  })

  test('flat field names only treat own properties as duplicates', () => {
    const parts = [
      { name: 'toString', value: 'safe', filename: null, contentType: null, headers: {} },
    ]

    expect(parser.toObject(parts)).toEqual({ toString: 'safe' })
  })

  test('file parts include filename, contentType, and data', () => {
    const parts = [
      { name: 'upload', value: 'binary data', filename: 'photo.jpg', contentType: 'image/jpeg', headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({
      upload: { filename: 'photo.jpg', contentType: 'image/jpeg', data: 'binary data' }
    })
  })

  test('bracket notation with named keys', () => {
    const parts = [
      { name: 'zz[q1]', value: 'ZZQ1', filename: null, contentType: null, headers: {} },
      { name: 'zz[q2]', value: 'ZZQ2', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({ zz: { q1: 'ZZQ1', q2: 'ZZQ2' } })
  })

  test('numeric bracket segments stay object keys', () => {
    const parts = [
      { name: 'items[0]', value: 'x', filename: null, contentType: null, headers: {} },
      { name: 'items[1]', value: 'y', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({ items: { 0: 'x', 1: 'y' } })
  })

  test('bracket notation with empty brackets creates array', () => {
    const parts = [
      { name: 'tags[]', value: 'a', filename: null, contentType: null, headers: {} },
      { name: 'tags[]', value: 'b', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({ tags: ['a', 'b'] })
  })

  test('bracket notation with quoted keys', () => {
    const parts = [
      { name: "data['key']", value: 'val', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({ data: { key: 'val' } })
  })

  test('mixed bracket and flat fields', () => {
    const parts = [
      { name: 'simple', value: 'hello', filename: null, contentType: null, headers: {} },
      { name: 'nested[a]', value: '1', filename: null, contentType: null, headers: {} },
      { name: 'nested[b]', value: '2', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({ simple: 'hello', nested: { a: '1', b: '2' } })
  })

  test('empty parts array returns empty object', () => {
    expect(parser.toObject([])).toEqual({})
  })

  test('dangerous part name is skipped', () => {
    // isDangerousKey(part.name) -> continue
    const parts = [
      { name: '__proto__', value: 'polluted', filename: null, contentType: null, headers: {} },
      { name: 'safe', value: 'ok', filename: null, contentType: null, headers: {} },
    ]
    const result = parser.toObject(parts)
    expect(Object.hasOwn(result, '__proto__')).toBe(false)
    expect(result['safe']).toBe('ok')
  })

  test('dangerous base key in bracket notation is skipped', () => {
    // isDangerousKey(match[1]) where match[1] = '__proto__' -> continue
    const parts = [
      { name: '__proto__[foo]', value: 'polluted', filename: null, contentType: null, headers: {} },
      { name: 'safe', value: 'ok', filename: null, contentType: null, headers: {} },
    ]
    const result = parser.toObject(parts)
    expect(Object.hasOwn(result, '__proto__')).toBe(false)
    expect(result['safe']).toBe('ok')
  })

  test('empty bracket on already-named-key object sets empty-string key (consistent with MagicQueryParser)', () => {
    // tags[x]=1 creates { tags: { x: '1' } }.
    // tags[]=2 then sets tags[''] = '2' - consistent with how parseQuery handles the same input.
    const parts = [
      { name: 'tags[x]', value: '1', filename: null, contentType: null, headers: {} },
      { name: 'tags[]', value: '2', filename: null, contentType: null, headers: {} },
    ]
    const result = parser.toObject(parts) as { tags: Record<string, unknown> }
    expect(result.tags['x']).toBe('1')
    expect(result.tags['']).toBe('2')
  })

  test('deeply nested brackets user[address][city] create nested object', () => {
    const parts = [
      { name: 'user[address][city]', value: 'London', filename: null, contentType: null, headers: {} },
      { name: 'user[address][zip]', value: 'SW1A', filename: null, contentType: null, headers: {} },
      { name: 'user[name]', value: 'Alice', filename: null, contentType: null, headers: {} },
    ]
    expect(parser.toObject(parts)).toEqual({
      user: { address: { city: 'London', zip: 'SW1A' }, name: 'Alice' },
    })
  })

  test('items[][name] creates an array of objects', () => {
    const parts = [
      { name: 'items[][name]', value: 'apple', filename: null, contentType: null, headers: {} },
      { name: 'items[][name]', value: 'banana', filename: null, contentType: null, headers: {} },
    ]
    const result = parser.toObject(parts) as { items: unknown[] }
    expect(Array.isArray(result.items)).toBe(true)
    expect(result.items[0]).toEqual({ name: 'apple' })
    expect(result.items[1]).toEqual({ name: 'banana' })
  })

  test('file uploads work with bracket notation', () => {
    const fileData = Buffer.from('binary')
    const parts = [
      {
        name: 'attachments[]',
        value: fileData,
        filename: 'doc.pdf',
        contentType: 'application/pdf',
        headers: {},
      },
    ]
    const result = parser.toObject(parts) as { attachments: unknown[] }
    expect(Array.isArray(result.attachments)).toBe(true)
    expect((result.attachments[0] as Record<string, unknown>).filename).toBe('doc.pdf')
    expect((result.attachments[0] as Record<string, unknown>).contentType).toBe('application/pdf')
  })

  test('malformed field names with unmatched opening brackets stay literal', () => {
    const parts = [
      { name: 'user[name', value: 'Alice', filename: null, contentType: null, headers: {} },
      { name: 'user', value: 'Bob', filename: null, contentType: null, headers: {} },
    ]

    expect(parser.toObject(parts)).toEqual({ 'user[name': 'Alice', user: 'Bob' })
  })
})

describe('parseMultipartFormData', () => {
  test('convenience function parses and converts to object', () => {
    const body = [
      '--boundary',
      'Content-Disposition: form-data; name="name"',
      '',
      'Alice',
      '--boundary',
      'Content-Disposition: form-data; name="age"',
      '',
      '30',
      '--boundary--',
    ].join('\n')

    expect(parseMultipartFormData(body, 'boundary')).toEqual({ name: 'Alice', age: '30' })
  })
})
