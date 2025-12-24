import { describe, expect, it } from 'vitest'

import { formatOutputLanguageInstruction, parseOutputLanguage } from '../src/language.js'

describe('output language', () => {
  it('parses auto', () => {
    expect(parseOutputLanguage('auto')).toEqual({ kind: 'auto' })
  })

  it('parses common aliases', () => {
    expect(parseOutputLanguage('en')).toEqual({ kind: 'fixed', tag: 'en', label: 'English' })
    expect(parseOutputLanguage('English')).toEqual({ kind: 'fixed', tag: 'en', label: 'English' })
    expect(parseOutputLanguage('de')).toEqual({ kind: 'fixed', tag: 'de', label: 'German' })
    expect(parseOutputLanguage('Deutsch')).toEqual({ kind: 'fixed', tag: 'de', label: 'German' })
    expect(parseOutputLanguage('pt-BR')).toEqual({
      kind: 'fixed',
      tag: 'pt-BR',
      label: 'Portuguese (Brazil)',
    })
  })

  it('normalizes BCP-47-ish tags', () => {
    expect(parseOutputLanguage('EN-us')).toEqual({ kind: 'fixed', tag: 'en-US', label: 'en-US' })
  })

  it('keeps natural language hints', () => {
    expect(parseOutputLanguage('German, formal')).toEqual({
      kind: 'fixed',
      tag: 'German, formal',
      label: 'German, formal',
    })
  })

  it('formats prompt instruction', () => {
    expect(formatOutputLanguageInstruction({ kind: 'auto' })).toMatch(/primary language/i)
    expect(formatOutputLanguageInstruction({ kind: 'fixed', tag: 'en', label: 'English' })).toBe(
      'Write the answer in English.'
    )
  })

  it('rejects empty', () => {
    expect(() => parseOutputLanguage('  ')).toThrow(/must not be empty/i)
  })
})

