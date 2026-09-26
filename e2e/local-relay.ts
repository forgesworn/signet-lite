/**
 * Minimal in-process Nostr relay for e2e tests.
 * Supports: EVENT, REQ (with kinds / #p / authors / ids / since), CLOSE.
 * Returns ws://127.0.0.1:<ephemeral-port> on listen.
 */
import { createServer } from 'net'
import { WebSocketServer } from 'ws'

export interface StoredEvent {
  id: string
  pubkey: string
  kind: number
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

interface Subscription {
  socket: import('ws').WebSocket
  subId: string
  filters: Record<string, unknown>[]
}

function matchesFilter(event: StoredEvent, filter: Record<string, unknown>): boolean {
  if (Array.isArray(filter['kinds'])) {
    if (!(filter['kinds'] as number[]).includes(event.kind)) return false
  }
  if (Array.isArray(filter['authors'])) {
    if (!(filter['authors'] as string[]).includes(event.pubkey)) return false
  }
  if (Array.isArray(filter['ids'])) {
    if (!(filter['ids'] as string[]).includes(event.id)) return false
  }
  if (typeof filter['since'] === 'number') {
    if (event.created_at < (filter['since'] as number)) return false
  }
  if (typeof filter['until'] === 'number') {
    if (event.created_at > (filter['until'] as number)) return false
  }
  // Tag filters — e.g. #p, #e
  for (const key of Object.keys(filter)) {
    if (key.startsWith('#')) {
      const tagName = key.slice(1)
      const wanted = filter[key] as string[]
      const eventTagValues = event.tags
        .filter(t => t[0] === tagName)
        .map(t => t[1])
      if (!wanted.some(w => eventTagValues.includes(w))) return false
    }
  }
  return true
}

function matchesAnyFilter(event: StoredEvent, filters: Record<string, unknown>[]): boolean {
  return filters.some(f => matchesFilter(event, f))
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') {
        srv.close()
        reject(new Error('could not get port'))
        return
      }
      const port = addr.port
      srv.close(() => resolve(port))
    })
  })
}

export async function startRelay(): Promise<{
  url: string
  close: () => Promise<void>
  waitForEvent: (predicate: (e: StoredEvent) => boolean, timeoutMs?: number) => Promise<StoredEvent>
}> {
  const port = await getFreePort()

  const events: StoredEvent[] = []
  const subscriptions: Subscription[] = []
  const waiters: { predicate: (e: StoredEvent) => boolean; resolve: (e: StoredEvent) => void }[] = []

  const wss = new WebSocketServer({ host: '127.0.0.1', port })

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve)
    wss.once('error', reject)
  })

  function broadcast(event: StoredEvent) {
    for (const sub of subscriptions) {
      if (sub.socket.readyState !== sub.socket.OPEN) continue
      if (matchesAnyFilter(event, sub.filters)) {
        sub.socket.send(JSON.stringify(['EVENT', sub.subId, event]))
      }
    }
  }

  // Resolve (and clear) any pending waitForEvent() waiters this event satisfies.
  function resolveWaiters(event: StoredEvent) {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(event)) {
        waiters[i].resolve(event)
        waiters.splice(i, 1)
      }
    }
  }

  wss.on('connection', (ws) => {
    const mySubs: string[] = []

    ws.on('message', (raw) => {
      let msg: unknown
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (!Array.isArray(msg) || msg.length < 2) return

      const [type, ...rest] = msg as [string, ...unknown[]]

      if (type === 'EVENT') {
        const evt = rest[0] as StoredEvent
        events.push(evt)
        broadcast(evt)
        resolveWaiters(evt)
        ws.send(JSON.stringify(['OK', evt.id, true, '']))
        return
      }

      if (type === 'REQ') {
        const subId = rest[0] as string
        const filters = rest.slice(1) as Record<string, unknown>[]
        // Register subscription
        subscriptions.push({ socket: ws, subId, filters })
        mySubs.push(subId)
        // Send matching stored events
        for (const ev of events) {
          if (matchesAnyFilter(ev, filters)) {
            ws.send(JSON.stringify(['EVENT', subId, ev]))
          }
        }
        ws.send(JSON.stringify(['EOSE', subId]))
        return
      }

      if (type === 'CLOSE') {
        const subId = rest[0] as string
        const idx = subscriptions.findIndex(s => s.socket === ws && s.subId === subId)
        if (idx !== -1) subscriptions.splice(idx, 1)
        const mi = mySubs.indexOf(subId)
        if (mi !== -1) mySubs.splice(mi, 1)
        return
      }
    })

    ws.on('close', () => {
      // Clean up all subs for this socket
      for (let i = subscriptions.length - 1; i >= 0; i--) {
        if (subscriptions[i].socket === ws) subscriptions.splice(i, 1)
      }
    })
  })

  const url = `ws://127.0.0.1:${port}`

  /** Resolve with the first stored (or subsequently received) event matching `predicate`. */
  function waitForEvent(predicate: (e: StoredEvent) => boolean, timeoutMs = 15_000): Promise<StoredEvent> {
    const existing = events.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise<StoredEvent>((resolve, reject) => {
      const wrapped = (e: StoredEvent) => { clearTimeout(timer); resolve(e) }
      const timer = setTimeout(() => {
        const idx = waiters.findIndex(w => w.resolve === wrapped)
        if (idx !== -1) waiters.splice(idx, 1)
        reject(new Error('waitForEvent: timed out'))
      }, timeoutMs)
      waiters.push({ predicate, resolve: wrapped })
    })
  }

  function close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all open client connections first
      for (const ws of wss.clients) ws.terminate()
      wss.close(err => { if (err) reject(err); else resolve() })
    })
  }

  return { url, close, waitForEvent }
}
