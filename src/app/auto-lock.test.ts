import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAutoLockController, createSessionAutoLock, type AutoLockIO } from './auto-lock.js'

function fakeIO() {
  let onChange: (visible: boolean) => void = () => {}
  return {
    lock: vi.fn(),
    onVisibilityChange: (cb: (visible: boolean) => void) => { onChange = cb; return () => {} },
    setVisible: (next: boolean) => onChange(next),
  } satisfies AutoLockIO & { setVisible: (visible: boolean) => void }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAutoLockController (activity-based)', () => {
  it('locks after the inactivity window with no activity', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 1000 })
    vi.advanceTimersByTime(999)
    expect(io.lock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(io.lock).toHaveBeenCalledTimes(1)
    c.dispose()
  })

  it('resets the inactivity window on activity', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 1000 })
    vi.advanceTimersByTime(900); c.noteActivity(); vi.advanceTimersByTime(900)
    expect(io.lock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(io.lock).toHaveBeenCalledTimes(1)
    c.dispose()
  })

  it('stays unlocked while activity keeps arriving (e.g. ongoing signing from a connected app)', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 1000, hardCapMs: 1_000_000 })
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(800); c.noteActivity() }
    expect(io.lock).not.toHaveBeenCalled() // 4s elapsed but never idle for a full window
    c.dispose()
  })

  it('locks at the hard cap even when activity keeps resetting the inactivity window', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 2000, hardCapMs: 3000 })
    vi.advanceTimersByTime(1500); c.noteActivity() // inactivity would push to 3500, but the cap is 3000
    vi.advanceTimersByTime(1499)
    expect(io.lock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(io.lock).toHaveBeenCalledTimes(1)
    c.dispose()
  })

  it('does NOT lock just because the page was hidden (the bunker fix)', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 100_000 })
    io.setVisible(false)
    expect(io.lock).not.toHaveBeenCalled()
    c.dispose()
  })

  it('does not re-arm after dispose() — a later noteActivity() is a no-op', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 1000 })
    c.dispose()
    c.noteActivity()
    vi.advanceTimersByTime(5000)
    expect(io.lock).not.toHaveBeenCalled()
  })

  it('does not re-arm after dispose() via a visibility change either', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 1000 })
    c.dispose()
    io.setVisible(true)
    vi.advanceTimersByTime(5000)
    expect(io.lock).not.toHaveBeenCalled()
  })

  it('re-checks on return to foreground without spuriously locking inside the window', () => {
    const io = fakeIO()
    const c = createAutoLockController(io, { inactivityMs: 1000 })
    vi.advanceTimersByTime(300); io.setVisible(false)
    vi.advanceTimersByTime(300); io.setVisible(true) // 600 elapsed, still inside the window
    expect(io.lock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400) // 1000 total → idle
    expect(io.lock).toHaveBeenCalledTimes(1)
    c.dispose()
  })
})

// H3: one controller per unlocked session — armed at unlock, disarmed at lock. The idle clock and
// the hard cap start at unlock, not page load, and nothing locks while no session exists.
describe('createSessionAutoLock (per-session arming)', () => {
  const opts = { inactivityMs: 5 * 60_000, hardCapMs: 60 * 60_000 }

  it('never locks while no session is armed (onboarding, unlock screen)', () => {
    const io = fakeIO()
    createSessionAutoLock(io, opts)
    vi.advanceTimersByTime(3 * 60 * 60_000)
    io.setVisible(true)
    expect(io.lock).not.toHaveBeenCalled()
  })

  it('measures the idle window and hard cap from arm(), not from creation', () => {
    const io = fakeIO()
    const s = createSessionAutoLock(io, opts)
    vi.advanceTimersByTime(90 * 60_000) // 90 min on the unlock screen, past the hard cap
    s.arm()
    s.noteActivity()
    expect(io.lock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(io.lock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(io.lock).toHaveBeenCalledTimes(1)
  })

  it('re-arms cleanly for the next session after an auto-lock', () => {
    const io = fakeIO()
    const s = createSessionAutoLock(io, opts)
    s.arm()
    vi.advanceTimersByTime(5 * 60_000)
    expect(io.lock).toHaveBeenCalledTimes(1)
    expect(s.isArmed()).toBe(false)
    // Idle on the unlock screen, then unlock again: a timer must be running for the new session.
    vi.advanceTimersByTime(30 * 60_000)
    s.arm()
    vi.advanceTimersByTime(5 * 60_000)
    expect(io.lock).toHaveBeenCalledTimes(2)
  })

  it('disarm() on a manual lock stops the clock and ignores later activity', () => {
    const io = fakeIO()
    const s = createSessionAutoLock(io, opts)
    s.arm()
    s.disarm()
    s.noteActivity()
    io.setVisible(true)
    vi.advanceTimersByTime(2 * 60 * 60_000)
    expect(io.lock).not.toHaveBeenCalled()
  })

  it('arming again replaces the previous session controller (no double lock)', () => {
    const io = fakeIO()
    const s = createSessionAutoLock(io, opts)
    s.arm()
    vi.advanceTimersByTime(4 * 60_000)
    s.arm()
    vi.advanceTimersByTime(4 * 60_000)
    expect(io.lock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(io.lock).toHaveBeenCalledTimes(1)
  })
})
