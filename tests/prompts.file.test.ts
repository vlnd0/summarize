import { describe, expect, it } from 'vitest'

import { buildFileSummaryPrompt } from '../src/prompts/index.js'

describe('buildFileSummaryPrompt', () => {
  it('builds a prompt for preset length', () => {
    const prompt = buildFileSummaryPrompt({
      filename: 'paper.pdf',
      mediaType: 'application/pdf',
      summaryLength: 'short',
    })

    expect(prompt).toContain('Filename: paper.pdf')
    expect(prompt).toContain('Media type: application/pdf')
    expect(prompt).not.toContain('Target length:')
  })

  it('builds a prompt for soft character targets', () => {
    const prompt = buildFileSummaryPrompt({
      filename: null,
      mediaType: null,
      summaryLength: { maxCharacters: 20_000 },
    })

    expect(prompt).toContain('Target length:')
    expect(prompt).toContain('soft guideline')
    expect(prompt).not.toContain('Filename:')
    expect(prompt).not.toContain('Media type:')
  })
})
