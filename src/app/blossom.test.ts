import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildUploadAuth, normaliseBlossomServer, sha256Hex, uploadBlob } from './blossom.js'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'

describe('buildUploadAuth', () => {
  it('builds a kind-24242 upload auth bound to the blob hash, with a future expiration', () => {
    const tmpl = buildUploadAuth('abcd', 1000)
    expect(tmpl.kind).toBe(24242)
    expect(tmpl.created_at).toBe(1000)
    expect(tmpl.tags).toContainEqual(['t', 'upload'])
    expect(tmpl.tags).toContainEqual(['x', 'abcd'])
    const exp = tmpl.tags!.find(t => t[0] === 'expiration')!
    expect(Number(exp[1])).toBeGreaterThan(1000)
  })
})

describe('sha256Hex', () => {
  it('hashes bytes to lowercase hex (known vector for "abc")', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc'))
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('uploadBlob', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('signs a 24242 auth, PUTs the blob with the Nostr auth header, and returns the hosted URL', async () => {
    const hash = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
    const sk = generateSecretKey()
    const sign = vi.fn((tmpl: { kind: number; created_at?: number; tags?: string[][]; content: string }) =>
      finalizeEvent({ kind: tmpl.kind, created_at: tmpl.created_at ?? 0, tags: tmpl.tags ?? [], content: tmpl.content }, sk))

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ url: `https://blossom.band/${hash}.png`, sha256: hash }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const res = await uploadBlob('https://blossom.band/', blob, sign, 1000)

    expect(res.url).toBe(`https://blossom.band/${hash}.png`)
    expect(res.sha256).toBe(hash)
    // PUT to <server>/upload (trailing slash trimmed)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://blossom.band/upload')
    expect(init!.method).toBe('PUT')
    expect(String((init!.headers as Record<string, string>).Authorization)).toMatch(/^Nostr [A-Za-z0-9+/=]+$/)
    // The signer was asked for a valid kind-24242 auth event.
    expect(sign).toHaveBeenCalledOnce()
    expect(sign.mock.calls[0][0].kind).toBe(24242)
  })

  it('normalises safe Blossom servers and rejects unsafe ones', () => {
    expect(normaliseBlossomServer('https://blossom.band/')).toBe('https://blossom.band')
    expect(normaliseBlossomServer('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
    expect(() => normaliseBlossomServer('http://example.com')).toThrow(/invalid image server/i)
    expect(() => normaliseBlossomServer('https://user:pass@example.com')).toThrow(/invalid image server/i)
    expect(() => normaliseBlossomServer('javascript:alert(1)')).toThrow(/invalid image server/i)
  })

  it('rejects a hosted URL with an unsafe scheme', async () => {
    const sk = generateSecretKey()
    const sign = (tmpl: { kind: number; created_at?: number; tags?: string[][]; content: string }) =>
      finalizeEvent({ kind: tmpl.kind, created_at: tmpl.created_at ?? 0, tags: tmpl.tags ?? [], content: tmpl.content }, sk)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'http://evil.example/avatar.png' }), { status: 200 })))
    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' })
    await expect(uploadBlob('https://blossom.band', blob, sign, 1000)).rejects.toThrow(/unsafe url/i)
  })

  it('rejects a mismatched returned hash', async () => {
    const sk = generateSecretKey()
    const sign = (tmpl: { kind: number; created_at?: number; tags?: string[][]; content: string }) =>
      finalizeEvent({ kind: tmpl.kind, created_at: tmpl.created_at ?? 0, tags: tmpl.tags ?? [], content: tmpl.content }, sk)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'https://blossom.band/avatar.png', sha256: 'deadbeef' }), { status: 200 })))
    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' })
    await expect(uploadBlob('https://blossom.band', blob, sign, 1000)).rejects.toThrow(/mismatched hash/i)
  })

  it('throws a friendly error when the server rejects the upload', async () => {
    const sk = generateSecretKey()
    const sign = (tmpl: { kind: number; created_at?: number; tags?: string[][]; content: string }) =>
      finalizeEvent({ kind: tmpl.kind, created_at: tmpl.created_at ?? 0, tags: tmpl.tags ?? [], content: tmpl.content }, sk)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' })
    await expect(uploadBlob('https://blossom.band', blob, sign, 1000)).rejects.toThrow(/upload failed \(401\)/i)
  })
})
