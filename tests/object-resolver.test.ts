import ODObjectResolverMiddleware, { ODObjectResolverFunction } from '../src/middlewares/object-resolver'
import ODContext from '../src/core/context'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'
import ODApp from '../src/core/app'
import ODRoute from '../src/core/route'

const dummyRoute: ODRoute = { controller: {} as any, action: 'doGet', method: 'GET', path: '/' }

function createContext(): ODContext {
  const app = new ODApp()
  const request = new ODRequest({ method: 'GET', url: '/' })
  const response = new ODResponse()
  return new ODContext(app, request, response, dummyRoute)
}

// --- Configuration validation ---

test('throws when "id" is used as a resolver key', () => {
  expect(() => {
    ODObjectResolverMiddleware(new Map([['id', async () => ({ result: { id: 1 } })]]))
  }).toThrow('"id" is the parameter name the router uses for default ID routes')
})

test('accepts empty map without throwing', () => {
  expect(() => ODObjectResolverMiddleware(new Map())).not.toThrow()
})

// --- Basic resolution ---

test('resolves object and stores it in context.state under the param name', async () => {
  const account = { id: 1, name: 'Acme' }
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async () => ({ result: account })],
  ]))
  const ctx = createContext()
  const result = await mw(ctx, { account_id: '1' })
  expect(result).toBeUndefined()
  expect(ctx.state.get('account_id')).toBe(account)
})

test('passes the param value as id argument to the resolver', async () => {
  let receivedId: unknown
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async (ctx, id) => { receivedId = id; return { result: { id } } }],
  ]))
  const ctx = createContext()
  await mw(ctx, { account_id: 42 })
  expect(receivedId).toBe(42)
})

// --- Not found (404) ---

test('returns 404 when resolver returns no result and no response', async () => {
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async () => ({})],
  ]))
  const ctx = createContext()
  const result = await mw(ctx, { account_id: '999' })
  expect(result).toBe(ctx.response)
  expect(ctx.response.code).toBe(404)
})

// --- Custom response ---

test('returns the custom response when resolver provides one', async () => {
  const customResponse = new ODResponse(403, { error: 'Forbidden' })
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async () => ({ response: customResponse })],
  ]))
  const ctx = createContext()
  const result = await mw(ctx, { account_id: '1' })
  expect(result).toBe(customResponse)
})

test('custom response short-circuits without touching context.state', async () => {
  const customResponse = new ODResponse(403, { error: 'Forbidden' })
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async () => ({ response: customResponse })],
  ]))
  const ctx = createContext()
  await mw(ctx, { account_id: '1' })
  expect(ctx.state.has('account_id')).toBe(false)
})

// --- Custom state key (param field) ---

test('stores result under custom key when param is provided', async () => {
  const account = { id: 1 }
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async () => ({ result: account, param: 'account' })],
  ]))
  const ctx = createContext()
  await mw(ctx, { account_id: '1' })
  expect(ctx.state.get('account')).toBe(account)
  expect(ctx.state.has('account_id')).toBe(false)
})

// --- Parameter absent ---

test('skips resolver when its parameter is not present in params', async () => {
  const resolver = jest.fn()
  const mw = ODObjectResolverMiddleware(new Map<string, ODObjectResolverFunction>([
    ['account_id', resolver],
  ]))
  const ctx = createContext()
  const result = await mw(ctx, { order_id: '5' })
  expect(result).toBeUndefined()
  expect(resolver).not.toHaveBeenCalled()
})

test('passes through when no params argument is provided', async () => {
  const resolver = jest.fn()
  const mw = ODObjectResolverMiddleware(new Map<string, ODObjectResolverFunction>([
    ['account_id', resolver],
  ]))
  const ctx = createContext()
  const result = await mw(ctx)
  expect(result).toBeUndefined()
  expect(resolver).not.toHaveBeenCalled()
})

test('skips resolver when key only exists on params prototype', async () => {
  const resolver = jest.fn()
  const mw = ODObjectResolverMiddleware(new Map<string, ODObjectResolverFunction>([
    ['toString', resolver],
  ]))
  const ctx = createContext()
  const result = await mw(ctx, {})
  expect(result).toBeUndefined()
  expect(resolver).not.toHaveBeenCalled()
})

test('passes through with empty map regardless of params', async () => {
  const mw = ODObjectResolverMiddleware(new Map())
  const ctx = createContext()
  const result = await mw(ctx, { account_id: '1' })
  expect(result).toBeUndefined()
})

// --- Ordering and chaining ---

test('resolvers run in Map insertion order', async () => {
  const callOrder: string[] = []
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async () => { callOrder.push('account'); return { result: { id: 1 } } }],
    ['order_id',   async () => { callOrder.push('order');   return { result: { id: 2 } } }],
  ]))
  const ctx = createContext()
  await mw(ctx, { account_id: '1', order_id: '5' })
  expect(callOrder).toEqual(['account', 'order'])
})

test('second resolver can access the first resolved object via context.state', async () => {
  const account = { id: 1, name: 'Acme' }
  let capturedAccount: unknown

  const mw = ODObjectResolverMiddleware(new Map<string, ODObjectResolverFunction>([
    ['account_id', async () => ({ result: account })],
    ['order_id',   async (ctx, id) => {
      capturedAccount = ctx.state.get('account_id')
      return { result: { id, accountId: (capturedAccount as any)?.id } }
    }],
  ]))
  const ctx = createContext()
  await mw(ctx, { account_id: '1', order_id: '5' })

  expect(capturedAccount).toBe(account)
  expect(ctx.state.get('order_id')).toEqual({ id: '5', accountId: 1 })
})

// --- Short-circuit on 404 ---

test('stops processing and returns 404 when first resolver returns no result', async () => {
  const orderResolver = jest.fn()
  const mw = ODObjectResolverMiddleware(new Map<string, ODObjectResolverFunction>([
    ['account_id', async () => ({})],
    ['order_id',   orderResolver],
  ]))
  const ctx = createContext()
  const result = await mw(ctx, { account_id: '1', order_id: '5' })
  expect(result).toBe(ctx.response)
  expect(ctx.response.code).toBe(404)
  expect(orderResolver).not.toHaveBeenCalled()
})

test('stops processing and returns custom response when first resolver provides one', async () => {
  const orderResolver = jest.fn()
  const customResponse = new ODResponse(403, { error: 'Forbidden' })
  const mw = ODObjectResolverMiddleware(new Map<string, ODObjectResolverFunction>([
    ['account_id', async () => ({ response: customResponse })],
    ['order_id',   orderResolver],
  ]))
  const ctx = createContext()
  const result = await mw(ctx, { account_id: '1', order_id: '5' })
  expect(result).toBe(customResponse)
  expect(orderResolver).not.toHaveBeenCalled()
})

// --- context.app is accessible ---

test('resolver receives context with app reference', async () => {
  let receivedApp: unknown
  const mw = ODObjectResolverMiddleware(new Map([
    ['account_id', async (ctx) => { receivedApp = ctx.app; return { result: { id: 1 } } }],
  ]))
  const ctx = createContext()
  await mw(ctx, { account_id: '1' })
  expect(receivedApp).toBe(ctx.app)
})
