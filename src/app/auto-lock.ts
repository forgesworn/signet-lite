export interface AutoLockIO {
  lock(): void
  /** Subscribe to page visibility changes; returns an unsubscribe. */
  onVisibilityChange(cb: (visible: boolean) => void): () => void
}

export interface AutoLockOptions {
  /** Lock after this long with no activity — a handled signing request and any foreground
   *  interaction both count as activity. Default 5 minutes. */
  inactivityMs?: number
  /** Absolute backstop from unlock, regardless of activity, so a malicious always-allow app can't
   *  hold the session open forever by pinging. Default 60 minutes. */
  hardCapMs?: number
}

/** Activity-based auto-lock for a remote signer. The session stays live while it is being USED —
 *  a handled signing request or any foreground interaction counts as activity — and locks after a
 *  quiet period, or at a hard maximum, whichever comes first. It deliberately does NOT lock merely
 *  because the page was backgrounded: you sign by switching to the client app. Instead it re-checks
 *  whenever the page returns to the foreground, which also covers mobile browsers that freeze a
 *  backgrounded tab's timers (the inactivity timer wouldn't have fired). */
export function createAutoLockController(io: AutoLockIO, opts: AutoLockOptions = {}) {
  const inactivityMs = opts.inactivityMs ?? 5 * 60 * 1000
  const hardCapMs = opts.hardCapMs ?? 60 * 60 * 1000
  const sessionStart = Date.now()
  let lastActivity = sessionStart
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null } }

  // Lock once the inactivity window or the hard cap has elapsed; otherwise arm a timer for the
  // nearer deadline. Re-running on every visibility change catches a deadline that passed while a
  // backgrounded tab's timers were frozen.
  const evaluate = () => {
    if (disposed) return
    clearTimer()
    const now = Date.now()
    const deadline = Math.min(lastActivity + inactivityMs, sessionStart + hardCapMs)
    if (now >= deadline) { io.lock(); return }
    timer = setTimeout(evaluate, deadline - now)
  }

  const unsubscribe = io.onVisibilityChange(() => evaluate())
  evaluate()

  return {
    /** Record activity (a handled signing request, or foreground interaction) — resets the
     *  inactivity window. The hard cap is unaffected. */
    noteActivity() { if (disposed) return; lastActivity = Date.now(); evaluate() },
    dispose() { disposed = true; clearTimer(); unsubscribe() },
  }
}

/** Per-session auto-lock (H3). Holds at most ONE controller, created by `arm()` when a session is
 *  unlocked — so the inactivity window and hard cap are measured from unlock, never from page
 *  load — and disposed by `disarm()` when the session locks. With no session armed (onboarding,
 *  the unlock screen) nothing can auto-lock. An auto-lock disarms itself before calling
 *  `io.lock`, so the next unlock always starts a fresh controller with live timers. */
export function createSessionAutoLock(io: AutoLockIO, opts: AutoLockOptions = {}) {
  let current: ReturnType<typeof createAutoLockController> | null = null
  const disarm = () => { current?.dispose(); current = null }
  return {
    /** Start the clocks for a newly unlocked session (replacing any previous controller). */
    arm() {
      disarm()
      current = createAutoLockController({
        lock: () => { disarm(); io.lock() },
        onVisibilityChange: io.onVisibilityChange,
      }, opts)
    },
    /** Stop the clocks — the session was locked (or reset). */
    disarm,
    /** Record activity for the armed session; ignored when nothing is armed. */
    noteActivity() { current?.noteActivity() },
    isArmed() { return current !== null },
  }
}

/** Real browser IO: a lock callback plus a visibilitychange subscription. */
export function browserAutoLockIO(lock: () => void): AutoLockIO {
  return {
    lock,
    onVisibilityChange(cb) {
      const handler = () => cb(document.visibilityState === 'visible')
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
  }
}
