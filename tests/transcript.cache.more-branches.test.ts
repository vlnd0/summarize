import { describe, expect, it, vi } from 'vitest'

import { NEGATIVE_TTL_MS, DEFAULT_TTL_MS, mapCachedSource, readTranscriptCache, writeTranscriptCache } from '../src/content/link-preview/transcript/cache.js'

describe('transcript cache - more branches', () => {
  it('reads cache miss / bypass / expired / hit', async () => {
    const miss = await readTranscriptCache({ url: 'u', cacheMode: 'default', transcriptCache: null })
    expect(miss.cached).toBeNull()
    expect(miss.diagnostics.cacheStatus).toBe('miss')

    const cache = {
      get: vi.fn(async () => ({
        content: 'hi',
        source: 'youtubei',
        expired: false,
        metadata: { a: 1 },
      })),
      set: vi.fn(async () => {}),
    }

    const bypass = await readTranscriptCache({ url: 'u', cacheMode: 'bypass', transcriptCache: cache as any })
    expect(bypass.cached).not.toBeNull()
    expect(bypass.resolution).toBeNull()
    expect(bypass.diagnostics.cacheStatus).toBe('bypassed')
    expect(bypass.diagnostics.notes).toContain('Cache bypass requested')

    cache.get.mockResolvedValueOnce({
      content: 'hi',
      source: 'captionTracks',
      expired: true,
      metadata: null,
    })
    const expired = await readTranscriptCache({ url: 'u', cacheMode: 'default', transcriptCache: cache as any })
    expect(expired.diagnostics.cacheStatus).toBe('expired')
    expect(expired.resolution).toBeNull()

    cache.get.mockResolvedValueOnce({
      content: 'hi',
      source: 'captionTracks',
      expired: false,
      metadata: null,
    })
    const hit = await readTranscriptCache({ url: 'u', cacheMode: 'default', transcriptCache: cache as any })
    expect(hit.diagnostics.cacheStatus).toBe('hit')
    expect(hit.resolution?.text).toBe('hi')
    expect(hit.resolution?.source).toBe('captionTracks')

    cache.get.mockResolvedValueOnce({
      content: '',
      source: 'weird',
      expired: false,
      metadata: null,
    })
    const empty = await readTranscriptCache({ url: 'u', cacheMode: 'default', transcriptCache: cache as any })
    expect(empty.diagnostics.textProvided).toBe(false)
    expect(empty.resolution?.source).toBe('unknown')
  })

  it('maps cached sources, including unknown values', () => {
    expect(mapCachedSource(null)).toBeNull()
    expect(mapCachedSource('yt-dlp')).toBe('yt-dlp')
    expect(mapCachedSource('weird')).toBe('unknown')
  })

  it('writes cache entries with correct TTL + resolved source', async () => {
    const cache = { set: vi.fn(async () => {}) }

    await writeTranscriptCache({
      url: 'u',
      service: 'svc',
      resourceKey: null,
      result: { text: 'hi', source: 'youtubei' },
      transcriptCache: null,
    })

    await writeTranscriptCache({
      url: 'u',
      service: 'svc',
      resourceKey: null,
      result: { text: null, source: null },
      transcriptCache: cache as any,
    })
    expect(cache.set).not.toHaveBeenCalled()

    await writeTranscriptCache({
      url: 'u',
      service: 'svc',
      resourceKey: null,
      result: { text: null, source: 'youtubei' },
      transcriptCache: cache as any,
    })
    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ ttlMs: NEGATIVE_TTL_MS, source: 'youtubei', content: null })
    )

    await writeTranscriptCache({
      url: 'u',
      service: 'svc',
      resourceKey: null,
      result: { text: 'hi', source: null, metadata: { x: 1 } },
      transcriptCache: cache as any,
    })
    expect(cache.set).toHaveBeenCalledWith(
      expect.objectContaining({ ttlMs: DEFAULT_TTL_MS, source: 'unknown', content: 'hi', metadata: { x: 1 } })
    )
  })
})
