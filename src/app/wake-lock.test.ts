import { describe, it, expect } from 'vitest'
import { createWakeLockController, type WakeLockIO } from './wake-lock.js'

/** Drain pending microtasks (the controller requests the lock asynchronously). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function makeFakeIO(opts: { supported?: boolean } = {}) {
  let visible = true
  let visCb: (() => void) | null = null
  let requests = 0
  let failNext = false
  const sentinels: { released: boolean }[] = []
  const io: WakeLockIO = {
    isSupported: () => opts.supported ?? true,
    isVisible: () => visible,
    onVisibilityChange: cb => { visCb = cb; return () => { visCb = null } },
    request: async () => {
      requests++
      if (failNext) { failNext = false; throw new Error('refused') }
      const s = { released: false }
      sentinels.push(s)
      return { release: async () => { s.released = true } }
    },
  }
  return {
    io,
    get requests() { return requests },
    get heldCount() { return sentinels.filter(s => !s.released).length },
    setVisible(v: boolean) { visible = v; visCb?.() },
    failNextRequest() { failNext = true },
    listening: () => visCb !== null,
  }
}

describe('wake-lock controller', () => {
  it('requests a screen lock when set active while visible and supported', async () => {
    const f = makeFakeIO()
    const c = createWakeLockController(f.io)
    c.setActive(true)
    await flush()
    expect(f.requests).toBe(1)
    expect(f.heldCount).toBe(1)
  })

  it('releases the lock when set inactive', async () => {
    const f = makeFakeIO()
    const c = createWakeLockController(f.io)
    c.setActive(true); await flush()
    c.setActive(false); await flush()
    expect(f.heldCount).toBe(0)
  })

  it('drops the lock when hidden and re-acquires when visible again', async () => {
    const f = makeFakeIO()
    const c = createWakeLockController(f.io)
    c.setActive(true); await flush()
    expect(f.heldCount).toBe(1)
    f.setVisible(false); await flush()
    expect(f.heldCount).toBe(0)
    f.setVisible(true); await flush()
    expect(f.heldCount).toBe(1)
    expect(f.requests).toBe(2)
  })

  it('does nothing and does not throw when the API is unsupported', async () => {
    const f = makeFakeIO({ supported: false })
    const c = createWakeLockController(f.io)
    c.setActive(true); await flush()
    expect(f.requests).toBe(0)
    expect(f.heldCount).toBe(0)
  })

  it('swallows a refused request and can retry later', async () => {
    const f = makeFakeIO()
    const c = createWakeLockController(f.io)
    f.failNextRequest()
    c.setActive(true); await flush()
    expect(f.heldCount).toBe(0)
    f.setVisible(false); await flush()
    f.setVisible(true); await flush()
    expect(f.heldCount).toBe(1)
  })

  it('dispose releases the lock and stops listening', async () => {
    const f = makeFakeIO()
    const c = createWakeLockController(f.io)
    c.setActive(true); await flush()
    c.dispose(); await flush()
    expect(f.heldCount).toBe(0)
    expect(f.listening()).toBe(false)
  })
})
