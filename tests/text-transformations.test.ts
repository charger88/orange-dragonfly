import { camelCaseToDashCase } from '../src/utils/text-transformations'

test('simple camelCase', () => {
  expect(camelCaseToDashCase('MyData')).toBe('my-data')
})

test('multiple words', () => {
  expect(camelCaseToDashCase('UsersController')).toBe('users-controller')
})

test('single word', () => {
  expect(camelCaseToDashCase('Index')).toBe('index')
})

test('already lowercase', () => {
  expect(camelCaseToDashCase('index')).toBe('index')
})

test('digits after lowercase letters', () => {
  expect(camelCaseToDashCase('OAuth2Controller')).toBe('oauth-2-controller')
})

test('uppercase followed by digit', () => {
  expect(camelCaseToDashCase('V2Users')).toBe('v2-users')
})

test('digits in the middle', () => {
  expect(camelCaseToDashCase('route404Handler')).toBe('route-404-handler')
})

test('consecutive uppercase becomes lowercase', () => {
  expect(camelCaseToDashCase('HTMLParser')).toBe('html-parser')
})

test('acronyms before capitalized words are split correctly', () => {
  expect(camelCaseToDashCase('APIKey')).toBe('api-key')
})

test('empty string', () => {
  expect(camelCaseToDashCase('')).toBe('')
})
