import type { ApprovalRequest, ApprovalDecision } from '../engine/signer.js'

/** One gated request waiting for the user's decision. `appName` is snapshotted at enqueue time so
 *  the prompt can render without an async lookup as the head advances. */
export interface PendingApproval {
  /** Unique per enqueued request (assigned by the queue). A decision names the id it was made
   *  for, so it can only ever settle the request the user actually saw. */
  id: number
  req: ApprovalRequest
  rateLimited: boolean
  appName: string
}

/** Injected side-effects, so the queue is a pure unit testable with a fake clock (mirrors the
 *  auto-lock / rate-limit controllers). `onHead` fires whenever the request shown to the user
 *  changes — with the new head, or null when nothing is pending. */
export interface ApprovalQueueIO {
  setTimer(cb: () => void, ms: number): number
  clearTimer(id: number): void
  onHead(item: PendingApproval | null): void
}

/** How long an unanswered prompt waits before it is declined on the user's behalf. A backgrounded
 *  PWA can't show the prompt, so without this the request — and every gated request queued behind
 *  it — would hang forever and the client would report "can't reach the signer". 90s is generous
 *  for a present user mid-decision, yet well under the 5-minute auto-lock, so this lighter response
 *  (decline just the one request, keep the session unlocked) fires first. */
export const DEFAULT_PROMPT_TIMEOUT_MS = 90_000

/** A FIFO queue of approval prompts. Each enqueued request is shown in turn and resolves when the
 *  user decides, when its timeout elapses (declined, flagged timedOut), or when the queue is cleared
 *  on lock/reset. A per-request timeout means one abandoned prompt never stalls the ones behind it. */
export function createApprovalQueue(io: ApprovalQueueIO, opts: { timeoutMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS
  type Entry = { item: PendingApproval; resolve: (d: ApprovalDecision) => void; timer: number }
  const queue: Entry[] = []
  let nextId = 1

  const emitHead = () => io.onHead(queue[0]?.item ?? null)

  /** Remove an entry and cancel its timer. Returns whether it was the visible head. */
  function remove(entry: Entry): boolean {
    const i = queue.indexOf(entry)
    if (i === -1) return false
    queue.splice(i, 1)
    io.clearTimer(entry.timer)
    return i === 0
  }

  return {
    /** Enqueue a gated request and return the promise the engine awaits for the decision. */
    enqueue(pending: Omit<PendingApproval, 'id'>): Promise<ApprovalDecision> {
      const item: PendingApproval = { ...pending, id: nextId++ }
      return new Promise<ApprovalDecision>(resolve => {
        const entry: Entry = { item, resolve, timer: 0 }
        entry.timer = io.setTimer(() => {
          // Only re-render if the timed-out request was the one on screen; a request waiting its
          // turn times out silently, leaving the visible head untouched.
          const wasHead = remove(entry)
          resolve({ ok: false, auto: false, rateLimited: item.rateLimited, timedOut: true })
          if (wasHead) emitHead()
        }, timeoutMs)
        queue.push(entry)
        if (queue.length === 1) emitHead()
      })
    },

    /** The request currently shown to the user, or null. */
    head(): PendingApproval | null {
      return queue[0]?.item ?? null
    },

    /** Whether `id` is still the request on screen. */
    isHead(id: number): boolean {
      return queue[0]?.item.id === id
    },

    /** Settle the request `id` with the user's decision and advance to the next prompt. A no-op
     *  unless `id` is the visible head: a double tap, or a decision that lands after the shown
     *  request timed out, must never settle whatever request moved up behind it. */
    decide(id: number, ok: boolean): void {
      const entry = queue[0]
      if (!entry || entry.item.id !== id) return
      remove(entry)
      entry.resolve({ ok, auto: false, rateLimited: entry.item.rateLimited })
      emitHead()
    },

    /** Decline every pending request (lock / factory-reset teardown). Not a timeout, so no timedOut
     *  flag — this is a deliberate settle so no suspended sign frame retains key material. */
    clear(): void {
      const entries = queue.splice(0)
      for (const e of entries) {
        io.clearTimer(e.timer)
        e.resolve({ ok: false, auto: false, rateLimited: false })
      }
      emitHead()
    },
  }
}

export type ApprovalQueue = ReturnType<typeof createApprovalQueue>
