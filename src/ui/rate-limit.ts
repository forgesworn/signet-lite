// Per-app rate limiter for auto-approved (always-policy) requests. When an app exceeds its
// budget within the sliding window, the App downgrades that request from auto-allow to a
// prompt — it never hard-blocks, so the user stays in control. State is in-memory by design:
// this guards live-session abuse, not offline brute force (unlike the persisted PIN throttle),
// so a reload resetting the window is acceptable.

export interface RateLimiterOptions {
  /** How many auto-approvals an app may take inside the window before a prompt is forced. */
  max?: number
  /** Length of the sliding window, in milliseconds. */
  windowMs?: number
}

export interface RateLimiter {
  /** True once `max` records for this app fall inside the window ending at `now`. */
  overBudget(appKey: string, now: number): boolean
  /** Note one auto-approval for this app at `now`. */
  record(appKey: string, now: number): void
  /** Forget one app's history, or (no arg) every app's. */
  reset(appKey?: string): void
}

/** Default budget: 30 auto-signs per app per minute before a prompt is forced. */
export const DEFAULT_RATE_MAX = 30
export const DEFAULT_RATE_WINDOW_MS = 60_000

/** A sliding-window limiter keyed by appKey. `now` is supplied by the caller (Date.now() in
 *  app code; a fixed clock in tests) so the module has no clock dependency. */
export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const max = opts.max ?? DEFAULT_RATE_MAX
  const windowMs = opts.windowMs ?? DEFAULT_RATE_WINDOW_MS
  const hits = new Map<string, number[]>()

  /** Drop timestamps that have aged out of the window, returning the survivors. */
  function live(appKey: string, now: number): number[] {
    const cutoff = now - windowMs
    const kept = (hits.get(appKey) ?? []).filter(t => t > cutoff)
    if (kept.length) hits.set(appKey, kept)
    else hits.delete(appKey)
    return kept
  }

  return {
    overBudget(appKey, now) {
      return live(appKey, now).length >= max
    },
    record(appKey, now) {
      const kept = live(appKey, now)
      kept.push(now)
      hits.set(appKey, kept)
    },
    reset(appKey) {
      if (appKey === undefined) hits.clear()
      else hits.delete(appKey)
    },
  }
}
