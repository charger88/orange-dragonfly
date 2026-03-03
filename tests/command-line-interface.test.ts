import ODCommandLineInterface from '../src/transport/actions/command-line-interface'

describe('parseInputData', () => {
  test('extracts action from argv[2]', () => {
    const { action } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'myAction'])
    expect(action).toBe('myAction')
  })

  test('extracts basic key=value pairs', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act', 'name=Alice', 'age=30'])
    expect(input).toEqual({ name: 'Alice', age: '30' })
  })

  test('strips double quotes from values', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act', 'key="hello world"'])
    expect(input['key']).toBe('hello world')
  })

  test('strips single quotes from values', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act', "key='hello world'"])
    expect(input['key']).toBe('hello world')
  })

  test('does not strip quotes when only one side is quoted', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act', 'key="unmatched'])
    expect(input['key']).toBe('"unmatched')
  })

  test('skips entries without = sign', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act', 'noequals'])
    expect(input).toEqual({})
  })

  test('skips entries with empty key', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act', '=value'])
    expect(input).toEqual({})
  })

  test('value can contain = sign', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act', 'expr=a=b'])
    expect(input['expr']).toBe('a=b')
  })

  test('returns empty input when no args after action', () => {
    const { input } = ODCommandLineInterface.parseInputData(['node', 'app.js', 'act'])
    expect(input).toEqual({})
  })
})
