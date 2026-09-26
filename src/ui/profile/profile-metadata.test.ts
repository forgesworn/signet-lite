import { describe, it, expect } from 'vitest'
import { buildKind0Content, parseKind0Content } from './profile-metadata.js'

describe('buildKind0Content', () => {
  it('writes non-empty managed fields and omits empty ones', () => {
    const json = buildKind0Content({ name: 'Mag', about: '', lud16: 'a@b.com', website: '   ' })
    expect(JSON.parse(json)).toEqual({ name: 'Mag', lud16: 'a@b.com' })
  })

  it('preserves unmanaged keys from the base, and drops a cleared managed field', () => {
    const base = { name: 'Old', banner: 'https://x/banner.png', display_name: 'Old D' }
    const json = buildKind0Content({ name: 'New', about: 'hi', picture: '' }, base)
    expect(JSON.parse(json)).toEqual({ name: 'New', banner: 'https://x/banner.png', display_name: 'Old D', about: 'hi' })
  })
})

describe('parseKind0Content', () => {
  it('extracts managed fields and returns the raw object', () => {
    const { metadata, raw } = parseKind0Content(JSON.stringify({ name: 'Mag', banner: 'b.png', nip05: 'm@d.com', n: 7 }))
    expect(metadata).toEqual({ name: 'Mag', nip05: 'm@d.com' })
    expect(raw).toEqual({ name: 'Mag', banner: 'b.png', nip05: 'm@d.com', n: 7 })
  })

  it('returns empties for invalid JSON', () => {
    expect(parseKind0Content('not json')).toEqual({ metadata: {}, raw: {} })
    expect(parseKind0Content('"a string"')).toEqual({ metadata: {}, raw: {} })
  })

  it('round-trips managed fields through parse → build, keeping unmanaged keys', () => {
    const original = JSON.stringify({ name: 'Mag', about: 'bio', banner: 'b.png' })
    const { metadata, raw } = parseKind0Content(original)
    const rebuilt = buildKind0Content({ ...metadata, about: 'edited' }, raw)
    expect(JSON.parse(rebuilt)).toEqual({ name: 'Mag', about: 'edited', banner: 'b.png' })
  })

  it('reads display_name into metadata', () => {
    const { metadata } = parseKind0Content(JSON.stringify({ name: 'donkey', display_name: 'TheCryptoDonkey' }))
    expect(metadata.display_name).toBe('TheCryptoDonkey')
    expect(metadata.name).toBe('donkey')
  })

  it('falls back to the camelCase displayName some clients use', () => {
    const { metadata } = parseKind0Content(JSON.stringify({ displayName: 'Camel Case' }))
    expect(metadata.display_name).toBe('Camel Case')
  })

  it('leaves display_name undefined when absent', () => {
    const { metadata } = parseKind0Content(JSON.stringify({ name: 'donkey' }))
    expect(metadata.display_name).toBeUndefined()
  })
})
