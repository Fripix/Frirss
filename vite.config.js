import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { preparedImageFallback } from './src/lib/swImageFallback.ts';

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
        // Repli de Chrome pour la barre d'état de l'app installée (couleur refusée
        // au-dessus de 0,94 de luminosité) : l'en-tête de liste au plafond, pas le noir.
        theme_color: '#efefef',
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
        // Article images (CacheFirst). Two caches: this one keeps what is
        // displayed online; the offline preparation writes to its own
        // ('frirss-offline-images', see src/lib/imageCache.ts), which this
        // route falls back to when it has nothing.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'frirss-images',
              expiration: {
                // Images kept on display are mostly opaque (no readable size),
                // and Chromium counts each one ~7 MB against the quota: 6000
                // had reached 12 GB counted. 500 keeps the recent reading
                // available offline at ~3.5 GB counted at most. Prepared
                // images live elsewhere, out of this cap and of the purge.
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] }, // 0 = opaque cross-origin
              // After the expiration plugin (key order is plugin order), which
              // answers null for a miss.
              plugins: [preparedImageFallback],
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
