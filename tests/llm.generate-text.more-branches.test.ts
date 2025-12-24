import { describe, expect, it, vi } from 'vitest'

import { generateTextWithModelId, streamTextWithModelId } from '../src/llm/generate-text.js'

const generateTextMock = vi.fn()
const streamTextMock = vi.fn()

vi.mock('ai', () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
}))

const createOpenAIMock = vi.fn(() => {
  const fn: any = (_modelId: string) => ({ kind: 'responses' })
  fn.chat = (_modelId: string) => ({ kind: 'chat' })
  return fn
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: createOpenAIMock,
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (_modelId: string) => ({}),
}))

describe('llm/generate-text extra branches', () => {
  it('streamTextWithModelId resolves usage=null when totalUsage rejects and iterator cleanup rejects', async () => {
    streamTextMock.mockImplementationOnce((_args: any) => {
      const stream = {
        async *[Symbol.asyncIterator]() {
          yield 'ok'
        },
      }
      const iterator: any = stream[Symbol.asyncIterator]()
      iterator.return = () => Promise.reject(new Error('cleanup failed'))
      return {
        textStream: { [Symbol.asyncIterator]: () => iterator },
        totalUsage: Promise.reject(new Error('no usage')),
      }
    })

    const result = await streamTextWithModelId({
      modelId: 'openai/gpt-5.2',
      apiKeys: {
        openaiApiKey: 'k',
        xaiApiKey: null,
        googleApiKey: null,
        anthropicApiKey: null,
        openrouterApiKey: null,
      },
      prompt: 'hi',
      timeoutMs: 2000,
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 10,
    })

    const chunks: string[] = []
    for await (const chunk of result.textStream) chunks.push(chunk)
    expect(chunks.join('')).toBe('ok')
    await expect(result.usage).resolves.toBeNull()
  })

  it('streamTextWithModelId normalizes anthropic access errors via onError', async () => {
    let capturedOnError: ((event: { error: unknown }) => void) | null = null
    streamTextMock.mockImplementationOnce((args: any) => {
      capturedOnError = typeof args.onError === 'function' ? args.onError : null
      return {
        textStream: {
          async *[Symbol.asyncIterator]() {
            yield 'ok'
          },
        },
        totalUsage: Promise.resolve({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }),
      }
    })

    const result = await streamTextWithModelId({
      modelId: 'anthropic/claude-3-5-sonnet-latest',
      apiKeys: {
        openaiApiKey: null,
        xaiApiKey: null,
        googleApiKey: null,
        anthropicApiKey: 'k',
        openrouterApiKey: null,
      },
      prompt: 'hi',
      timeoutMs: 2000,
      fetchImpl: globalThis.fetch.bind(globalThis),
      maxOutputTokens: 10,
    })

    capturedOnError?.({
      error: Object.assign(new Error('model: claude-3-5-sonnet-latest'), {
        statusCode: 403,
        responseBody: JSON.stringify({
          type: 'error',
          error: { type: 'permission_error', message: 'model: claude-3-5-sonnet-latest' },
        }),
      }),
    })

    const err = result.lastError()
    expect(err instanceof Error ? err.message : String(err)).toMatch(/Anthropic API rejected model/i)
  })

  it('generateTextWithModelId retries on timeout-like errors', async () => {
    vi.useFakeTimers()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      let calls = 0
      generateTextMock.mockImplementation(async () => {
        calls += 1
        if (calls === 1) throw new Error('timed out')
        return { text: 'OK', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
      })

      const onRetry = vi.fn()
      const promise = generateTextWithModelId({
        modelId: 'openai/gpt-5.2',
        apiKeys: {
          openaiApiKey: 'k',
          xaiApiKey: null,
          googleApiKey: null,
          anthropicApiKey: null,
          openrouterApiKey: null,
        },
        prompt: 'hi',
        timeoutMs: 2000,
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 10,
        retries: 1,
        onRetry,
      })

      await vi.runOnlyPendingTimersAsync()
      const result = await promise
      expect(result.text).toBe('OK')
      expect(onRetry).toHaveBeenCalled()
      expect(calls).toBe(2)
    } finally {
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('throws missing key errors for openai/... models', async () => {
    generateTextMock.mockReset()
    await expect(
      generateTextWithModelId({
        modelId: 'openai/gpt-5.2',
        apiKeys: {
          openaiApiKey: null,
          xaiApiKey: null,
          googleApiKey: null,
          anthropicApiKey: null,
          openrouterApiKey: null,
        },
        prompt: 'hi',
        timeoutMs: 2000,
        fetchImpl: globalThis.fetch.bind(globalThis),
        maxOutputTokens: 10,
      })
    ).rejects.toThrow(/Missing OPENAI_API_KEY/i)
  })
})

