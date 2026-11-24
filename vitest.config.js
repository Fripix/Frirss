import { defineConfig } from 'vitest/config';
import { existsSync } from 'fs';
import path from 'path';

// The server uses NodeNext-style imports with explicit ".js" extensions (so
// `tsc` can compile it to a real Node ESM build). Vite/vitest don't remap
// ".js" → ".ts" on their own, so this tiny resolver does it for the test run.
function tsJsResolver() {
  return {
    name: 'ts-js-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && source.startsWith('.') && source.endsWith('.js')) {
        const abs = path.resolve(path.dirname(importer), source);
        const tsPath = abs.slice(0, -3) + '.ts';
        if (existsSync(tsPath)) return tsPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [tsJsResolver()],
  // Le module virtuel de vite-plugin-pwa n'existe qu'au build.
  resolve: {
    alias: { 'virtual:pwa-register/react': path.resolve('src/test/pwaRegisterStub.ts') },
  },
  test: {
    environment: 'node', // default; frontend tests opt into jsdom via a docblock
    include: ['server/**/*.test.{js,ts}', 'src/**/*.test.{js,jsx,ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['./server/test/setup.ts'],
    fileParallelism: false, // backend tests share a temp DB → run serially
    // Node 25+ définit son propre `localStorage` (Web Storage) sur l'objet
    // global : sans `--localstorage-file`, un accesseur qui rend `undefined`.
    // L'environnement jsdom ne remplace pas une propriété déjà là, et 293
    // tests voyaient `localStorage` indéfini sous Node 26. Sans Web Storage
    // côté Node, celui de jsdom reprend sa place. Le drapeau n'est passé que si
    // ce Node le connaît (Node 24 l'accepte aussi).
    execArgv: process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
      ? ['--no-experimental-webstorage']
      : [],
  },
});
