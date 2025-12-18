import { fetchWithTimeout } from '../../../fetch-with-timeout.js'
import { normalizeApifyTranscript } from '../../normalize.js'
import { isRecord } from '../../utils.js'

const DEFAULT_APIFY_YOUTUBE_ACTOR = 'dB9f4B02ocpTICIEY'

type ApifyTranscriptItem = Record<string, unknown> & {
  transcript?: unknown
  transcriptText?: unknown
  text?: unknown
}

function normalizeApifyActorId(input: string | null): string {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return DEFAULT_APIFY_YOUTUBE_ACTOR
  if (raw.includes('~')) return raw
  const slashIndex = raw.indexOf('/')
  if (slashIndex > 0 && slashIndex < raw.length - 1) {
    return `${raw.slice(0, slashIndex)}~${raw.slice(slashIndex + 1)}`
  }
  return raw
}

export const fetchTranscriptWithApify = async (
  fetchImpl: typeof fetch,
  apifyApiToken: string | null,
  apifyYoutubeActor: string | null,
  url: string
): Promise<string | null> => {
  if (!apifyApiToken) {
    return null
  }

  const actor = normalizeApifyActorId(apifyYoutubeActor)

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${apifyApiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [url],
          includeTimestamps: 'No',
        }),
      },
      45_000
    )

    if (!response.ok) {
      return null
    }

    const payload = await response.json()
    if (!Array.isArray(payload)) {
      return null
    }

    for (const item of payload) {
      if (!isRecord(item)) {
        continue
      }
      const recordItem = item as ApifyTranscriptItem
      const normalized =
        normalizeApifyTranscript(recordItem.transcript) ??
        normalizeApifyTranscript(recordItem.transcriptText) ??
        normalizeApifyTranscript(recordItem.text)
      if (normalized) {
        return normalized
      }
    }

    return null
  } catch {
    return null
  }
}
