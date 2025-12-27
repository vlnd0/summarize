import { describe, expect, it } from 'vitest'

import {
  resolveDaemonOutputLanguage,
  resolveDaemonSummaryLength,
} from '../src/daemon/request-settings.js'
import { resolveOutputLanguage } from '../src/language.js'

describe('daemon/request-settings', () => {
  it('defaults length to xl', () => {
    const resolved = resolveDaemonSummaryLength(undefined)
    expect(resolved.lengthArg).toEqual({ kind: 'preset', preset: 'xl' })
    expect(resolved.summaryLength).toBe('xl')
  })

  it('maps preset lengths', () => {
    const resolved = resolveDaemonSummaryLength('short')
    expect(resolved.lengthArg).toEqual({ kind: 'preset', preset: 'short' })
    expect(resolved.summaryLength).toBe('short')
  })

  it('supports custom character lengths', () => {
    const resolved = resolveDaemonSummaryLength('20k')
    expect(resolved.lengthArg).toEqual({ kind: 'chars', maxCharacters: 20000 })
    expect(resolved.summaryLength).toEqual({ maxCharacters: 20000 })
  })

  it('keeps fallback language when unset', () => {
    const fallback = resolveOutputLanguage('de')
    const resolved = resolveDaemonOutputLanguage({ raw: '', fallback })
    expect(resolved).toEqual(fallback)
  })

  it('overrides language when set', () => {
    const fallback = resolveOutputLanguage('de')
    const resolved = resolveDaemonOutputLanguage({ raw: 'en', fallback })
    expect(resolved).toEqual(resolveOutputLanguage('en'))
  })

  it('supports auto language override', () => {
    const fallback = resolveOutputLanguage('de')
    const resolved = resolveDaemonOutputLanguage({ raw: 'auto', fallback })
    expect(resolved).toEqual({ kind: 'auto' })
  })
})
