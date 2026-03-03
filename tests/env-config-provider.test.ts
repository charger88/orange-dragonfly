import ODEnvConfigProvider from '../src/providers/env-config-provider'

beforeEach(() => {
  delete process.env.TEST_VAR
  delete process.env.TEST_INT
})

test('param returns env variable when set', () => {
  process.env.TEST_VAR = 'hello'
  expect(ODEnvConfigProvider.param('TEST_VAR')).toBe('hello')
})

test('param returns undefined when not set and no default', () => {
  expect(ODEnvConfigProvider.param('TEST_VAR')).toBeUndefined()
})

test('param returns default when not set', () => {
  expect(ODEnvConfigProvider.param('TEST_VAR', 'fallback')).toBe('fallback')
})

test('param returns env variable even when default is provided', () => {
  process.env.TEST_VAR = 'actual'
  expect(ODEnvConfigProvider.param('TEST_VAR', 'fallback')).toBe('actual')
})

test('str returns env variable when set', () => {
  process.env.TEST_VAR = 'world'
  expect(ODEnvConfigProvider.str('TEST_VAR', 'default')).toBe('world')
})

test('str returns default when not set', () => {
  expect(ODEnvConfigProvider.str('TEST_VAR', 'default')).toBe('default')
})

test('int returns parsed integer from env', () => {
  process.env.TEST_INT = '42'
  expect(ODEnvConfigProvider.int('TEST_INT', 0)).toBe(42)
})

test('int returns default when not set', () => {
  expect(ODEnvConfigProvider.int('TEST_INT', 99)).toBe(99)
})

test('int handles non-numeric env values', () => {
  process.env.TEST_INT = 'abc'
  expect(() => ODEnvConfigProvider.int('TEST_INT', 0)).toThrow('Environment variable "TEST_INT" must be a valid integer')
})

test('int rejects unsafe integer env values', () => {
  process.env.TEST_INT = '9007199254740993'
  expect(() => ODEnvConfigProvider.int('TEST_INT', 0)).toThrow('Environment variable "TEST_INT" must be a valid safe integer')
})

test('str returns empty string from env', () => {
  process.env.TEST_VAR = ''
  expect(ODEnvConfigProvider.str('TEST_VAR', 'default')).toBe('')
})
