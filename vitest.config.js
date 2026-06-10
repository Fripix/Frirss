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
  test: {
    environment: 'node', // default; frontend tests opt into jsdom via a docblock
    include: ['server/**/*.test.{js,ts}', 'src/**/*.test.{js,jsx,ts,tsx}'],
    setupFiles: ['./server/test/setup.ts'],
    fileParallelism: false, // backend tests share a temp DB → run serially
  },
});
