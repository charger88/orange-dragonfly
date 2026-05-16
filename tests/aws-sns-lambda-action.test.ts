import ODAction from '../src/core/action'
import ODApp from '../src/core/app'
import ODAwsSnsLambdaActionFactory, {
  type ODAwsSnsEvent,
  type ODAwsSnsRecord,
} from '../src/transport/actions/aws-sns-lambda'

function makeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}

function makeRecord(overrides: Partial<ODAwsSnsRecord> & { message?: string } = {}): ODAwsSnsRecord {
  const { message = '{}', ...rest } = overrides
  return {
    EventVersion: '1.0',
    EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic:abc',
    EventSource: 'aws:sns',
    Sns: {
      SignatureVersion: '1',
      Timestamp: '2024-01-01T00:00:00.000Z',
      Signature: 'sig',
      SigningCertUrl: 'https://cert.url',
      MessageId: 'msg-1',
      Message: message,
      MessageAttributes: {},
      Type: 'Notification',
      UnsubscribeUrl: 'https://unsub.url',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:MyTopic',
      Subject: '',
    },
    ...rest,
  }
}

function withMessageId(record: ODAwsSnsRecord, messageId: string): ODAwsSnsRecord {
  return { ...record, Sns: { ...record.Sns, MessageId: messageId } }
}

function makeEvent(records: ODAwsSnsRecord[]): ODAwsSnsEvent {
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
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    expect(typeof handler).toBe('function')
  })

  test('empty Records resolves without error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(makeEvent([]))).resolves.toBeUndefined()
  })

  test('successful single record resolves without error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: '{"x":1}' })]))).resolves.toBeUndefined()
  })

  test('passes parsed record message as input to the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await handler(makeEvent([makeRecord({ message: '{"userId":"abc","amount":42}' })]))
    expect(SuccessAction.lastInput).toEqual({ userId: 'abc', amount: 42 })
  })

  test('all records succeed → handler resolves', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    const records = [
      withMessageId(makeRecord(), 'msg-1'),
      withMessageId(makeRecord(), 'msg-2'),
      withMessageId(makeRecord(), 'msg-3'),
    ]
    await expect(handler(makeEvent(records))).resolves.toBeUndefined()
  })

  test('handler is stateless and can be called multiple times', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(makeEvent([makeRecord()]))).resolves.toBeUndefined()
    await expect(handler(makeEvent([makeRecord()]))).resolves.toBeUndefined()
  })
})

describe('action error handling', () => {
  test('failed action throws by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, FailAction)
    await expect(handler(makeEvent([makeRecord()]))).rejects.toThrow('action failed')
  })

  test('failed action with onActionError: throw rethrows', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onActionError: 'throw' }, FailAction)
    await expect(handler(makeEvent([makeRecord()]))).rejects.toThrow('action failed')
  })

  test('failed action with onActionError: discard resolves without error', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    await expect(handler(makeEvent([makeRecord()]))).resolves.toBeUndefined()
  })

  test('throw on first failed record stops processing subsequent records', async () => {
    const app = await ODApp.create().init()
    let callCount = 0
    class CountingFailAction extends ODAction {
      protected async doAction(): Promise<string> {
        callCount++
        throw new Error('fail')
      }
    }

    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, CountingFailAction)
    const records = [withMessageId(makeRecord(), 'msg-1'), withMessageId(makeRecord(), 'msg-2')]
    await expect(handler(makeEvent(records))).rejects.toThrow()
    expect(callCount).toBe(1)
  })

  test('discard allows subsequent records to be processed', async () => {
    const app = await ODApp.create().init()
    let callCount = 0
    class CountingFailAction extends ODAction {
      protected async doAction(): Promise<string> {
        callCount++
        throw new Error('fail')
      }
    }

    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onActionError: 'discard' }, CountingFailAction)
    const records = [withMessageId(makeRecord(), 'msg-1'), withMessageId(makeRecord(), 'msg-2')]
    await handler(makeEvent(records))
    expect(callCount).toBe(2)
  })

  test('non-Error throwable is still rethrown', async () => {
    const app = await ODApp.create().init()
    class ThrowStringAction extends ODAction {
      protected async doAction(): Promise<string> {
        throw 'plain string error'
      }
    }

    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, ThrowStringAction)
    await expect(handler(makeEvent([makeRecord()]))).rejects.toBeDefined()
  })
})

describe('action error recovery via handleError', () => {
  test('action that recovers in handleError is treated as success', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, RecoveringAction)
    await expect(handler(makeEvent([makeRecord()]))).resolves.toBeUndefined()
  })
})

describe('record message parsing', () => {
  test('invalid JSON is discarded (no throw) by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: '{broken' })]))).resolves.toBeUndefined()
  })

  test('invalid JSON with onParseError: throw rethrows', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onParseError: 'throw' }, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: '{broken' })]))).rejects.toThrow()
  })

  test('JSON array message is discarded by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: '[1,2,3]' })]))).resolves.toBeUndefined()
  })

  test('JSON string message is discarded by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: '"hello"' })]))).resolves.toBeUndefined()
  })

  test('JSON null message is discarded by default', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: 'null' })]))).resolves.toBeUndefined()
  })

  test('JSON non-object with onParseError: throw rethrows on first bad record', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onParseError: 'throw' }, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: '[1,2]' })]))).rejects.toThrow('SNS record message must be a JSON object')
  })

  test('valid JSON object with onParseError: throw still succeeds normally', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onParseError: 'throw' }, SuccessAction)
    await expect(handler(makeEvent([makeRecord({ message: '{"key":"val"}' })]))).resolves.toBeUndefined()
  })

  test('parse error does not prevent subsequent records from running (discard)', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    const records = [
      makeRecord({ message: '{broken' }),
      makeRecord({ message: '{"ok":true}' }),
    ]
    await handler(makeEvent(records))
    expect(SuccessAction.lastInput).toEqual({ ok: true })
  })
})

describe('transformInput', () => {
  test('transformed input is passed to the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {
      transformInput: (input, record) => ({ ...input, messageId: record.Sns.MessageId }),
    }, SuccessAction)
    await handler(makeEvent([withMessageId(makeRecord({ message: '{"x":1}' }), 'msg-xyz')]))
    expect(SuccessAction.lastInput).toEqual({ x: 1, messageId: 'msg-xyz' })
  })

  test('transformInput receives the full SNS record', async () => {
    const app = await ODApp.create().init()
    const captured: ODAwsSnsRecord[] = []
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {
      transformInput: (input, record) => { captured.push(record); return input },
    }, SuccessAction)
    const record = makeRecord()
    await handler(makeEvent([record]))
    expect(captured[0]).toBe(record)
  })

  test('async transformInput is awaited before invoking the action', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {
      transformInput: async (input) => ({ ...input, enriched: true }),
    }, SuccessAction)
    await handler(makeEvent([makeRecord({ message: '{"v":1}' })]))
    expect(SuccessAction.lastInput).toEqual({ v: 1, enriched: true })
  })

  test('without transformInput the original parsed message is used', async () => {
    const app = await ODApp.create().init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    await handler(makeEvent([makeRecord({ message: '{"original":true}' })]))
    expect(SuccessAction.lastInput).toEqual({ original: true })
  })
})

describe('logger', () => {
  test('uses app.logger by default', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    await handler(makeEvent([makeRecord()]))
    expect(logger.error).toHaveBeenCalled()
  })

  test('uses options.logger when provided', async () => {
    const appLogger = makeLogger()
    const optLogger = makeLogger()
    const app = await ODApp.create({ logger: appLogger }).init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { logger: optLogger, onActionError: 'discard' }, FailAction)
    await handler(makeEvent([makeRecord()]))
    expect(optLogger.error).toHaveBeenCalled()
    expect(appLogger.error).not.toHaveBeenCalled()
  })

  test('logs parse error with the messageId', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, {}, SuccessAction)
    const record = withMessageId(makeRecord({ message: 'not-json' }), 'bad-msg')
    await handler(makeEvent([record]))
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to parse SNS record message',
      expect.objectContaining({ messageId: 'bad-msg' }),
    )
  })

  test('logs action error with the messageId', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    const record = withMessageId(makeRecord(), 'fail-msg')
    await handler(makeEvent([record]))
    expect(logger.error).toHaveBeenCalledWith(
      'SNS action invocation failed',
      expect.objectContaining({ messageId: 'fail-msg' }),
    )
  })

  test('action error log includes the error object', async () => {
    const logger = makeLogger()
    const app = await ODApp.create({ logger }).init()
    const handler = await ODAwsSnsLambdaActionFactory.build(app, { onActionError: 'discard' }, FailAction)
    await handler(makeEvent([makeRecord()]))
    expect(logger.error).toHaveBeenCalledWith(
      'SNS action invocation failed',
      expect.objectContaining({ error: expect.any(Error) }),
    )
  })
})
