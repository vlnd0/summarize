import { describe, expect, it } from 'vitest'

import {
  type AssetAttachment,
  assertAssetMediaTypeSupported,
  getTextContentFromAttachment,
  isTextLikeMediaType,
  isUnsupportedAttachmentError,
} from '../src/run/attachments.js'

describe('run/attachments', () => {
  it('detects unsupported attachment errors', () => {
    expect(isUnsupportedAttachmentError(null)).toBe(false)
    expect(isUnsupportedAttachmentError(new Error('Functionality not supported'))).toBe(true)
    expect(isUnsupportedAttachmentError({ name: 'UnsupportedFunctionalityError' })).toBe(true)
  })

  it('detects text-like media types', () => {
    expect(isTextLikeMediaType('text/plain')).toBe(true)
    expect(isTextLikeMediaType('application/json')).toBe(true)
    expect(isTextLikeMediaType('application/pdf')).toBe(false)
  })

  it('extracts text content from file attachments', () => {
    const a1 = {
      mediaType: 'application/json',
      part: { type: 'file', data: '{"ok":true}' },
      filename: 'a.json',
    } as unknown as AssetAttachment
    expect(getTextContentFromAttachment(a1)).toMatchObject({ content: '{"ok":true}' })

    const a2 = {
      mediaType: 'application/xml',
      part: { type: 'file', data: new TextEncoder().encode('<ok/>') },
      filename: 'a.xml',
    } as unknown as AssetAttachment
    expect(getTextContentFromAttachment(a2)?.content).toContain('<ok/>')

    const a3 = {
      mediaType: 'application/pdf',
      part: { type: 'file', data: 'x' },
    } as unknown as AssetAttachment
    expect(getTextContentFromAttachment(a3)).toBeNull()
  })

  it('rejects archive media types', () => {
    const zip = {
      mediaType: 'application/zip',
      part: { type: 'file', data: new Uint8Array([1]) },
    } as unknown as AssetAttachment
    expect(() => assertAssetMediaTypeSupported({ attachment: zip, sizeLabel: '1B' })).toThrow(
      /Unsupported file type/i
    )
  })
})
