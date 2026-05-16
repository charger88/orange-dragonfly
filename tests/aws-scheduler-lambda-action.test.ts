import ODAction from '../src/core/action'
import ODApp from '../src/core/app'
import ODAwsSchedulerLambdaActionFactory from '../src/transport/actions/aws-scheduler-lambda'

function makeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}

class SuccessAction extends ODAction {
  static lastInput: Record<string, unknown> | undefined
  protected async doAction(input: Record<string, unknown>): Promise<string> {
    SuccessAction.lastInput = input
    return 'ok'
  }
}

class FailAction extends ODAction {
  protected async doAction(): Promise<string> {
    throw new Error('action failed')
  }
}

class RecoveringAction extends ODAction {
  protected async doAction(): Promise<string> {
    throw new Error('inner error')
  }
  async handleError(): Promise<string> {
    return 'recovered'
  }
}

afterEach(() => {
  SuccessAction.lastInput = undefined
  jest.restoreAllMocks()
})

describe('build', () => {
  test('returns a callable handler function', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    expect(typeof handler).toBe('function')
  })

  test('plain object event resolves without error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler({ key: 'value' })).resolves.toBeUndefined()
  })

  test('passes event payload as input to the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await handler({ userId: 'abc', amount: 42 })
    expect(SuccessAction.lastInput).toEqual({ userId: 'abc', amount: 42 })
  })

  test('empty object event is valid', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler({})).resolves.toBeUndefined()
  })

  test('handler is stateless and can be called multiple times', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler({ run: 1 })).resolves.toBeUndefined()
    await expect(handler({ run: 2 })).resolves.toBeUndefined()
  })
})

describe('input validation', () => {
  test('array event throws by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler([1, 2, 3])).rejects.toThrow('EventBridge Scheduler event must be a plain object')
  })

  test('string event throws by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler('hello')).rejects.toThrow()
  })

  test('number event throws by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(42)).rejects.toThrow()
  })

  test('null event throws by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(null)).rejects.toThrow()
  })
})

describe('onInputError', () => {
  test('throw (default): rethrows on invalid event', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(['bad'])).rejects.toThrow()
  })

  test('throw (explicit): rethrows on invalid event', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onInputError: 'throw' }, SuccessAction)
    await expect(handler(null)).rejects.toThrow()
  })

  test('discard: resolves without error on invalid event', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onInputError: 'discard' }, SuccessAction)
    await expect(handler('bad input')).resolves.toBeUndefined()
  })

  test('discard: does not invoke the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onInputError: 'discard' }, SuccessAction)
    await handler([1, 2])
    expect(SuccessAction.lastInput).toBeUndefined()
  })
})

describe('onActionError', () => {
  test('throw (default): rethrows on action error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, FailAction)
    await expect(handler({})).rejects.toThrow('action failed')
  })

  test('throw (explicit): rethrows on action error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onActionError: 'throw' }, FailAction)
    await expect(handler({})).rejects.toThrow('action failed')
  })

  test('discard: resolves without error on action failure', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    await expect(handler({})).resolves.toBeUndefined()
  })
})

describe('action error recovery via handleError', () => {
  test('action that recovers in handleError is treated as success', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, RecoveringAction)
    await expect(handler({})).resolves.toBeUndefined()
  })
})

describe('transformInput', () => {
  test('transformed input is passed to the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {
      transformInput: (input) => ({ ...input, enriched: true }),
    }, SuccessAction)
    await handler({ x: 1 })
    expect(SuccessAction.lastInput).toEqual({ x: 1, enriched: true })
  })

  test('async transformInput is awaited before invoking the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {
      transformInput: async (input) => ({ ...input, async: true }),
    }, SuccessAction)
    await handler({ v: 1 })
    expect(SuccessAction.lastInput).toEqual({ v: 1, async: true })
  })

  test('without transformInput the original event payload is used', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {}, SuccessAction)
    await handler({ original: true })
    expect(SuccessAction.lastInput).toEqual({ original: true })
  })
})

describe('logger', () => {
  test('uses app.logger by default', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    await handler({})
    expect(logger.error).toHaveBeenCalled()
  })

  test('uses options.logger when provided', async () => {
    const appLogger = makeLogger()
    const optLogger = makeLogger()
    const app = await ODApp.create({ logger: appLogger }).init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { logger: optLogger, onActionError: 'discard' }, FailAction)
    await handler({})
    expect(optLogger.error).toHaveBeenCalled()
    expect(appLogger.error).not.toHaveBeenCalled()
  })

  test('logs input error on invalid payload', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onInputError: 'discard' }, SuccessAction)
    await handler('bad')
    expect(logger.error).toHaveBeenCalledWith(
      'Invalid EventBridge Scheduler event payload',
      expect.objectContaining({ error: expect.any(Error) }),
    )
  })

  test('logs action error on failure', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSchedulerLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    await handler({})
    expect(logger.error).toHaveBeenCalledWith(
      'Scheduler action invocation failed',
      expect.objectContaining({ error: expect.any(Error) }),
    )
  })
})
