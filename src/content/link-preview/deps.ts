import type { CacheMode, TranscriptSource } from './types.js'

export interface FirecrawlScrapeResult {
  markdown: string
  html?: string | null
  metadata?: Record<string, unknown> | null
}

export type ScrapeWithFirecrawl = (
  url: string,
  options?: { cacheMode?: CacheMode; timeoutMs?: number }
) => Promise<FirecrawlScrapeResult | null>

export type ConvertHtmlToMarkdown = (args: {
  url: string
  html: string
  title: string | null
  siteName: string | null
  timeoutMs: number
}) => Promise<string>

export interface TranscriptCacheGetResult {
  content: string | null
  source: TranscriptSource | null
  expired: boolean
  metadata?: Record<string, unknown> | null
}

export interface TranscriptCacheSetArgs {
  url: string
  service: string
  resourceKey: string | null
  content: string | null
  source: TranscriptSource | null
  ttlMs: number
  metadata?: Record<string, unknown> | null
}

export interface TranscriptCache {
  get(args: { url: string }): Promise<TranscriptCacheGetResult | null>
  set(args: TranscriptCacheSetArgs): Promise<void>
}

export interface LinkPreviewDeps {
  fetch: typeof fetch
  scrapeWithFirecrawl: ScrapeWithFirecrawl | null
  apifyApiToken: string | null
  apifyYoutubeActor: string | null
  convertHtmlToMarkdown: ConvertHtmlToMarkdown | null
  transcriptCache: TranscriptCache | null
}
