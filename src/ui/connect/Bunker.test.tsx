// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import jsQR from 'jsqr'
import { encode } from '@forgesworn/qr'
import { Bunker } from './Bunker'

/** Rasterises the QR's SVG data URL (one `M x y h w v1 h -w z` run per dark row segment) at 4 px a module. */
function readQrImage(src: string): { text: string | undefined; modules: number } {
  const svg = decodeURIComponent(src.slice(src.indexOf(',') + 1))
  const side = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)![1])
  const scale = 4
  const px = side * scale
  const pixels = new Uint8ClampedArray(px * px * 4).fill(255)
  for (const [, x, y, w] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
    for (let row = Number(y) * scale; row < (Number(y) + 1) * scale; row++) {
      for (let col = Number(x) * scale; col < (Number(x) + Number(w)) * scale; col++) {
        const i = (row * px + col) * 4
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
      }
    }
  }
  return { text: jsQR(pixels, px, px)?.data, modules: side }
}

afterEach(cleanup)

const SAMPLE_URI = 'bunker://abcdef1234?relay=wss%3A%2F%2Frelay.example.com&secret=abc123'

describe('Bunker', () => {
  it('shows the bunker URI and a Copy button', () => {
    render(<Bunker uri={SAMPLE_URI} onManageApps={() => {}} onDone={() => {}} />)
    expect(screen.getByTestId('bunker-uri')).toHaveTextContent(SAMPLE_URI)
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('renders a QR that a decoder reads back as the bunker URI, with a four-module quiet zone', async () => {
    render(<Bunker uri={SAMPLE_URI} onManageApps={() => {}} onDone={() => {}} />)
    const img = await screen.findByAltText('bunker QR')
    const { text, modules } = readQrImage(img.getAttribute('src')!)
    expect(text).toBe(SAMPLE_URI)
    expect(modules).toBe(encode(SAMPLE_URI, { ecc: 'M' }).size + 8)
    expect(img).toHaveStyle({ width: '180px', height: '180px' })
  })

  it('shows "Waiting for an app to connect" when appName is undefined', () => {
    render(<Bunker uri={SAMPLE_URI} onManageApps={() => {}} onDone={() => {}} />)
    expect(screen.getByText(/waiting for an app to connect/i)).toBeInTheDocument()
  })

  it('shows "Connected to {appName}" and Done button when appName is set', () => {
    const onDone = vi.fn()
    render(<Bunker uri={SAMPLE_URI} appName="App 12345678" onManageApps={() => {}} onDone={onDone} />)
    expect(screen.getByText(/connected to App 12345678/i)).toBeInTheDocument()
    const done = screen.getByRole('button', { name: /done/i })
    expect(done).toBeInTheDocument()
  })

  it('calls onDone when Done is clicked', async () => {
    const onDone = vi.fn()
    render(<Bunker uri={SAMPLE_URI} appName="App 12345678" onManageApps={() => {}} onDone={onDone} />)
    await userEvent.click(screen.getByRole('button', { name: /^done$/i }))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('calls onManageApps when Manage connected apps is clicked in the success state', async () => {
    const onManageApps = vi.fn()
    render(<Bunker uri={SAMPLE_URI} appName="App 12345678" onManageApps={onManageApps} onDone={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /manage connected apps/i }))
    expect(onManageApps).toHaveBeenCalledOnce()
  })

  it('names the persona and warns to keep the link private', () => {
    render(<Bunker uri="bunker://x?relay=wss://r&secret=s" identityName="magazine" onManageApps={() => {}} onDone={() => {}} />)
    expect(screen.getByText(/any app that opens this link signs in as magazine\./i)).toBeInTheDocument()
    expect(screen.getByText(/keep it private\. {2}treat it like a password\./i, { normalizer: s => s })).toBeInTheDocument()
  })

  it('surfaces a visible error when the clipboard write fails, instead of silently claiming success', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<Bunker uri={SAMPLE_URI} onManageApps={() => {}} onDone={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy/i)
    // And it must not claim success — no "Copied!" state.
    expect(screen.queryByRole('button', { name: /copied!/i })).not.toBeInTheDocument()
  })
})
