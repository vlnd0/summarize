import { describe, expect, it, vi } from 'vitest'

import { MAX_OPENAI_UPLOAD_BYTES } from '../src/transcription/whisper.js'

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    if (_cmd !== 'ffmpeg' || !args.includes('-version')) {
      throw new Error(`Unexpected spawn: ${_cmd} ${args.join(' ')}`)
    }
    const handlers = new Map<string, (value?: any) => void>()
    const proc: any = {
      on(event: string, handler: (value?: any) => void) {
        handlers.set(event, handler)
        return proc
      },
    }
    queueMicrotask(() => handlers.get('close')?.(0))
    return proc
  },
}))

import { fetchTranscript } from '../src/content/link-preview/transcript/providers/podcast.js'

const baseOptions = {
  fetch: vi.fn() as unknown as typeof fetch,
  scrapeWithFirecrawl: null as unknown as ((...args: any[]) => any) | null,
  apifyApiToken: null,
  youtubeTranscriptMode: 'auto' as const,
  ytDlpPath: null,
  falApiKey: null,
  openaiApiKey: 'OPENAI',
  onProgress: null as any,
}

describe('podcast transcript provider - coverage paths', () => {
  it('transcribes Apple Podcasts streamUrl when present in HTML', async () => {
    const html = `<html><body><script>{"streamUrl":"https://example.com/episode.mp3"}</script></body></html>`

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === 'https://example.com/episode.mp3' && method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '1024' },
        })
      }
      if (url === 'https://example.com/episode.mp3' && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      }
      throw new Error(`Unexpected fetch: ${url} ${method}`)
    })

    const openaiFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const result = await fetchTranscript(
        { url: 'https://podcasts.apple.com/us/podcast/id123?i=456', html, resourceKey: null },
        { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch }
      )
      expect(result.text).toBe('ok')
      expect(result.metadata?.kind).toBe('apple_stream_url')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses iTunes lookup when Apple HTML is missing, picking newest episode when i= is absent', async () => {
    const lookupPayload = {
      results: [
        { wrapperType: 'track', kind: 'podcast', feedUrl: 'https://example.com/feed.xml' },
        {
          wrapperType: 'podcastEpisode',
          trackId: 111,
          episodeUrl: 'https://cdn.example.com/old.mp3',
          releaseDate: '2020-01-01T00:00:00Z',
          trackTimeMillis: 60_000,
        },
        {
          wrapperType: 'podcastEpisode',
          trackId: 222,
          episodeUrl: 'https://cdn.example.com/new.mp3',
          releaseDate: '2024-01-01T00:00:00Z',
          trackTimeMillis: 120_000,
        },
      ],
    }

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.startsWith('https://itunes.apple.com/lookup')) {
        return new Response(JSON.stringify(lookupPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://cdn.example.com/new.mp3' && method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '2048' },
        })
      }
      if (url === 'https://cdn.example.com/new.mp3' && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      }
      throw new Error(`Unexpected fetch: ${url} ${method}`)
    })

    const openaiFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const result = await fetchTranscript(
        { url: 'https://podcasts.apple.com/us/podcast/id123', html: null, resourceKey: null },
        { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch }
      )
      expect(result.text).toBe('ok')
      expect(result.metadata?.kind).toBe('apple_itunes_episode')
      expect(result.metadata?.episodeUrl).toBe('https://cdn.example.com/new.mp3')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to Firecrawl for Spotify embed success and prefers scdn audio URL', async () => {
    const embedHtml = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          state: {
            data: {
              entity: { title: 'Ep 1', subtitle: 'Show' },
              defaultAudioFileObject: {
                url: ['https://cdn.example.com/a.mp4', 'https://scdn.co/file.mp4'],
                format: 'DRM',
              },
            },
          },
        },
      },
    })}</script>`

    const scrapeWithFirecrawl = vi.fn(async () => ({ html: embedHtml, markdown: '' }))

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === 'https://open.spotify.com/embed/episode/abc') {
        return new Response('<html><body>captcha</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
      }
      if (url === 'https://scdn.co/file.mp4' && method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-type': 'audio/mp4', 'content-length': '1024' } })
      }
      if (url === 'https://scdn.co/file.mp4' && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mp4' } })
      }
      throw new Error(`Unexpected fetch: ${url} ${method}`)
    })

    const openaiFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const result = await fetchTranscript(
        { url: 'https://open.spotify.com/episode/abc', html: '<html/>', resourceKey: null },
        {
          ...baseOptions,
          fetch: fetchImpl as unknown as typeof fetch,
          scrapeWithFirecrawl: scrapeWithFirecrawl as unknown as typeof baseOptions.scrapeWithFirecrawl,
        }
      )
      expect(result.text).toBe('ok')
      expect(result.metadata?.kind).toBe('spotify_embed_audio')
      expect(String(result.metadata?.audioUrl)).toContain('scdn.co')
      expect(result.notes).toContain('Firecrawl')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('transcribes og:audio URLs and annotates them as preview clips', async () => {
    const html =
      '<!doctype html><html><head>' +
      '<meta property="og:audio" content="https://example.com/preview.mp3"/>' +
      '</head><body>ok</body></html>'

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === 'https://example.com/preview.mp3' && method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': String(MAX_OPENAI_UPLOAD_BYTES - 1) },
        })
      }
      if (url === 'https://example.com/preview.mp3' && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      }
      throw new Error(`Unexpected fetch: ${url} ${method}`)
    })

    const openaiFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    try {
      vi.stubGlobal('fetch', openaiFetch)
      const result = await fetchTranscript(
        { url: 'https://example.com/episode', html, resourceKey: null },
        { ...baseOptions, fetch: fetchImpl as unknown as typeof fetch }
      )
      expect(result.text).toBe('ok')
      expect(result.metadata?.kind).toBe('og_audio')
      expect(result.notes).toContain('preview clip')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
