/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA navigation fallback: navigation requests serve the cached index.html.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// Activate a waiting worker when the page asks. No origin check: the platform only delivers
// service-worker messages from same-origin clients, and ExtendableMessageEvent.origin is
// unreliable across browsers (notably iOS PWAs) — guarding on it can wrongly skip skipWaiting()
// and leave the "new version available" banner stuck forever.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })
