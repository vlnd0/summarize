import type { Settings } from './settings'

export type ExtractedPage = {
  url: string
  title: string | null
  text: string
  truncated: boolean
}

export function buildDaemonRequestBody({
  extracted,
  settings,
}: {
  extracted: ExtractedPage
  settings: Settings
}): Record<string, unknown> {
  return {
    url: extracted.url,
    title: extracted.title,
    text: extracted.text,
    truncated: extracted.truncated,
    model: settings.model,
    length: settings.length,
    language: settings.language,
    mode: 'auto',
    maxCharacters: settings.maxChars,
  }
}
