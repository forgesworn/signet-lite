import { describe, it, expect, vi } from 'vitest'
import { createApprovalQueue, type PendingApproval } from './approval-queue.js'
import type { ApprovalRequest } from '../engine/signer.js'

/** A controllable timer IO: nothing fires until the test calls fire(id). */
function fakeIO() {
  const timers = new Map<number, () => void>()
  let nextId = 1
  const heads: (PendingApproval | null)[] = []
  return {
    timers,
    heads,
    io: {
      setTimer: (cb: () => void, _ms: number) => { const id = nextId++; timers.set(id, cb); return id },
      clearTimer: (id: number) => { timers.delete(id) },
      onHead: (item: PendingApproval | null) => { heads.push(item) },
    },
    fire(id: number) { const cb = timers.get(id); if (cb) { timers.delete(id); cb() } },
  }
}

function approval(name: string, rateLimited = false): Omit<PendingApproval, 'id'> {
  return { req: { identityName: 'magazine', clientPubkey: name, method: 'sign_event' } as ApprovalRequest, rateLimited, appName: name }
}

describe('createApprovalQueue', () => {
  it('shows the first enqueued request as the head', async () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    void q.enqueue(approval('A'))
    expect(f.heads).toMatchObject([{ ...approval('A') }])
    expect(q.head()?.appName).toBe('A')
  })

  it('resolves to a clean decline (flagged timedOut) when a prompt is never answered', async () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    const decision = q.enqueue(approval('A', true))
    f.fire(1)
    await expect(decision).resolves.toEqual({ ok: false, auto: false, rateLimited: true, timedOut: true })
    // Head cleared once the lone prompt timed out.
    expect(f.heads.at(-1)).toBeNull()
  })

  it('keeps the next prompt waiting behind the first, then advances when the head is decided', async () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    const a = q.enqueue(approval('A'))
    const b = q.enqueue(approval('B'))
    // Only A is shown; B waits its turn.
    expect(f.heads).toMatchObject([approval('A')])
    q.decide(q.head()!.id, true)
    await expect(a).resolves.toEqual({ ok: true, auto: false, rateLimited: false })
    expect(f.heads.at(-1)).toMatchObject(approval('B'))
    q.decide(q.head()!.id, false)
    await expect(b).resolves.toEqual({ ok: false, auto: false, rateLimited: false })
    expect(f.heads.at(-1)).toBeNull()
  })

  it('times out a request waiting behind the head without disturbing the visible prompt', async () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    q.enqueue(approval('A'))           // timer id 1, shown
    const b = q.enqueue(approval('B')) // timer id 2, waiting
    const headsBefore = f.heads.length
    f.fire(2)                          // B times out while waiting
    await expect(b).resolves.toMatchObject({ ok: false, timedOut: true })
    // A is still the head — no re-render happened for B's silent timeout.
    expect(f.heads.length).toBe(headsBefore)
    expect(q.head()?.appName).toBe('A')
  })

  it('cancels the head timer when the user decides, so it cannot fire twice', async () => {
    const f = fakeIO()
    const clear = vi.spyOn(f.io, 'clearTimer')
    const q = createApprovalQueue(f.io)
    const a = q.enqueue(approval('A'))
    q.decide(q.head()!.id, true)
    expect(clear).toHaveBeenCalledWith(1)
    expect(f.timers.has(1)).toBe(false) // timer gone — a late fire is impossible
    await expect(a).resolves.toMatchObject({ ok: true })
  })

  it('clear() declines every pending request and cancels their timers', async () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    const a = q.enqueue(approval('A'))
    const b = q.enqueue(approval('B'))
    q.clear()
    await expect(a).resolves.toEqual({ ok: false, auto: false, rateLimited: false })
    await expect(b).resolves.toEqual({ ok: false, auto: false, rateLimited: false })
    expect(f.timers.size).toBe(0)
    expect(f.heads.at(-1)).toBeNull()
    // A teardown decline is NOT a timeout.
    await expect(a).resolves.not.toHaveProperty('timedOut', true)
  })

  it('honours a custom timeout window', () => {
    const f = fakeIO()
    const setTimer = vi.spyOn(f.io, 'setTimer')
    const q = createApprovalQueue(f.io, { timeoutMs: 5000 })
    void q.enqueue(approval('A'))
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 5000)
  })

  it('gives every enqueued request its own id, even for identical requests', () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    void q.enqueue(approval('A'))
    const first = q.head()!.id
    q.decide(first, false)
    void q.enqueue(approval('A'))
    expect(q.head()!.id).not.toBe(first)
  })

  // H5: a decision is bound to the request that was on screen. A double tap, or a decision that
  // lands after the shown request timed out, must never settle the NEXT request in the queue.
  it('ignores a duplicate decision for a request already decided (double tap)', async () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    const a = q.enqueue(approval('A'))
    const b = q.enqueue(approval('B'))
    const shown = q.head()!.id
    q.decide(shown, true)
    q.decide(shown, true) // the second tap
    await expect(a).resolves.toMatchObject({ ok: true })
    expect(q.head()?.appName).toBe('B')
    let bSettled = false
    void b.then(() => { bSettled = true })
    await Promise.resolve()
    expect(bSettled).toBe(false)
  })

  it('ignores a decision that arrives after the shown request timed out', async () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    const a = q.enqueue(approval('A')) // timer 1
    const b = q.enqueue(approval('B'))
    const shown = q.head()!.id
    f.fire(1) // A times out while the user is still deciding
    q.decide(shown, true)
    await expect(a).resolves.toMatchObject({ ok: false, timedOut: true })
    expect(q.head()?.appName).toBe('B')
    let bSettled = false
    void b.then(() => { bSettled = true })
    await Promise.resolve()
    expect(bSettled).toBe(false)
  })

  it('isHead reports whether an id is still the one on screen', () => {
    const f = fakeIO()
    const q = createApprovalQueue(f.io)
    void q.enqueue(approval('A'))
    const id = q.head()!.id
    expect(q.isHead(id)).toBe(true)
    q.decide(id, false)
    expect(q.isHead(id)).toBe(false)
  })
})
