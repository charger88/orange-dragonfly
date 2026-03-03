import { createHmac } from 'node:crypto'
import { ODAction } from '../../src'
import { DEMO_JWT_SECRET } from '../controllers/private'


export function generateJWT(sub: string, name: string, role: string) {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + 100 * 365 * 24 * 3600

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub, name, role, iat, exp })).toString('base64url')
  const sig = createHmac('sha256', DEMO_JWT_SECRET).update(`${header}.${payload}`).digest('base64url')

  const token = `${header}.${payload}.${sig}`
  const expiresAt = new Date(exp * 1000).toISOString().slice(0, 10)

  return { token, expiresAt }
}

/**
 * CLI action that mints a demo JWT signed with DEMO_JWT_SECRET (~100-year expiry).
 *
 * Usage:
 *   npx tsx example/cli.ts generate-demo-token
 *   npx tsx example/cli.ts generate-demo-token sub=alysa name=Alysa role=winner
 *
 * The printed token can be used as the Authorization header when testing GET /private:
 *   curl -H "Authorization: Bearer <token>" http://localhost:8888/private
 */
export default class GenerateDemoToken extends ODAction {
  protected async doAction(input: Record<string, unknown>): Promise<string> {
    const sub = String(input.sub ?? 'demo-user')
    const name = String(input.name ?? 'Demo User')
    const role = String(input.role ?? 'admin')
    const { token, expiresAt } = generateJWT(sub, name, role)
    return `Bearer ${token}\n\n(expires ${expiresAt}, sub=${sub}, role=${role})`
  }
}
