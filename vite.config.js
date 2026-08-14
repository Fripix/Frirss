import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function corsProxyPlugin() {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use('/cors-proxy', async (req, res) => {
        const targetUrl = decodeURIComponent(req.url.slice(1));
        if (!targetUrl || !targetUrl.startsWith('http')) {
          res.writeHead(400);
          res.end('Missing or invalid target URL');
          return;
        }

        try {
          const { default: http } = await import(
            targetUrl.startsWith('https') ? 'https' : 'http'
          );

          const headers = { ...req.headers };
          delete headers.host;
          delete headers.origin;
          delete headers.referer;

          const proxyReq = http.request(
            targetUrl,
            {
              method: req.method,
              headers,
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode, {
                ...proxyRes.headers,
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
                'access-control-allow-methods': '*',
              });
              proxyRes.pipe(res);
            }
          );

          proxyReq.on('error', (err) => {
            res.writeHead(502);
            res.end(`Proxy error: ${err.message}`);
          });

          req.pipe(proxyReq);
        } catch (err) {
          res.writeHead(500);
          res.end(`Proxy error: ${err.message}`);
        }
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    corsProxyPlugin(),
    VitePWA({
      // 'prompt' (not 'autoUpdate') so a new version surfaces via the React
      // hook: the app shows a brief "Updating…" overlay, then reloads itself.
      // registerType is 'prompt' but the reload is still automatic (see
      // UpdatePrompt.tsx) — the overlay just replaces the silent refresh.
      registerType: 'prompt',
      // The useRegisterSW() hook (UpdatePrompt.tsx) owns registration; disable
      // the auto-injected registration to avoid registering the SW twice.
      injectRegister: false,
      // Disabled in dev so it never interferes with HMR / the cors-proxy
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
        // Precache the built app shell; never intercept the API or the cors-proxy.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/cors-proxy\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Cache article images for offline reading (CacheFirst). Workbox has no
        // byte cap, so ~550 MB is approximated via maxEntries (~275 KB avg);
        // purgeOnQuotaError frees space if the device storage limit is hit.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'frirss-images',
              expiration: {
                maxEntries: 2000,
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
