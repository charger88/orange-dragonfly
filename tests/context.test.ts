import ODContext from '../src/core/context'
import ODApp from '../src/core/app'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'

function makeContext() {
  const app = new ODApp()
  const request = new ODRequest({ method: 'GET', url: '/' })
  const response = new ODResponse()
  const route = { controller: Object, action: 'test', path: '/', method: 'GET' }
  return new ODContext(app, request, response, route as any)
}

describe('ODContext', () => {
  test('state is a Map', () => {
    const ctx = makeContext()
    expect(ctx.state).toBeInstanceOf(Map)
  })

  test('state supports set/get/has/delete', () => {
    const ctx = makeContext()
    ctx.state.set('user', { id: 1 })
    expect(ctx.state.get('user')).toEqual({ id: 1 })
    expect(ctx.state.has('user')).toBe(true)
    ctx.state.delete('user')
    expect(ctx.state.has('user')).toBe(false)
  })

  test('state is isolated per context instance', () => {
    const ctx1 = makeContext()
    const ctx2 = makeContext()
    ctx1.state.set('key', 'value1')
    ctx2.state.set('key', 'value2')
    expect(ctx1.state.get('key')).toBe('value1')
    expect(ctx2.state.get('key')).toBe('value2')
  })

  test('state starts empty', () => {
    const ctx = makeContext()
    expect(ctx.state.size).toBe(0)
  })
})
