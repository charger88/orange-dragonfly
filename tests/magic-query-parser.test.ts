import MagicQueryParser, { applyKeyValueToObject, parseQuery } from '../src/utils/magic-query-parser'

describe('parseQuery', () => {
  test('empty string returns empty object', () => {
    expect(parseQuery('')).toEqual({})
  })

  test('query string with leading ?', () => {
    expect(parseQuery('?a=1')).toEqual({ a: '1' })
  })

  test('only ? returns empty object', () => {
    expect(parseQuery('?')).toEqual({})
  })

  test('simple key=value pairs', () => {
    expect(parseQuery('a=1&b=2&c=3')).toEqual({ a: '1', b: '2', c: '3' })
  })

  test('string values are preserved', () => {
    expect(parseQuery('name=hello&city=world')).toEqual({ name: 'hello', city: 'world' })
  })

  test('numeric values stay as strings by default', () => {
    expect(parseQuery('x=42&y=0')).toEqual({ x: '42', y: '0' })
  })

  test('key without = produces null', () => {
    expect(parseQuery('flag')).toEqual({ flag: null })
  })

  test('key with empty value produces empty string', () => {
    expect(parseQuery('key=')).toEqual({ key: '' })
  })

  test('mixed null, empty and valued params', () => {
    expect(parseQuery('a=1&b&c=')).toEqual({ a: '1', b: null, c: '' })
  })

  test('URL-encoded values are decoded', () => {
    expect(parseQuery('msg=hello%20world')).toEqual({ msg: 'hello world' })
  })

  test('plus signs are decoded as spaces', () => {
    expect(parseQuery('msg=hello+world')).toEqual({ msg: 'hello world' })
  })

  test('array notation with []', () => {
    expect(parseQuery('arr[]=1&arr[]=2&arr[]=3')).toEqual({ arr: ['1', '2', '3'] })
  })

  test('object notation with named keys', () => {
    expect(parseQuery('obj[x]=10&obj[y]=20')).toEqual({ obj: { x: '10', y: '20' } })
  })

  test('quoted keys in brackets', () => {
    expect(parseQuery("b['three']=3")).toEqual({ b: { three: '3' } })
    expect(parseQuery('b["three"]=3')).toEqual({ b: { three: '3' } })
  })

  test('mixed array and named keys escalates to object', () => {
    expect(parseQuery("b[]=2&b['three']=3&b[]=4")).toEqual({
      b: { 0: '2', three: '3', 2: '4' }
    })
  })

  test('empty parts are skipped', () => {
    expect(parseQuery('a=1&&b=2')).toEqual({ a: '1', b: '2' })
  })

  test('URL-encoded key', () => {
    expect(parseQuery('hello%20world=1')).toEqual({ 'hello world': '1' })
  })

  test('invalid percent encoding is returned as-is', () => {
    expect(parseQuery('bad=%ZZ')).toEqual({ bad: '%ZZ' })
  })
})

describe('integerParameters', () => {
  const parser = new MagicQueryParser({ integerParameters: ['id', 'limit'] })

  test('coerces listed params to integer', () => {
    expect(parser.parse('id=42&name=Alice')).toEqual({ id: 42, name: 'Alice' })
  })

  test('non-numeric value stays as string', () => {
    expect(parser.parse('id=abc')).toEqual({ id: 'abc' })
  })

  test('coerces in array notation: id[]=1', () => {
    expect(parser.parse('id[]=1&id[]=2')).toEqual({ id: [1, 2] })
  })

  test('coerces in nested object: boo[id]=1', () => {
    expect(parser.parse('boo[id]=1')).toEqual({ boo: { id: 1 } })
  })

  test('does not coerce when listed param is a parent: id[boo]=1', () => {
    expect(parser.parse('id[boo]=1')).toEqual({ id: { boo: '1' } })
  })

  test('multiple number params', () => {
    expect(parser.parse('id=5&limit=10&offset=20')).toEqual({ id: 5, limit: 10, offset: '20' })
  })

  test('unlisted params stay as strings', () => {
    expect(parser.parse('page=3')).toEqual({ page: '3' })
  })

  test('coerces negative integers', () => {
    expect(parser.parse('id=-5&limit=-20')).toEqual({ id: -5, limit: -20 })
  })

  test('negative value with non-integer suffix stays as string', () => {
    expect(parser.parse('id=-abc')).toEqual({ id: '-abc' })
  })
})

describe('booleanParameters', () => {
  const parser = new MagicQueryParser({ booleanParameters: ['active', 'admin'] })

  test('coerces true values', () => {
    expect(parser.parse('active=1')).toEqual({ active: true })
    expect(parser.parse('active=true')).toEqual({ active: true })
    expect(parser.parse('active=TRUE')).toEqual({ active: true })
    expect(parser.parse('active=True')).toEqual({ active: true })
  })

  test('coerces false values', () => {
    expect(parser.parse('active=0')).toEqual({ active: false })
    expect(parser.parse('active=false')).toEqual({ active: false })
    expect(parser.parse('active=no')).toEqual({ active: false })
    expect(parser.parse('active=')).toEqual({ active: false })
  })

  test('coerces in array notation: active[]=1', () => {
    expect(parser.parse('active[]=1&active[]=0')).toEqual({ active: [true, false] })
  })

  test('coerces in nested object: foo[active]=true', () => {
    expect(parser.parse('foo[active]=true')).toEqual({ foo: { active: true } })
  })

  test('does not coerce when listed param is a parent: active[foo]=1', () => {
    expect(parser.parse('active[foo]=1')).toEqual({ active: { foo: '1' } })
  })

  test('unlisted params stay as strings', () => {
    expect(parser.parse('enabled=true')).toEqual({ enabled: 'true' })
  })
})

describe('custom trueValues', () => {
  const parser = new MagicQueryParser({
    booleanParameters: ['flag'],
    trueValues: ['yes', 'on'],
  })

  test('custom true values are respected', () => {
    expect(parser.parse('flag=yes')).toEqual({ flag: true })
    expect(parser.parse('flag=on')).toEqual({ flag: true })
  })

  test('default true values no longer apply', () => {
    expect(parser.parse('flag=1')).toEqual({ flag: false })
    expect(parser.parse('flag=true')).toEqual({ flag: false })
  })
})

describe('combined number and boolean parameters', () => {
  const parser = new MagicQueryParser({
    integerParameters: ['id'],
    booleanParameters: ['active'],
  })

  test('each param type coerced independently', () => {
    expect(parser.parse('id=5&active=1&name=Alice')).toEqual({
      id: 5,
      active: true,
      name: 'Alice',
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases for uncovered _setPath / _resolveCoercionKey paths
// ---------------------------------------------------------------------------

describe('numeric bracket segments use object keys', () => {
  test('a[0]=x stores value under object key "0"', () => {
    expect(parseQuery('a[0]=x')).toEqual({ a: { 0: 'x' } })
  })

  test('a[0]=x&a[1]=y builds an object with numeric-looking keys', () => {
    expect(parseQuery('a[0]=x&a[1]=y')).toEqual({ a: { 0: 'x', 1: 'y' } })
  })

  test('numeric child keys still inherit coercion from the owning field name', () => {
    const parser = new MagicQueryParser({ integerParameters: ['n'] })
    expect(parser.parse('n[0]=5&n[1]=6')).toEqual({ n: { 0: 5, 1: 6 } })
  })

  test('literal numeric child keys can still be coerced directly', () => {
    const parser = new MagicQueryParser({ integerParameters: ['0'] })
    expect(parser.parse('n[0]=5')).toEqual({ n: { 0: 5 } })
  })
})

describe('nested array paths (array-in-array)', () => {
  test('a[][0]=x appends an object whose key is "0"', () => {
    // path ['a','','0']: k='' is intermediate on array -> push child object, then set key "0"
    expect(parseQuery('a[][0]=x')).toEqual({ a: [{ 0: 'x' }] })
  })

  test('a[0][0]=x builds nested objects with numeric-looking keys', () => {
    // path ['a','0','0']: both numeric segments are treated as object keys
    expect(parseQuery('a[0][0]=x')).toEqual({ a: { 0: { 0: 'x' } } })
  })

  test('a[0][1]=x&a[0][0]=y fills both numeric-looking object keys', () => {
    const result = parseQuery('a[0][1]=x&a[0][0]=y') as { a: Record<string, Record<string, string>> }
    expect(result.a[0][0]).toBe('y')
    expect(result.a[0][1]).toBe('x')
  })
})

describe('root-level empty-bracket path (k="" intermediate on object)', () => {
  test('[][0]=x uses empty string as the root key and "0" as an object property', () => {
    // path ['','0']: k='' intermediate on the root object -> creates cur[''] = {}
    const result = parseQuery('[][0]=x') as Record<string, Record<string, unknown>>
    expect(result['']).toBeDefined()
    expect(result[''][0]).toBe('x')
  })

  test('[][]=x&[][]=y appends to the array under the empty-string key', () => {
    const result = parseQuery('[][]=x&[][]=y') as Record<string, unknown[]>
    expect(result['']).toEqual(['x', 'y'])
  })
})

describe('array-to-object escalation when parent is an array', () => {
  test('escalates nested array to object when a named key is introduced', () => {
    // a[0][]=x -> a = { 0: ['x'] }
    // a[0][name]=y -> a[0] escalates from ['x'] to {0:'x', name:'y'}
    const result = parseQuery('a[0][]=x&a[0][name]=y') as { a: Record<string, Record<string, unknown>> }
    expect(result.a[0]['name']).toBe('y')
    expect(result.a[0][0]).toBe('x')
  })
})

describe('push to escalated (fromArray) object', () => {
  test('[] after escalation appends using the next available numeric key', () => {
    // a[]=x -> a=['x'], a[name]=y -> a escalates to {0:'x',name:'y'}, a[]=z -> a['2']='z'
    const result = parseQuery('a[]=x&a[name]=y&a[]=z') as Record<string, Record<string, unknown>>
    const a = result['a']
    expect(Array.isArray(a)).toBe(false)
    expect(a['name']).toBe('y')
    expect(a[0]).toBe('x')
    expect(a[2]).toBe('z')
  })

  test('[] on a plain object still writes the empty-string key', () => {
    const result = parseQuery('a[2]=x&a[name]=y&a[]=z') as Record<string, Record<string, unknown>>
    const a = result['a']
    expect(Array.isArray(a)).toBe(false)
    expect(a[2]).toBe('x')
    expect(a['name']).toBe('y')
    expect(a['']).toBe('z')
  })

  test('user data can safely use "__qs_fromArray" as a field name', () => {
    expect(parseQuery('a[]=x&a[name]=y&a[__qs_fromArray]=z')).toEqual({
      a: { 0: 'x', name: 'y', __qs_fromArray: 'z' }
    })
  })
})

describe('object intermediate creation', () => {
  test('a[x][0]=1 creates {a:{x:{0:"1"}}}', () => {
    // path ['a','x','0']: at 'x' intermediate on obj, next token "0" is a named key
    expect(parseQuery('a[x][0]=1')).toEqual({ a: { x: { 0: '1' } } })
  })

  test('a[x][]=1&a[x][]=2 collects into nested array', () => {
    expect(parseQuery('a[x][]=1&a[x][]=2')).toEqual({ a: { x: ['1', '2'] } })
  })
})

describe('_resolveCoercionKey returns empty string for all-empty path', () => {
  test('coercion key is "" when all path segments are empty', () => {
    // [][] has path ['',''] - resolveCoercionKey iterates backwards, both '' -> returns ''
    // With integerParameters: [''], value '5' -> coerced to 5
    const parser = new MagicQueryParser({ integerParameters: [''] })
    const result = parser.parse('[][]=5') as Record<string, unknown[]>
    expect(result['']).toEqual([5])
  })
})

describe('[] appended to plain-object (line 113 in _setPath)', () => {
  test('x[a]=1&x[]=z sets empty-string key on the plain object at x', () => {
    // path for x[] is ['x','']. cur at last step = {a:'1'} (plain object, not an escalated array-object)
    // so cur[''] = 'z'  triggers line 113
    const result = parseQuery('x[a]=1&x[]=z') as Record<string, Record<string, unknown>>
    expect(result['x']['a']).toBe('1')
    expect(result['x']['']).toBe('z')
  })
})

describe('_safeDecode and _coerce with null (private access)', () => {
  test('_safeDecode(null) returns empty string', () => {
    const parser = new MagicQueryParser()
    expect((parser as any)._safeDecode(null)).toBe('')
  })

  test('_coerce(null, key) returns null', () => {
    const parser = new MagicQueryParser({ booleanParameters: ['active'] })
    expect((parser as any)._coerce(null, 'active')).toBeNull()
  })
})

describe('empty key covers _keyToPath returning [key]', () => {
  test('=value has empty-string key, stored under ""', () => {
    // rawKey = '' -> _keyToPath('') -> regex matches nothing -> out=[] -> return ['']
    const result = parseQuery('=value') as Record<string, unknown>
    expect(result['']).toBe('value')
  })
})

describe('dangerous keys are silently ignored', () => {
  test('__proto__ key is not set on result', () => {
    const result = parseQuery('__proto__=polluted')
    // result['__proto__'] always returns Object.prototype in JS, so check via Object.hasOwn
    expect(Object.hasOwn(result, '__proto__')).toBe(false)
  })

  test('nested dangerous key is skipped before parent allocation', () => {
    const result = parseQuery('a[__proto__]=x') as Record<string, Record<string, unknown>>
    expect(Object.hasOwn(result, 'a')).toBe(false)
  })

  test('dangerous nested key does not clobber an existing scalar', () => {
    expect(parseQuery('a=1&a[__proto__]=x')).toEqual({ a: '1' })
  })

  test('dangerous base key is skipped before constructor allocation', () => {
    const result = parseQuery('constructor[x]=1')
    expect(Object.hasOwn(result, 'constructor')).toBe(false)
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe('applyKeyValueToObject only traverses parser-owned containers', () => {
  test('skips dangerous paths before allocating a base container', () => {
    const result: Record<string, unknown> = {}
    applyKeyValueToObject(result, 'constructor[x]', 'unsafe')
    expect(Object.hasOwn(result, 'constructor')).toBe(false)
    expect(Object.keys(result)).toHaveLength(0)
  })

  test('reuses parser-created containers across repeated calls', () => {
    const result: Record<string, unknown> = {}
    applyKeyValueToObject(result, 'user[name]', 'Alice')
    applyKeyValueToObject(result, 'user[age]', 30)
    expect(result).toEqual({ user: { name: 'Alice', age: 30 } })
  })

  test('accepts previously parsed objects when reused as nested containers', () => {
    const child = parseQuery('profile[name]=Alice')
    const result: Record<string, unknown> = { child }

    applyKeyValueToObject(result, 'child[profile][age]', 30)

    expect(result).toEqual({ child: { profile: { name: 'Alice', age: 30 } } })
  })

  test('replaces arbitrary existing objects instead of traversing them', () => {
    const result: Record<string, unknown> = {
      upload: { filename: 'photo.jpg', contentType: 'image/jpeg', data: 'binary data' },
    }

    applyKeyValueToObject(result, 'upload[filename]', 'override.jpg')

    expect(result).toEqual({ upload: { filename: 'override.jpg' } })
  })
})

describe('array/object intermediate creation - {} branch', () => {
  test('a[][][foo]=x: inner [] with named next creates {} child in array', () => {
    // At the 2nd '' intermediate: cur=array, next='foo' (not index) -> child={}
    const result = parseQuery('a[][][foo]=x') as { a: Array<Array<Record<string, unknown>>> }
    expect(result.a[0][0].foo).toBe('x')
  })

  test('a[0][foo]=x: numeric-looking key creates a nested object slot', () => {
    // At '0' intermediate: cur={a-object}, next='foo' -> cur['0']={}
    const result = parseQuery('a[0][foo]=x') as { a: Record<string, Record<string, unknown>> }
    expect(result.a[0].foo).toBe('x')
  })

  test('a[b][c]=x: 3-level named path creates intermediate {} at b', () => {
    // At k='b': cur={a-object}, next='c' (named) -> cur['b']={}
    const result = parseQuery('a[b][c]=x') as { a: { b: { c: string } } }
    expect(result.a.b.c).toBe('x')
  })

  test('[][foo]=x: empty-key intermediate on root object with named next -> cur[""]= {}', () => {
    // path ['','foo']: k='' intermediate on root obj, next='foo' -> cur['']={}
    const result = parseQuery('[][foo]=x') as Record<string, Record<string, unknown>>
    expect(result[''].foo).toBe('x')
  })
})
