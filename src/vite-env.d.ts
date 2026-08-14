/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

// Injected at build time by Vite (define) from package.json.
declare const __APP_VERSION__: string;
// Beta label for dev/test builds (e.g. "v1.3.4b3"); empty string on prod.
declare const __APP_DEV_VERSION__: string;
