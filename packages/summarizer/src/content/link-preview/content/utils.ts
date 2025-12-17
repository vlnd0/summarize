import type { TranscriptDiagnostics } from '../types.js'
import { normalizeCandidate, normalizeForPrompt } from './cleaner.js'
import {
  DEFAULT_TIMEOUT_MS,
  type ExtractedLinkContent,
  type FetchLinkContentOptions,
  type FinalizationArguments,
  type FirecrawlMode,
  type TranscriptResolution,
} from './types.js'

const WWW_PREFIX_PATTERN = /^www\./i
const TRANSCRIPT_LINE_SPLIT_PATTERN = /\r?\n/
const WORD_SPLIT_PATTERN = /\s+/g

export function resolveTimeoutMs(options?: FetchLinkContentOptions): number {
  const candidate = options?.timeoutMs
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.floor(candidate)
}

export function resolveFirecrawlMode(options?: FetchLinkContentOptions): FirecrawlMode {
  const candidate = options?.firecrawl
  if (candidate === 'off' || candidate === 'auto' || candidate === 'always') {
    return candidate
  }
  return 'auto'
}

export function appendNote(existing: string | null | undefined, next: string): string {
  if (!next) {
    return existing ?? ''
  }
  if (!existing || existing.length === 0) {
    return next
  }
  return `${existing}; ${next}`
}

export function safeHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(WWW_PREFIX_PATTERN, '')
  } catch {
    return null
  }
}

export function pickFirstText(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate)
    if (normalized) {
      return normalized
    }
  }
  return null
}

export function selectBaseContent(sourceContent: string, transcriptText: string | null): string {
  if (!transcriptText) {
    return sourceContent
  }
  const normalizedTranscript = normalizeForPrompt(transcriptText)
  if (normalizedTranscript.length === 0) {
    return sourceContent
  }
  return `Transcript:\n${normalizedTranscript}`
}

export function summarizeTranscript(transcriptText: string | null) {
  if (!transcriptText) {
    return { transcriptCharacters: null, transcriptLines: null }
  }
  const transcriptCharacters = transcriptText.length > 0 ? transcriptText.length : null
  const transcriptLinesRaw = transcriptText
    .split(TRANSCRIPT_LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length
  const transcriptLines = transcriptLinesRaw > 0 ? transcriptLinesRaw : null
  return { transcriptCharacters, transcriptLines }
}

export function ensureTranscriptDiagnostics(
  resolution: TranscriptResolution
): TranscriptDiagnostics {
  if (resolution.diagnostics) {
    return resolution.diagnostics
  }
  const hasText = typeof resolution.text === 'string' && resolution.text.length > 0
  return {
    textProvided: hasText,
    provider: resolution.source,
    attemptedProviders: resolution.source ? [resolution.source] : [],
  }
}

export function finalizeExtractedLinkContent({
  url,
  baseContent,
  title,
  description,
  siteName,
  transcriptResolution,
  diagnostics,
}: FinalizationArguments): ExtractedLinkContent {
  const content = normalizeForPrompt(baseContent)
  const totalCharacters = content.length
  const wordCount =
    content.length > 0
      ? content
          .split(WORD_SPLIT_PATTERN)
          .map((value) => value.trim())
          .filter((value) => value.length > 0).length
      : 0
  const { transcriptCharacters, transcriptLines } = summarizeTranscript(transcriptResolution.text)

  return {
    url,
    title,
    description,
    siteName,
    content,
    totalCharacters,
    wordCount,
    transcriptCharacters,
    transcriptLines,
    transcriptSource: transcriptResolution.source,
    diagnostics,
  }
}
