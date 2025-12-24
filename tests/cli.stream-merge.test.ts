import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '../src/run.js'

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html' },
  })

function collectStream() {
  let text = ''
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString()
      callback()
    },
  })
  return { stream, getText: () => text }
}

function createTextStream(chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

const streamTextMock = vi.fn()

vi.mock('ai', () => ({
  streamText: streamTextMock,
}))

const createOpenAIMock = vi.fn(() => {
  return (_modelId: string) => ({})
})

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: createOpenAIMock,
}))

function writeLiteLlmCache(root: string) {
  const cacheDir = join(root, '.summarize', 'cache')
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(
    join(cacheDir, 'litellm-model_prices_and_context_window.json'),
    JSON.stringify({
      'gpt-5.2': { input_cost_per_token: 0.00000175, output_cost_per_token: 0.000014 },
    }),
    'utf8'
  )
  writeFileSync(
    join(cacheDir, 'litellm-model_prices_and_context_window.meta.json'),
    JSON.stringify({ fetchedAtMs: Date.now() }),
    'utf8'
  )
}

async function runStreamedSummary(
  chunks: string[],
  options?: { render?: 'plain' | 'md' | 'md-live'; stdoutIsTty?: boolean }
): Promise<string> {
  streamTextMock.mockImplementationOnce(() => ({
    textStream: createTextStream(chunks),
    totalUsage: Promise.resolve({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    }),
  }))

  const root = mkdtempSync(join(tmpdir(), 'summarize-stream-merge-'))
  writeLiteLlmCache(root)
  const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('unexpected LiteLLM catalog fetch')
  })

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.url
    if (url === 'https://example.com') {
      return htmlResponse(
        '<!doctype html><html><head><title>Hello</title></head>' +
          '<body><article><p>Hi</p></article></body></html>'
      )
    }
    throw new Error(`Unexpected fetch call: ${url}`)
  })

  const stdout = collectStream()
  if (options?.stdoutIsTty) {
    const stream = stdout.stream as unknown as { isTTY?: boolean; columns?: number }
    stream.isTTY = true
    stream.columns = 80
  }
  const stderr = collectStream()

  try {
    await runCli(
      [
        '--model',
        'openai/gpt-5.2',
        '--timeout',
        '2s',
        '--stream',
        'on',
        '--render',
        options?.render ?? 'plain',
        'https://example.com',
      ],
      {
        env: {
          HOME: root,
          OPENAI_API_KEY: 'test',
          ...(options?.stdoutIsTty ? { NO_COLOR: '1' } : {}),
        },
        fetch: fetchMock as unknown as typeof fetch,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }
    )
  } finally {
    globalFetchSpy.mockRestore()
  }

  return stdout.getText()
}

describe('cli stream chunk merge', () => {
  beforeEach(() => {
    streamTextMock.mockReset()
    createOpenAIMock.mockClear()
  })

  it('avoids duplication when chunks are cumulative buffers', async () => {
    const out = await runStreamedSummary(['Hello', 'Hello world', 'Hello world!'])
    expect(out).toBe('Hello world!\n')
  })

  it('keeps delta chunks unchanged', async () => {
    const out = await runStreamedSummary(['Hello ', 'world', '!'])
    expect(out).toBe('Hello world!\n')
  })

  it('handles mixed delta then cumulative chunks', async () => {
    const out = await runStreamedSummary(['Hello ', 'world', 'Hello world!!'])
    expect(out).toBe('Hello world!!\n')
  })

  it('treats near-prefix cumulative chunks as replacements', async () => {
    const out = await runStreamedSummary(['Hello world.', 'Hello world!'], {
      render: 'md',
      stdoutIsTty: true,
    })
    expect(out).toBe('Hello world!\n')
  })

  it('ignores regressions where a later chunk is a shorter prefix', async () => {
    const out = await runStreamedSummary(['Hello world', 'Hello'], {
      render: 'md',
      stdoutIsTty: true,
    })
    expect(out).toBe('Hello world\n')
  })

  it('merges overlapping suffix/prefix chunks without duplication', async () => {
    const out = await runStreamedSummary(['Hello world', 'world!'], {
      render: 'md',
      stdoutIsTty: true,
    })
    expect(out).toBe('Hello world!\n')
  })

  it('treats near-prefix edits as replacements (prefix threshold)', async () => {
    const prev = 'abcdefghijklmnopqrst'
    const next = 'abcdefghijklmnopqrsu'
    const out = await runStreamedSummary([prev, next], {
      render: 'md',
      stdoutIsTty: true,
    })
    expect(out).toBe(`${next}\n`)
  })
})
