import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile, truncate, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const falMocks = vi.hoisted(() => ({
  createFalClient: vi.fn(),
}))

vi.mock('@fal-ai/client', () => ({
  createFalClient: falMocks.createFalClient,
}))

describe('transcription/whisper', () => {
  const importWhisperWithNoFfmpeg = async () => {
    // Make tests stable across machines: don’t invoke real ffmpeg.
    vi.resetModules()
    vi.doMock('node:child_process', () => ({
      spawn: () => {
        const handlers = new Map<string, (value?: any) => void>()
        const proc: any = {
          on(event: string, handler: (value?: any) => void) {
            handlers.set(event, handler)
            if (event === 'error') queueMicrotask(() => handler(new Error('spawn ENOENT')))
            return proc
          },
        }
        return proc
      },
    }))
    return await import('../src/transcription/whisper.js')
  }

  const importWhisperWithMockFfmpeg = async ({
    segmentPlan = 'two-parts',
  }: {
    segmentPlan?: 'two-parts' | 'no-parts'
  } = {}) => {
    vi.resetModules()
    vi.doMock('node:child_process', () => ({
      spawn: (_cmd: string, args: string[]) => {
        if (_cmd !== 'ffmpeg') throw new Error(`Unexpected spawn: ${_cmd}`)

        const stderr = new EventEmitter() as any
        stderr.setEncoding = () => {}

        const handlers = new Map<string, (value?: any) => void>()
        const proc: any = {
          stderr,
          on(event: string, handler: (value?: any) => void) {
            handlers.set(event, handler)
            return proc
          },
        }

        const close = (code: number) => queueMicrotask(() => handlers.get('close')?.(code))

        // ffmpeg -version
        if (args.includes('-version')) {
          close(0)
          return proc
        }

        // Segmenter: last arg is output pattern
        if (args.includes('-f') && args.includes('segment')) {
          const pattern = args[args.length - 1] ?? ''
          ;(async () => {
            if (segmentPlan === 'two-parts') {
              const part0 = pattern.replace('%03d', '000')
              const part1 = pattern.replace('%03d', '001')
              await writeFile(part0, new Uint8Array([1, 2, 3]))
              await writeFile(part1, new Uint8Array([4, 5, 6]))
            }
          })()
            .then(() => close(0))
            .catch((error) => {
              queueMicrotask(() => handlers.get('error')?.(error))
              close(1)
            })
          return proc
        }

        // Transcode: last arg is output file
        const output = args[args.length - 1] ?? ''
        ;(async () => {
          if (output) await writeFile(output, new Uint8Array([9, 9, 9]))
        })()
          .then(() => close(0))
          .catch((error) => {
            queueMicrotask(() => handlers.get('error')?.(error))
            close(1)
          })
        return proc
      },
    }))
    return await import('../src/transcription/whisper.js')
  }

  it('maps media types to filename extensions for Whisper format detection', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('file') as any
      expect(file.name).toBe('audio.ogg')
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', fetchMock)
      const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/ogg',
        filename: 'audio',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
      })

      expect(result.text).toBe('ok')
      expect(result.provider).toBe('openai')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns an error when no transcription keys are provided', async () => {
    const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/mpeg',
      filename: 'audio.mp3',
      openaiApiKey: null,
      falApiKey: null,
    })

    expect(result.text).toBeNull()
    expect(result.provider).toBeNull()
    expect(result.error?.message).toContain('OPENAI_API_KEY or FAL_KEY')
  })

  it('calls OpenAI Whisper and preserves/ensures a filename extension', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as unknown
      expect(body).toBeInstanceOf(FormData)

      const form = body as FormData
      expect(form.get('model')).toBe('whisper-1')

      const file = form.get('file') as any
      expect(file).toBeTruthy()
      expect(typeof file.name).toBe('string')
      expect(file.name).toBe('clip.mp4')

      return new Response(JSON.stringify({ text: 'hello' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', fetchMock)
      const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')

      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'video/mp4',
        filename: 'clip',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
      })

      expect(result.text).toBe('hello')
      expect(result.provider).toBe('openai')
      expect(result.error).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns an OpenAI error when the payload has no usable text', async () => {
    const openaiFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ foo: 'bar' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/mpeg',
        filename: 'audio.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
      })

      expect(result.text).toBeNull()
      expect(result.provider).toBe('openai')
      expect(result.error?.message).toContain('empty text')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to FAL for audio when OpenAI fails (and truncates long error details)', async () => {
    const longError = 'x'.repeat(300)
    const openaiFetch = vi.fn(async () => {
      return new Response(longError, { status: 400, headers: { 'content-type': 'text/plain' } })
    })

    falMocks.createFalClient.mockReset().mockReturnValue({
      storage: {
        upload: vi.fn(async () => 'https://fal.example/audio'),
      },
      subscribe: vi.fn(async () => ({
        data: { chunks: [{ text: 'hello' }, { text: 'world' }] },
      })),
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')

      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/mpeg',
        filename: 'audio.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: 'FAL',
      })

      expect(result.text).toBe('hello world')
      expect(result.provider).toBe('fal')
      expect(result.notes.join(' ')).toContain('falling back to FAL')
      expect(result.notes.join(' ')).toContain('OpenAI transcription failed')
      expect(result.notes.join(' ')).toContain('…')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('suggests ffmpeg transcoding when OpenAI cannot decode media', async () => {
    const openaiFetch = vi.fn(async () => {
      return new Response('unrecognized file format', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      })
    })

    falMocks.createFalClient.mockReset().mockReturnValue({
      storage: {
        upload: vi.fn(async () => 'https://fal.example/audio'),
      },
      subscribe: vi.fn(async () => ({ data: { text: 'fallback ok' } })),
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const whisper = await importWhisperWithNoFfmpeg()

      const result = await whisper.transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/mpeg',
        filename: 'audio.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: 'FAL',
      })

      expect(result.text).toBe('fallback ok')
      expect(result.provider).toBe('fal')
      expect(result.notes.join(' ')).toContain('install ffmpeg')
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('node:child_process')
      vi.restoreAllMocks()
    }
  })

  it('wraps non-Error OpenAI failures', async () => {
    const openaiFetch = vi.fn(async () => {
      throw 'boom'
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
      const result = await transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/mpeg',
        filename: 'audio.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
      })

      expect(result.text).toBeNull()
      expect(result.error?.message).toContain('OpenAI transcription failed: boom')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('chunks oversized files via ffmpeg and concatenates transcripts', async () => {
    const whisper = await importWhisperWithMockFfmpeg({ segmentPlan: 'two-parts' })
    const dir = await mkdtemp(join(tmpdir(), 'summarize-whisper-test-'))
    const path = join(dir, 'input.bin')

    // Sparse file: huge stat size, tiny actual data.
    await writeFile(path, new Uint8Array([1, 2, 3]))
    await truncate(path, whisper.MAX_OPENAI_UPLOAD_BYTES + 1)

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('file') as any
      return new Response(JSON.stringify({ text: `T:${file.name}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', fetchMock)
      const onProgress = vi.fn()
      const result = await whisper.transcribeMediaFileWithWhisper({
        filePath: path,
        mediaType: 'audio/mpeg',
        filename: 'input.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
        segmentSeconds: 1,
        onProgress,
      })

      expect(result.text).toContain('T:part-000.mp3')
      expect(result.text).toContain('T:part-001.mp3')
      expect(result.text).toContain('\n\n')
      expect(result.notes.join(' ')).toContain('ffmpeg chunked media into 2 parts')
      expect(onProgress).toHaveBeenCalledWith({
        partIndex: null,
        parts: 2,
        processedDurationSeconds: null,
        totalDurationSeconds: null,
      })
      expect(onProgress).toHaveBeenCalledWith({
        partIndex: 1,
        parts: 2,
        processedDurationSeconds: null,
        totalDurationSeconds: null,
      })
      expect(onProgress).toHaveBeenCalledWith({
        partIndex: 2,
        parts: 2,
        processedDurationSeconds: null,
        totalDurationSeconds: null,
      })
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('node:child_process')
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports an error when ffmpeg produces no segments', async () => {
    const whisper = await importWhisperWithMockFfmpeg({ segmentPlan: 'no-parts' })
    const dir = await mkdtemp(join(tmpdir(), 'summarize-whisper-test-'))
    const path = join(dir, 'input.bin')
    await writeFile(path, new Uint8Array([1, 2, 3]))
    await truncate(path, whisper.MAX_OPENAI_UPLOAD_BYTES + 1)

    try {
      const result = await whisper.transcribeMediaFileWithWhisper({
        filePath: path,
        mediaType: 'audio/mpeg',
        filename: 'input.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
        segmentSeconds: 1,
      })

      expect(result.text).toBeNull()
      expect(result.error?.message).toContain('ffmpeg produced no audio segments')
    } finally {
      vi.doUnmock('node:child_process')
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('transcribeMediaFileWithWhisper returns an error when no transcription keys are provided', async () => {
    const { transcribeMediaFileWithWhisper } = await import('../src/transcription/whisper.js')
    const dir = await mkdtemp(join(tmpdir(), 'summarize-whisper-test-'))
    const path = join(dir, 'input.bin')
    await writeFile(path, new Uint8Array([1, 2, 3]))
    try {
      const result = await transcribeMediaFileWithWhisper({
        filePath: path,
        mediaType: 'audio/mpeg',
        filename: 'input.mp3',
        openaiApiKey: null,
        falApiKey: null,
      })
      expect(result.text).toBeNull()
      expect(result.error?.message).toContain('OPENAI_API_KEY or FAL_KEY')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to partial reads when ffmpeg is missing for oversized files', async () => {
    const whisper = await importWhisperWithNoFfmpeg()
    const dir = await mkdtemp(join(tmpdir(), 'summarize-whisper-test-'))
    const path = join(dir, 'input.bin')
    await writeFile(path, new Uint8Array([1, 2, 3]))
    await truncate(path, whisper.MAX_OPENAI_UPLOAD_BYTES + 1)

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', fetchMock)
      const result = await whisper.transcribeMediaFileWithWhisper({
        filePath: path,
        mediaType: 'audio/mpeg',
        filename: 'input.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
      })

      expect(result.text).toBe('ok')
      expect(result.notes.join(' ')).toContain('install ffmpeg to enable chunked transcription')
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('node:child_process')
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('retries OpenAI decode failures by transcoding via ffmpeg', async () => {
    const whisper = await importWhisperWithMockFfmpeg()
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return new Response('could not be decoded', { status: 400, headers: { 'content-type': 'text/plain' } })
      }
      return new Response(JSON.stringify({ text: 'after transcode' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', fetchMock)
      const result = await whisper.transcribeMediaWithWhisper({
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: 'video/mp4',
        filename: 'bad.mp4',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
      })

      expect(result.text).toBe('after transcode')
      expect(result.notes.join(' ')).toContain('transcoding via ffmpeg and retrying')
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('node:child_process')
    }
  })

  it('skips FAL for non-audio media types', async () => {
    const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'video/mp4',
      filename: 'video.mp4',
      openaiApiKey: null,
      falApiKey: 'FAL',
    })

    expect(result.text).toBeNull()
    expect(result.provider).toBeNull()
    expect(result.error?.message).toContain('No transcription providers available')
    expect(result.notes.join(' ')).toContain('Skipping FAL transcription')
  })

  it('notes when OpenAI upload is too large and ffmpeg is missing (truncates bytes)', async () => {
    const whisper = await importWhisperWithNoFfmpeg()
    const openaiFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('file') as any
      expect(file.size).toBe(whisper.MAX_OPENAI_UPLOAD_BYTES)
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const big = new Uint8Array(whisper.MAX_OPENAI_UPLOAD_BYTES + 1)

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const result = await whisper.transcribeMediaWithWhisper({
        bytes: big,
        mediaType: 'audio/mpeg',
        filename: 'audio.mp3',
        openaiApiKey: 'OPENAI',
        falApiKey: null,
      })

      expect(result.text).toBe('ok')
      expect(result.provider).toBe('openai')
      expect(result.notes.join(' ')).toContain('Media too large for Whisper upload')
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('node:child_process')
      vi.restoreAllMocks()
    }
  })

  it('returns a helpful error when FAL returns empty content', async () => {
    falMocks.createFalClient.mockReset().mockReturnValue({
      storage: {
        upload: vi.fn(async () => 'https://fal.example/audio'),
      },
      subscribe: vi.fn(async () => ({
        data: { text: '' },
      })),
    })

    const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/mpeg',
      filename: 'audio.mp3',
      openaiApiKey: null,
      falApiKey: 'FAL',
    })

    expect(result.text).toBeNull()
    expect(result.provider).toBe('fal')
    expect(result.error?.message).toContain('FAL transcription returned empty text')
  })

  it('extracts FAL text from data.text', async () => {
    falMocks.createFalClient.mockReset().mockReturnValue({
      storage: { upload: vi.fn(async () => 'https://fal.example/audio') },
      subscribe: vi.fn(async () => ({ data: { text: '  hello fal  ' } })),
    })

    const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
    const result = await transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/mpeg',
      filename: 'audio.mp3',
      openaiApiKey: null,
      falApiKey: 'FAL',
    })

    expect(result.text).toBe('hello fal')
    expect(result.provider).toBe('fal')
    expect(result.error).toBeNull()
  })

  it('times out FAL subscriptions', async () => {
    vi.useFakeTimers()
    falMocks.createFalClient.mockReset().mockReturnValue({
      storage: { upload: vi.fn(async () => 'https://fal.example/audio') },
      subscribe: vi.fn(async () => new Promise(() => {})),
    })

    const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
    const promise = transcribeMediaWithWhisper({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/mpeg',
      filename: 'audio.mp3',
      openaiApiKey: null,
      falApiKey: 'FAL',
    })

    await vi.advanceTimersByTimeAsync(600_000)
    const result = await promise

    expect(result.text).toBeNull()
    expect(result.provider).toBe('fal')
    expect(result.error?.message.toLowerCase()).toContain('timeout')
    vi.useRealTimers()
  })

  it('maps additional media types to stable Whisper filename extensions', async () => {
    const cases = [
      { mediaType: 'audio/x-wav', expected: 'clip.wav' },
      { mediaType: 'audio/flac', expected: 'clip.flac' },
      { mediaType: 'audio/webm', expected: 'clip.webm' },
      { mediaType: 'video/webm', expected: 'clip.webm' },
      { mediaType: 'audio/mpga', expected: 'clip.mp3' },
      { mediaType: 'audio/mp4', expected: 'clip.mp4' },
      { mediaType: 'application/mp4', expected: 'clip.mp4' },
      { mediaType: 'application/ogg', expected: 'clip.ogg' },
      { mediaType: 'audio/oga', expected: 'clip.ogg' },
    ] as const

    for (const c of cases) {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const form = init?.body as FormData
        const file = form.get('file') as any
        expect(file.name).toBe(c.expected)
        return new Response(JSON.stringify({ text: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      try {
        vi.stubGlobal('fetch', fetchMock)
        const { transcribeMediaWithWhisper } = await import('../src/transcription/whisper.js')
        const result = await transcribeMediaWithWhisper({
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: c.mediaType,
          filename: 'clip',
          openaiApiKey: 'OPENAI',
          falApiKey: null,
        })
        expect(result.text).toBe('ok')
      } finally {
        vi.unstubAllGlobals()
      }
    }
  })
})
