import type { LengthArg } from '../flags.js'
import { parseLengthArg } from '../flags.js'
import type { OutputLanguage } from '../language.js'
import { resolveOutputLanguage } from '../language.js'
import type { SummaryLengthTarget } from '../prompts/index.js'

export function resolveDaemonSummaryLength(raw: unknown): {
  lengthArg: LengthArg
  summaryLength: SummaryLengthTarget
} {
  const value = typeof raw === 'string' ? raw.trim() : ''
  const lengthArg = parseLengthArg(value || 'xl')
  const summaryLength =
    lengthArg.kind === 'preset' ? lengthArg.preset : { maxCharacters: lengthArg.maxCharacters }
  return { lengthArg, summaryLength }
}

export function resolveDaemonOutputLanguage({
  raw,
  fallback,
}: {
  raw: unknown
  fallback: OutputLanguage
}): OutputLanguage {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return fallback
  return resolveOutputLanguage(value)
}
