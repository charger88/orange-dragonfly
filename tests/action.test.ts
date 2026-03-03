import ODAction from '../src/core/action'
import ODApp from '../src/core/app'
import ODController from '../src/core/controller'
import ODPrintRoutes from '../src/actions/print-routes'
import ODCommandLineInterface from '../src/transport/actions/command-line-interface'
import type { ODLogger } from '../src/core/logger'

function createLogger(): ODLogger {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  }
}

test('actionName is generated from class name', () => {
  class HelloWorldAction extends ODAction {
    protected async doAction(): Promise<string> {
      return 'ok'
    }
  }
  expect(HelloWorldAction.actionName).toBe('hello-world-action')
})

test('useAction is chainable and rejects duplicate action names', () => {
  class FirstAction extends ODAction {
    static get actionName() {
      return 'same-action'
    }

    protected async doAction(): Promise<string> {
      return 'first'
    }
  }

  class SecondAction extends ODAction {
    static get actionName() {
      return 'same-action'
    }

    protected async doAction(): Promise<string> {
      return 'second'
    }
  }

  const app = ODApp.create()
  expect(app.useAction(FirstAction)).toBe(app)
  expect(() => app.useAction(SecondAction)).toThrow('Duplicated action name: same-action')
})

test('processAction invokes registered action', async() => {
  class EchoAction extends ODAction {
    protected async doAction(input: Record<string, unknown>): Promise<string> {
      return JSON.stringify(input)
    }
  }

  const app = ODApp.create().useAction(EchoAction)
  await expect(app.processAction('echo-action', { value: 10 })).resolves.toBe('{"value":10}')
})

test('processAction logs and returns undefined for unknown action', async() => {
  const logger = createLogger()
  const app = ODApp.create({ logger })
  await expect(app.processAction('missing-action', {})).resolves.toBeUndefined()
  expect(logger.error).toHaveBeenCalledWith('Action is not registered', 'missing-action')
})

test('action lifecycle callbacks run in start -> action -> completed order', async() => {
  const calls: string[] = []

  class TrackAction extends ODAction {
    protected async doAction(): Promise<string> {
      calls.push('action')
      return 'done'
    }
  }

  const app = ODApp.create()
    .useAction(TrackAction)
    .onActionStarted(async() => { calls.push('started') })
    .onActionCompleted(async() => { calls.push('completed') })

  await expect(app.processAction('track-action', {})).resolves.toBe('done')
  expect(calls).toEqual(['started', 'action', 'completed'])
})

test('onActionCompleted runs when action throws and invocation error is logged', async() => {
  const calls: string[] = []
  const logger = createLogger()

  class FailAction extends ODAction {
    protected async doAction(): Promise<string> {
      calls.push('action')
      throw new Error('boom')
    }
  }

  const app = ODApp.create({ logger })
    .useAction(FailAction)
    .onActionStarted(async() => { calls.push('started') })
    .onActionCompleted(async() => { calls.push('completed') })

  await expect(app.processAction('fail-action', {})).resolves.toBeUndefined()
  expect(calls).toEqual(['started', 'action', 'completed'])
  expect(logger.error).toHaveBeenCalledWith(
    'Action invocation failed',
    expect.objectContaining({ message: 'boom' }),
  )
})

test('handleError wraps a non-Error throwable before rethrowing', async() => {
  const logger = createLogger()

  class ThrowStringAction extends ODAction {
    protected async doAction(): Promise<string> {
      throw 'a plain string was thrown'
    }
  }

  const app = ODApp.create({ logger }).useAction(ThrowStringAction)
  await expect(app.processAction('throw-string-action', {})).resolves.toBeUndefined()
  expect(logger.error).toHaveBeenCalledWith(
    'Action invocation failed',
    expect.objectContaining({ message: 'a plain string was thrown' }),
  )
})

test('onActionStarted(null) clears all started callbacks', async() => {
  const calls: string[] = []

  class TrackAction extends ODAction {
    protected async doAction(): Promise<string> {
      calls.push('action')
      return 'done'
    }
  }

  const app = ODApp.create()
    .useAction(TrackAction)
    .onActionStarted(async() => { calls.push('started') })
    .onActionStarted(null)

  await app.processAction('track-action', {})
  expect(calls).toEqual(['action'])
})

test('onActionCompleted(null) clears all completed callbacks', async() => {
  const calls: string[] = []

  class CountableAction extends ODAction {
    protected async doAction(): Promise<string> {
      calls.push('action')
      return 'done'
    }
  }

  const app = ODApp.create()
    .useAction(CountableAction)
    .onActionCompleted(async() => { calls.push('completed') })
    .onActionCompleted(null)

  await app.processAction('countable-action', {})
  expect(calls).toEqual(['action'])
})

test('onActionCompleted callback throwing is caught and error is logged', async() => {
  const logger = createLogger()

  class SimpleAction extends ODAction {
    protected async doAction(): Promise<string> {
      return 'ok'
    }
  }

  const app = ODApp.create({ logger })
    .useAction(SimpleAction)
    .onActionCompleted(async() => { throw new Error('completed callback failed') })

  await expect(app.processAction('simple-action', {})).resolves.toBe('ok')
  expect(logger.error).toHaveBeenCalledWith(
    'Action completion callback failed',
    expect.objectContaining({ message: 'completed callback failed' }),
  )
})

test('ODPrintRoutes action name is print-routes', () => {
  expect(ODPrintRoutes.actionName).toBe('print-routes')
})

test('ODPrintRoutes lists registered routes sorted by path', async() => {
  class ZebraController extends ODController {
    async doGet() {
      return 'zebra'
    }
  }

  class AlphaController extends ODController {
    async doPostId() {
      return 'alpha'
    }
  }

  const app = ODApp.create()
    .useController(ZebraController)
    .useController(AlphaController)
    .useAction(ODPrintRoutes)

  await app.init()
  const output = await app.processAction('print-routes', {})
  expect(output).toBe([
    'POST /alpha/{#id}',
    'OPTIONS /alpha/{#id}',
    'GET /zebra',
    'OPTIONS /zebra',
  ].join('\n'))
})

test('CLI parser extracts action and key=value input', () => {
  const parsed = ODCommandLineInterface.parseInputData([
    'node',
    'script.js',
    'print-routes',
    'limit=10',
    'name=orange',
    '__proto__=hack',
  ])

  expect(parsed.action).toBe('print-routes')
  expect(parsed.input).toEqual({ limit: '10', name: 'orange' })
})

test('CLI run dispatches processAction and logs output', async() => {
  const processAction = jest.fn(async() => 'printed routes')
  const info = jest.fn()

  await ODCommandLineInterface.run({
    processAction,
    logger: { info, warn: jest.fn(), error: jest.fn() },
  } as unknown as ODApp, ['node', 'script.js', 'print-routes', 'limit=10'])

  expect(processAction).toHaveBeenCalledWith('print-routes', { limit: '10' })
  expect(info).toHaveBeenCalledWith('printed routes')
})

test('CLI run does not log when action returns undefined', async() => {
  const processAction = jest.fn(async() => undefined)
  const info = jest.fn()

  await ODCommandLineInterface.run({
    processAction,
    logger: { info, warn: jest.fn(), error: jest.fn() },
  } as unknown as ODApp, ['node', 'script.js', 'missing'])

  expect(processAction).toHaveBeenCalledWith('missing', {})
  expect(info).not.toHaveBeenCalled()
})
