import { describe, expect, it } from 'vitest'

import { UVX_TIP } from '../src/run/constants.js'
import { withUvxTip } from '../src/run/tips.js'

describe('run/tips', () => {
  it('keeps original error when uvx is available', () => {
    const err = withUvxTip('boom', { UVX_PATH: '/usr/local/bin/uvx' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('boom')
  })

  it('adds uvx tip when uvx is missing', () => {
    const original = new Error('no uvx')
    const err = withUvxTip(original, { PATH: '' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('no uvx')
    expect(err.message).toContain(UVX_TIP)
    expect((err as { cause?: unknown }).cause).toBe(original)
  })
})
