import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The meta CSP is the local fallback. The deploy-time HTTP header in public/_headers is the
// stronger policy because it can enforce frame-ancestors and browser security headers.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const csp = html.match(/Content-Security-Policy"\s*content="([^"]+)"/)?.[1] ?? ''
const headersFile = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
const directive = (name: string) =>
  csp.split(';').map(d => d.trim()).find(d => d.startsWith(name + ' ')) ?? ''
const header = (name: string) => {
  const found = headersFile
    .split('\n')
    .map(line => line.trim())
    .find(line => line.toLowerCase().startsWith(name.toLowerCase() + ':'))
  return found?.slice(found.indexOf(':') + 1).trim() ?? ''
}
const headerDirective = (name: string) =>
  header('Content-Security-Policy').split(';').map(d => d.trim()).find(d => d.startsWith(name + ' ')) ?? ''

describe('Content-Security-Policy img-src', () => {
  it('permits remote https images so kind 0 avatars render', () => {
    expect(directive('img-src')).toContain('https:')
  })

  it('still permits local data: and blob: sources for uploaded avatars and QR codes', () => {
    expect(directive('img-src')).toContain('data:')
    expect(directive('img-src')).toContain('blob:')
  })
})

describe('Content-Security-Policy connect-src and worker-src', () => {
  it('drops bare ws: but keeps wss:, loopback ws, and https:', () => {
    const c = directive('connect-src')
    expect(c).toContain('wss:')
    expect(c).toContain('https:')
    expect(c).toContain('ws://localhost:*')
    expect(c).toContain('ws://127.0.0.1:*')
    // no bare "ws:" scheme token (would match a plaintext WebSocket to any host)
    expect(c.split(/\s+/)).not.toContain('ws:')
  })
  it('allows the service worker script via worker-src', () => {
    expect(directive('worker-src')).toContain("'self'")
  })
})

describe('deployment security headers', () => {
  it('ships an HTTP CSP with frame protection', () => {
    expect(headersFile).toContain('/*')
    expect(headerDirective('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(headerDirective('object-src')).toBe("object-src 'none'")
    expect(headerDirective('base-uri')).toBe("base-uri 'none'")
  })

  it('ships standard browser hardening headers', () => {
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('Strict-Transport-Security')).toContain('max-age=31536000')
    expect(header('Referrer-Policy')).toBe('no-referrer')
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('Permissions-Policy')).toContain('camera=(self)')
  })

  it('forces the service worker to revalidate promptly after a deploy', () => {
    expect(headersFile).toContain('/sw.js')
    expect(headersFile).toContain('Cache-Control: no-cache, no-store, must-revalidate')
  })
})
