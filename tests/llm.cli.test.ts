import fs from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { isCliDisabled, resolveCliBinary, runCliModel } from '../src/llm/cli.js'
import type { ExecFileFn } from '../src/markitdown.js'

const makeStub = (handler: (args: string[]) => { stdout?: string; stderr?: string }) => {
  const execFileStub: ExecFileFn = ((_cmd, args, _options, cb) => {
    const result = handler(args)
    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''
    if (cb) cb(null, stdout, stderr)
    return {
      stdin: {
        write: () => {},
        end: () => {},
      },
    } as unknown as ReturnType<ExecFileFn>
  }) as ExecFileFn
  return execFileStub
}

describe('runCliModel', () => {
  it('handles Claude JSON output and tool flags', async () => {
    const seen: string[][] = []
    const execFileImpl = makeStub((args) => {
      seen.push(args)
      return { stdout: JSON.stringify({ result: 'ok' }) }
    })
    const result = await runCliModel({
      provider: 'claude',
      prompt: 'Test',
      model: 'sonnet',
      allowTools: true,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    })
    expect(result.text).toBe('ok')
    expect(seen[0]?.includes('--tools')).toBe(true)
    expect(seen[0]?.includes('--dangerously-skip-permissions')).toBe(true)
  })

  it('handles Gemini JSON output and yolo flag', async () => {
    const seen: string[][] = []
    const execFileImpl = makeStub((args) => {
      seen.push(args)
      return { stdout: JSON.stringify({ response: 'ok' }) }
    })
    const result = await runCliModel({
      provider: 'gemini',
      prompt: 'Test',
      model: 'gemini-3-flash-preview',
      allowTools: true,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    })
    expect(result.text).toBe('ok')
    expect(seen[0]?.includes('--yolo')).toBe(true)
  })

  it('reads the Codex output file', async () => {
    const execFileImpl: ExecFileFn = ((_cmd, args, _options, cb) => {
      const outputIndex = args.indexOf('--output-last-message')
      const outputPath = outputIndex === -1 ? null : args[outputIndex + 1]
      if (!outputPath) {
        cb?.(new Error('missing output path'), '', '')
        return {
          stdin: { write: () => {}, end: () => {} },
        } as unknown as ReturnType<ExecFileFn>
      }
      void fs.writeFile(outputPath, 'ok', 'utf8').then(
        () => cb?.(null, '', ''),
        (error) => cb?.(error as Error, '', '')
      )
      return {
        stdin: { write: () => {}, end: () => {} },
      } as unknown as ReturnType<ExecFileFn>
    }) as ExecFileFn

    const result = await runCliModel({
      provider: 'codex',
      prompt: 'Test',
      model: 'gpt-5.2',
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    })
    expect(result.text).toBe('ok')
  })

  it('falls back to plain text output', async () => {
    const execFileImpl = makeStub(() => ({ stdout: 'plain text' }))
    const result = await runCliModel({
      provider: 'claude',
      prompt: 'Test',
      model: 'sonnet',
      allowTools: false,
      timeoutMs: 1000,
      env: {},
      execFileImpl,
      config: null,
    })
    expect(result.text).toBe('plain text')
  })

  it('throws on empty output', async () => {
    const execFileImpl = makeStub(() => ({ stdout: '   ' }))
    await expect(
      runCliModel({
        provider: 'gemini',
        prompt: 'Test',
        model: 'gemini-3-flash-preview',
        allowTools: false,
        timeoutMs: 1000,
        env: {},
        execFileImpl,
        config: null,
      })
    ).rejects.toThrow(/empty output/)
  })
})

describe('cli helpers', () => {
  it('resolves disabled providers', () => {
    expect(isCliDisabled('claude', null)).toBe(false)
    expect(isCliDisabled('codex', { enabled: ['claude'] })).toBe(true)
    expect(isCliDisabled('gemini', { enabled: ['gemini'] })).toBe(false)
  })

  it('resolves binaries', () => {
    expect(resolveCliBinary('claude', { claude: { binary: '/opt/claude' } }, {})).toBe(
      '/opt/claude'
    )
    expect(resolveCliBinary('codex', null, { SUMMARIZE_CLI_CODEX: '/opt/codex' })).toBe(
      '/opt/codex'
    )
  })
})
