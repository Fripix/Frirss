import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Dev/test builds inject a beta label (e.g. "v1.3.4b3") via FRIRSS_DEV_VERSION
    // (see publish.yml). Empty on production builds.
    __APP_DEV_VERSION__: JSON.stringify(process.env.FRIRSS_DEV_VERSION || ''),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (not 'autoUpdate') so a new version surfaces via the React
      // hook: the app shows a brief "Updating…" overlay, then reloads itself.
      // registerType is 'prompt' but the reload is still automatic (see
      // UpdatePrompt.tsx) — the overlay just replaces the silent refresh.
      registerType: 'prompt',
      // The useRegisterSW() hook (UpdatePrompt.tsx) owns registration; disable
      // the auto-injected registration to avoid registering the SW twice.
      injectRegister: false,
      // Disabled in dev so it never interferes with HMR
      devOptions: { enabled: false },
      includeAssets: ['logo_frirss.png', 'pwa-icon.png'],
      manifest: {
        name: 'FriRSS',
        short_name: 'FriRSS',
        description: 'Lecteur RSS moderne pour FreshRSS',
        lang: 'fr',
        theme_color: '#201f1b',
        background_color: '#201f1b',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built app shell; never intercept the API.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Cache article images for offline reading (CacheFirst). Sizes are not
        // readable for opaque cross-origin responses, so maxEntries is only a
        // backstop; the user-facing budget lives in the app preferences.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'frirss-images',
              expiration: {
                // Backstop only — the real budget is enforced in the app from
                // storage estimates (opaque images have no readable size).
                maxEntries: 6000,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] }, // 0 = opaque cross-origin
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
