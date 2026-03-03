import ODApp from '../../src/core/app'
import GenerateDemoToken, { generateJWT } from '../actions/generate-demo-token'

test('generateJWT returns a token and expiry date string', () => {
  const { token, expiresAt } = generateJWT('alice', 'Alice', 'admin')
  expect(typeof token).toBe('string')
  expect(token.split('.')).toHaveLength(3)
  expect(/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)).toBe(true)
})

test('GenerateDemoToken doAction returns a Bearer token string with metadata', async () => {
  const app = new ODApp()
  const action = new GenerateDemoToken(app)
  const result = await action.invoke({ sub: 'bob', name: 'Bob', role: 'viewer' })
  expect(result).toMatch(/^Bearer /)
  expect(result).toContain('sub=bob')
  expect(result).toContain('role=viewer')
})

test('GenerateDemoToken doAction uses defaults when input is empty', async () => {
  const app = new ODApp()
  const action = new GenerateDemoToken(app)
  const result = await action.invoke({})
  expect(result).toMatch(/^Bearer /)
  expect(result).toContain('sub=demo-user')
  expect(result).toContain('role=admin')
})
