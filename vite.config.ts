import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'My Signet Lite',
        short_name: 'Signet Lite',
        description: 'Your Nostr keys, in your pocket.  Approve sign-ins and posts from any app.',
        theme_color: '#0E2A47',
        background_color: '#FAF7ED',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        launch_handler: { client_mode: 'navigate-existing' },
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Icons live under icons/ and are already precached via the web manifest; ignore them in the
      // glob so they aren't listed twice in the precache manifest. apple-touch-icon.png sits at the
      // root (not in icons/), so it's still picked up by the glob.
      injectManifest: { globPatterns: ['**/*.{js,css,html,ico,png,svg}'], globIgnores: ['icons/**'] },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./test-setup.ts'],
  },
} as any)
