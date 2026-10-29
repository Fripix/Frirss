import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * L'écran de connexion et l'écran d'erreur suivaient `100dvh` partout. En PWA
 * iOS plein écran, `dvh` est calculé un peu court et laisse une bande claire
 * en bas : la coque de l'app y repasse à `100vh` (`.app-shell`), ces deux
 * écrans aussi, par la même paire de règles.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('écrans plein écran hors coque — hauteur', () => {
  it('passent à 100vh en app installée, comme la coque', () => {
    const css = read('styles/index.css');
    expect(css).toMatch(/\.screen-min-height\s*\{\s*min-height:\s*var\(--app-height,\s*100dvh\)/);
    const standalone = [...css.matchAll(/@media \(display-mode: standalone\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(standalone).toMatch(/\.screen-min-height\s*\{\s*min-height:\s*var\(--app-height,\s*100vh\)/);
  });

  it('servent à la connexion et à l’écran d’erreur, sans hauteur en ligne', () => {
    for (const file of ['components/Login/Login.tsx', 'components/ErrorBoundary.tsx']) {
      const src = read(file);
      expect(src, file).toContain('screen-min-height');
      expect(src, file).not.toMatch(/minHeight:\s*'var\(--app-height/);
    }
  });
});
