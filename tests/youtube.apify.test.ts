import { describe, expect, it, vi } from 'vitest'

import { fetchTranscriptWithApify } from '../src/content/link-preview/transcript/providers/youtube/apify.js'

describe('YouTube Apify transcript provider', () => {
  it('returns null when token is missing', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }))
    expect(
      await fetchTranscriptWithApify(fetchMock as unknown as typeof fetch, null, null, 'url')
    ).toBeNull()
  })

  it('returns transcript from first matching transcript field', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url
      if (!url.includes('api.apify.com')) {
        throw new Error(`Unexpected fetch call: ${url}`)
      }
      expect((init?.method ?? '').toUpperCase()).toBe('POST')
      return Response.json(
        [{ transcriptText: '   ' }, { transcript: [{ text: ' Line 1 ' }, { text: 'Line 2' }] }],
        { status: 200 }
      )
    })

    expect(
      await fetchTranscriptWithApify(
        fetchMock as unknown as typeof fetch,
        'TOKEN',
        null,
        'https://youtu.be/x'
      )
    ).toBe('Line 1\nLine 2')
  })

  it('uses the configured actor id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.url
      expect(url).toContain('/v2/acts/peter~my-actor/run-sync-get-dataset-items')
      return Response.json([{ transcriptText: 'Ok' }], { status: 200 })
    })

    expect(
      await fetchTranscriptWithApify(
        fetchMock as unknown as typeof fetch,
        'TOKEN',
        'peter/my-actor',
        'https://youtu.be/x'
      )
    ).toBe('Ok')
  })

  it('returns null for non-2xx and non-array payloads', async () => {
    const fetchNotOk = vi.fn(async () => new Response('nope', { status: 401 }))
    expect(
      await fetchTranscriptWithApify(fetchNotOk as unknown as typeof fetch, 'TOKEN', null, 'url')
    ).toBeNull()

    const fetchNotArray = vi.fn(async () => Response.json({ ok: true }, { status: 200 }))
    expect(
      await fetchTranscriptWithApify(fetchNotArray as unknown as typeof fetch, 'TOKEN', null, 'url')
    ).toBeNull()
  })
})
