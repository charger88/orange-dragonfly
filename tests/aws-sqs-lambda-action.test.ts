import ODAction from '../src/core/action'
import ODApp from '../src/core/app'
import ODAwsSqsLambdaActionFactory, {
  type ODAwsSqsEvent,
  type ODAwsSqsRecord,
} from '../src/transport/actions/aws-sqs-lambda'

function makeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}

function makeRecord(overrides: Partial<ODAwsSqsRecord> = {}): ODAwsSqsRecord {
  return {
    messageId: 'msg-1',
    receiptHandle: 'handle-1',
    body: '{}',
    attributes: {},
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:MyQueue',
    awsRegion: 'us-east-1',
    ...overrides,
  }
}

function makeEvent(records: ODAwsSqsRecord[]): ODAwsSqsEvent {
  return { Records: records }
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
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    expect(typeof handler).toBe('function')
  })

  test('empty Records returns empty batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const result = await handler(makeEvent([]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('successful single record returns empty batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'msg-1', body: '{"x":1}' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('passes parsed record body as input to the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    await handler(makeEvent([makeRecord({ body: '{"userId":"abc","amount":42}' })]))
    expect(SuccessAction.lastInput).toEqual({ userId: 'abc', amount: 42 })
  })

  test('all records succeed → empty batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const records = [
      makeRecord({ messageId: 'msg-1' }),
      makeRecord({ messageId: 'msg-2' }),
      makeRecord({ messageId: 'msg-3' }),
    ]
    const result = await handler(makeEvent(records))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('failed action adds its messageId to batchItemFailures by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, FailAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'msg-fail' })]))
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-fail' }] })
  })

  test('failed action with onActionError: fail adds to batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'fail' }, FailAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'msg-fail' })]))
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-fail' }] })
  })

  test('failed action with onActionError: discard is not added to batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'msg-fail' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('only failed records appear in batchItemFailures', async () => {
    const app = await ODApp.create().init()
    let callCount = 0
    class SometimesFailAction extends ODAction {
      protected async doAction(): Promise<string> {
        callCount++
        if (callCount === 2) throw new Error('second fails')
        return 'ok'
      }
    }

    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SometimesFailAction)
    const records = [
      makeRecord({ messageId: 'msg-1' }),
      makeRecord({ messageId: 'msg-2' }),
      makeRecord({ messageId: 'msg-3' }),
    ]
    const result = await handler(makeEvent(records))
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-2' }] })
  })

  test('all records fail → all messageIds in batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, FailAction)
    const records = [
      makeRecord({ messageId: 'msg-a' }),
      makeRecord({ messageId: 'msg-b' }),
    ]
    const result = await handler(makeEvent(records))
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'msg-a' },
      { itemIdentifier: 'msg-b' },
    ])
  })

  test('handler is stateless and can be called multiple times', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const r1 = await handler(makeEvent([makeRecord({ messageId: 'run-1' })]))
    const r2 = await handler(makeEvent([makeRecord({ messageId: 'run-2' })]))
    expect(r1).toEqual({ batchItemFailures: [] })
    expect(r2).toEqual({ batchItemFailures: [] })
  })
})

describe('action error recovery via handleError', () => {
  test('action that recovers in handleError is treated as success', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, RecoveringAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'msg-1' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('non-Error throwable from action is still treated as failure', async () => {
    const app = await ODApp.create().init()
    class ThrowStringAction extends ODAction {
      protected async doAction(): Promise<string> {
        throw 'plain string error'
      }
    }

    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, ThrowStringAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'msg-str' })]))
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-str' }] })
  })
})

describe('record body parsing', () => {
  test('invalid JSON is discarded (not in batchItemFailures) by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'bad-json', body: '{broken' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('invalid JSON with onParseError: fail adds to batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'fail' }, SuccessAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'bad-json', body: '{broken' })]))
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'bad-json' }] })
  })

  test('JSON array body is discarded by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'array-body', body: '[1,2,3]' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('JSON string body is discarded by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'str-body', body: '"hello"' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('JSON null body is discarded by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'null-body', body: 'null' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('JSON non-object body with onParseError: fail adds to batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'fail' }, SuccessAction)
    const records = [
      makeRecord({ messageId: 'arr', body: '[1,2]' }),
      makeRecord({ messageId: 'str', body: '"hello"' }),
    ]
    const result = await handler(makeEvent(records))
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'arr' },
      { itemIdentifier: 'str' },
    ])
  })

  test('valid JSON object with onParseError: fail still succeeds normally', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'fail' }, SuccessAction)
    const result = await handler(makeEvent([makeRecord({ messageId: 'good', body: '{"key":"val"}' })]))
    expect(result).toEqual({ batchItemFailures: [] })
  })

  test('parse error does not prevent subsequent records from running', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    const records = [
      makeRecord({ messageId: 'bad', body: '{broken' }),
      makeRecord({ messageId: 'good', body: '{"ok":true}' }),
    ]
    const result = await handler(makeEvent(records))
    expect(result).toEqual({ batchItemFailures: [] })
    expect(SuccessAction.lastInput).toEqual({ ok: true })
  })
})

describe('onParseError: throw', () => {
  test('single record: throws on parse error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'throw' }, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ messageId: 'bad', body: '{broken' })]))).rejects.toThrow()
  })

  test('multiple records: throws on first parse error and stops processing', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'throw' }, SuccessAction)
    const records = [
      makeRecord({ messageId: 'bad', body: '{broken' }),
      makeRecord({ messageId: 'good', body: '{"ok":true}' }),
    ]
    await expect(handler(makeEvent(records))).rejects.toThrow()
    expect(SuccessAction.lastInput).toBeUndefined()
  })
})

describe('onParseError: throw1/discard', () => {
  test('single record: throws on parse error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'throw1/discard' }, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ body: '{broken' })]))).rejects.toThrow()
  })

  test('multiple records: discards the bad record, processes the rest', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'throw1/discard' }, SuccessAction)
    const records = [
      makeRecord({ messageId: 'bad', body: '{broken' }),
      makeRecord({ messageId: 'good', body: '{"ok":true}' }),
    ]
    const result = await handler(makeEvent(records))
    expect(result).toEqual({ batchItemFailures: [] })
    expect(SuccessAction.lastInput).toEqual({ ok: true })
  })
})

describe('onParseError: throw1/fail', () => {
  test('single record: throws on parse error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'throw1/fail' }, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ body: '{broken' })]))).rejects.toThrow()
  })

  test('multiple records: adds bad record to batchItemFailures, processes the rest', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onParseError: 'throw1/fail' }, SuccessAction)
    const records = [
      makeRecord({ messageId: 'bad', body: '{broken' }),
      makeRecord({ messageId: 'good', body: '{"ok":true}' }),
    ]
    const result = await handler(makeEvent(records))
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'bad' }] })
    expect(SuccessAction.lastInput).toEqual({ ok: true })
  })
})

describe('onActionError: throw', () => {
  test('single record: throws on action error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'throw' }, FailAction)
    await expect(handler(makeEvent([makeRecord()]))).rejects.toThrow('action failed')
  })

  test('multiple records: throws on first action error and stops processing', async () => {
    const app = await ODApp.create().init()
    let callCount = 0
    class CountingAction extends ODAction {
      protected async doAction(): Promise<string> {
        callCount++
        if (callCount === 1) throw new Error('first fails')
        return 'ok'
      }
    }

    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'throw' }, CountingAction)
    await expect(handler(makeEvent([makeRecord({ messageId: 'a' }), makeRecord({ messageId: 'b' })]))).rejects.toThrow()
    expect(callCount).toBe(1)
  })
})

describe('onActionError: throw1/discard', () => {
  test('single record: throws on action error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'throw1/discard' }, FailAction)
    await expect(handler(makeEvent([makeRecord()]))).rejects.toThrow()
  })

  test('multiple records: discards the failed record, no batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'throw1/discard' }, FailAction)
    const records = [makeRecord({ messageId: 'a' }), makeRecord({ messageId: 'b' })]
    const result = await handler(makeEvent(records))
    expect(result).toEqual({ batchItemFailures: [] })
  })
})

describe('onActionError: throw1/fail', () => {
  test('single record: throws on action error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'throw1/fail' }, FailAction)
    await expect(handler(makeEvent([makeRecord({ messageId: 'a' })]))).rejects.toThrow()
  })

  test('multiple records: adds failed records to batchItemFailures', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { onActionError: 'throw1/fail' }, FailAction)
    const records = [makeRecord({ messageId: 'a' }), makeRecord({ messageId: 'b' })]
    const result = await handler(makeEvent(records))
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'a' }, { itemIdentifier: 'b' }] })
  })
})

describe('transformInput', () => {
  test('transformed input is passed to the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {
      transformInput: (input, record) => ({ ...input, messageId: record.messageId }),
    }, SuccessAction)
    await handler(makeEvent([makeRecord({ messageId: 'msg-xyz', body: '{"x":1}' })]))
    expect(SuccessAction.lastInput).toEqual({ x: 1, messageId: 'msg-xyz' })
  })

  test('transformInput receives the full SQS record', async () => {
    const app = await ODApp.create().init()
    const captured: ODAwsSqsRecord[] = []
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {
      transformInput: (input, record) => { captured.push(record); return input },
    }, SuccessAction)
    const record = makeRecord({ messageId: 'msg-1', attributes: { SenderId: 'abc' } })
    await handler(makeEvent([record]))
    expect(captured[0]).toBe(record)
  })

  test('async transformInput is awaited before invoking the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {
      transformInput: async (input) => ({ ...input, enriched: true }),
    }, SuccessAction)
    await handler(makeEvent([makeRecord({ body: '{"v":1}' })]))
    expect(SuccessAction.lastInput).toEqual({ v: 1, enriched: true })
  })

  test('without transformInput the original parsed body is used', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    await handler(makeEvent([makeRecord({ body: '{"original":true}' })]))
    expect(SuccessAction.lastInput).toEqual({ original: true })
  })
})

describe('logger', () => {
  test('uses app.logger by default', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, FailAction)
    await handler(makeEvent([makeRecord({ messageId: 'msg-1' })]))
    expect(logger.error).toHaveBeenCalled()
  })

  test('uses options.logger when provided', async () => {
    const appLogger = makeLogger()
    const optLogger = makeLogger()
    const app = await ODApp.create({ logger: appLogger }).init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, { logger: optLogger }, FailAction)
    await handler(makeEvent([makeRecord({ messageId: 'msg-1' })]))
    expect(optLogger.error).toHaveBeenCalled()
    expect(appLogger.error).not.toHaveBeenCalled()
  })

  test('logs parse error with the messageId', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, SuccessAction)
    await handler(makeEvent([makeRecord({ messageId: 'bad-msg', body: 'not-json' })]))
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to parse SQS record body',
      expect.objectContaining({ messageId: 'bad-msg' }),
    )
  })

  test('logs action error with the messageId', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, FailAction)
    await handler(makeEvent([makeRecord({ messageId: 'fail-msg' })]))
    expect(logger.error).toHaveBeenCalledWith(
      'SQS action invocation failed',
      expect.objectContaining({ messageId: 'fail-msg' }),
    )
  })

  test('action error log includes the error object', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSqsLambdaActionFactory.build(app, {}, FailAction)
    await handler(makeEvent([makeRecord()]))
    expect(logger.error).toHaveBeenCalledWith(
      'SQS action invocation failed',
      expect.objectContaining({ error: expect.any(Error) }),
    )
  })
})
