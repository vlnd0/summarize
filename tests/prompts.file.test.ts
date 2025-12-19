import { describe, expect, it } from 'vitest'

import { buildFileSummaryPrompt } from '../src/prompts/index.js'

describe('buildFileSummaryPrompt', () => {
  it('builds a prompt for preset length', () => {
    const res = buildFileSummaryPrompt({
      filename: 'paper.pdf',
      mediaType: 'application/pdf',
      summaryLength: 'short',
    })

    expect(res.maxOutputTokens).toBe(768)
    expect(res.prompt).toContain('Filename: paper.pdf')
    expect(res.prompt).toContain('Media type: application/pdf')
    expect(res.prompt).not.toContain('Target length:')
  })

  it('builds a prompt for soft character targets', () => {
    const res = buildFileSummaryPrompt({
      filename: null,
      mediaType: null,
      summaryLength: { maxCharacters: 20_000 },
    })

    expect(res.maxOutputTokens).toBeGreaterThan(0)
    expect(res.prompt).toContain('Target length:')
    expect(res.prompt).toContain('soft guideline')
    expect(res.prompt).not.toContain('Filename:')
    expect(res.prompt).not.toContain('Media type:')
  })
})
