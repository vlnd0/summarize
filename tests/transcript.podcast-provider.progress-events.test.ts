import { describe, expect, it, vi } from 'vitest'

async function importPodcastProvider({
  ffmpegAvailable,
  maxUploadBytes = 1024,
  transcribePlan = 'bytes',
}: {
  ffmpegAvailable: boolean
  maxUploadBytes?: number
  transcribePlan?: 'bytes' | 'file'
}) {
  vi.resetModules()

  const transcribeMediaWithWhisper = vi.fn(async () => ({
    text: 'ok-bytes',
    provider: 'openai',
    error: null,
    notes: [],
  }))

  const transcribeMediaFileWithWhisper = vi.fn(async (args: any) => {
    if (transcribePlan === 'file') {
      args?.onProgress?.({ done: 0, total: 3 })
      args?.onProgress?.({ done: 1, total: 3 })
      args?.onProgress?.({ done: 2, total: 3 })
      args?.onProgress?.({ done: 3, total: 3 })
    }
    return { text: 'ok-file', provider: 'openai', error: null, notes: [] }
  })

  vi.doMock('../src/transcription/whisper.js', () => ({
    MAX_OPENAI_UPLOAD_BYTES: maxUploadBytes,
    isFfmpegAvailable: () => Promise.resolve(ffmpegAvailable),
    transcribeMediaWithWhisper,
    transcribeMediaFileWithWhisper,
  }))

  const mod = await import('../src/content/link-preview/transcript/providers/podcast.js')
  return { ...mod, transcribeMediaWithWhisper, transcribeMediaFileWithWhisper }
}

const baseOptions = {
  fetch: vi.fn() as unknown as typeof fetch,
  scrapeWithFirecrawl: null as unknown as ((...args: any[]) => any) | null,
  apifyApiToken: null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null as string | null,
  falApiKey: null as string | null,
  openaiApiKey: 'OPENAI' as string | null,
}

describe('podcast provider progress events', () => {
  it('emits download + whisper start events for capped downloads', async () => {
    const { fetchTranscript } = await importPodcastProvider({ ffmpegAvailable: false })
    const enclosureUrl = 'https://example.com/episode.mp3'
    const xml = `<rss><channel><item><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`

    const events: any[] = []
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': String(30 * 1024 * 1024) },
        })
      }
      expect(url).toBe(enclosureUrl)
      return new Response(new Uint8Array(80 * 1024), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
    })

    const result = await fetchTranscript(
      { url: 'https://example.com/feed.xml', html: xml, resourceKey: null },
      {
        ...baseOptions,
        fetch: fetchImpl as unknown as typeof fetch,
        onProgress: (e) => events.push(e),
      }
    )

    expect(result.source).toBe('whisper')
    expect(events.some((e) => e.kind === 'transcript-media-download-start')).toBe(true)
    expect(events.some((e) => e.kind === 'transcript-media-download-progress')).toBe(true)
    expect(events.some((e) => e.kind === 'transcript-media-download-done')).toBe(true)
    expect(events.some((e) => e.kind === 'transcript-whisper-start')).toBe(true)
  })

  it('forwards whisper segment progress during temp-file transcription', async () => {
    const { fetchTranscript } = await importPodcastProvider({
      ffmpegAvailable: true,
      maxUploadBytes: 10,
      transcribePlan: 'file',
    })
    const enclosureUrl = 'https://example.com/episode.mp3'
    const xml = `<rss><channel><item><enclosure url="${enclosureUrl}" type="audio/mpeg"/></item></channel></rss>`

    const events: any[] = []
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof _input === 'string' ? _input : _input instanceof URL ? _input.toString() : _input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': String(50) },
        })
      }
      expect(url).toBe(enclosureUrl)
      // force the temp-file branch by omitting Range support (and returning a larger body than MAX_OPENAI_UPLOAD_BYTES)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(20))
          controller.enqueue(new Uint8Array(20))
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    })

    const result = await fetchTranscript(
      { url: 'https://example.com/feed.xml', html: xml, resourceKey: null },
      {
        ...baseOptions,
        fetch: fetchImpl as unknown as typeof fetch,
        onProgress: (e) => events.push(e),
      }
    )

    expect(result.source).toBe('whisper')
    const progress = events.filter((e) => e.kind === 'transcript-whisper-progress')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.some((e) => e.done === 1 && e.total === 3)).toBe(true)
    expect(progress.some((e) => e.done === 3 && e.total === 3)).toBe(true)
  })
})

