import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Bandeau de relève : `white-space: nowrap`, centré, sans largeur maximale.
 * À 320 px, « 12 nouveaux articles · FreshRSS n'a pas répondu à temps… »
 * mesurait de 687 à 799 px selon la langue : rogné des deux côtés, la croix
 * hors de l'écran. Et du blanc en dur sur l'accent (1,9:1).
 */
const css = fs.readFileSync(path.resolve(__dirname, '../styles/index.css'), 'utf8');
const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('bandeau de relève — tient dans l’écran et se lit', () => {
  it('passe à la ligne et ne dépasse pas la largeur de l’écran', () => {
    const r = rule('.refresh-banner');
    expect(r).not.toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/max-width:\s*calc\(100vw - 32px\)/);
  });

  it('écrit avec l’encre calculée pour l’accent, pas du blanc', () => {
    expect(rule('.refresh-banner')).toMatch(/color:\s*var\(--on-accent/);
    expect(rule('.refresh-banner__action')).toMatch(/color:\s*var\(--on-accent/);
  });
});
