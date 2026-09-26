/**
 * Screen wake lock: keep the device screen awake while Signet Lite is acting as a
 * signer for a connected app, so a remote client can reach it instead of timing out
 * when the phone would otherwise dim and suspend the page.
 *
 * A wake lock only holds while the page is visible; the OS releases it whenever the
 * page is hidden, so the controller re-acquires on the page returning to view. It
 * cannot survive switching apps or a manual power-button lock. A missing API or a
 * refused request is a silent no-op.
 */

/** A screen wake lock the controller drives, injected so it can be tested headless. */
export interface WakeLockIO {
  /** Whether the Screen Wake Lock API is available. */
  isSupported(): boolean
  /** Request a screen wake lock; resolves to a release handle, or rejects if refused. */
  request(): Promise<{ release(): Promise<void> }>
  /** Whether the document is currently visible. */
  isVisible(): boolean
  /** Subscribe to visibility changes (either direction); returns an unsubscribe function. */
  onVisibilityChange(cb: () => void): () => void
}

export interface WakeLockController {
  /** Hold the screen awake while active and the page is visible. */
  setActive(active: boolean): void
  /** Release the lock and stop listening. */
  dispose(): void
}

export function createWakeLockController(io: WakeLockIO): WakeLockController {
  let active = false
  let sentinel: { release(): Promise<void> } | null = null
  let requesting = false

  function refresh(): void {
    const shouldHold = active && io.isVisible() && io.isSupported()
    if (shouldHold && !sentinel && !requesting) {
      requesting = true
      io.request().then(s => {
        requesting = false
        // State may have changed while the request was in flight.
        if (active && io.isVisible()) sentinel = s
        else void s.release().catch(() => {})
      }).catch(() => { requesting = false })
    } else if (!shouldHold && sentinel) {
      const s = sentinel
      sentinel = null
      void s.release().catch(() => {})
    }
  }

  const unsubscribe = io.onVisibilityChange(refresh)

  return {
    setActive(next: boolean) { active = next; refresh() },
    dispose() {
      active = false
      unsubscribe()
      if (sentinel) {
        const s = sentinel
        sentinel = null
        void s.release().catch(() => {})
      }
    },
  }
}

/** Real browser IO over the Screen Wake Lock API and document visibility. */
export function browserWakeLockIO(): WakeLockIO {
  type WakeLockNavigator = Navigator & { wakeLock: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
  return {
    isSupported: () => typeof navigator !== 'undefined' && 'wakeLock' in navigator,
    request: () => (navigator as WakeLockNavigator).wakeLock.request('screen'),
    isVisible: () => typeof document !== 'undefined' && document.visibilityState === 'visible',
    onVisibilityChange: cb => {
      const handler = () => cb()
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
  }
}
