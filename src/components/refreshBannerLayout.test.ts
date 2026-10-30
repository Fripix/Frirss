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

  // À 320 px, « Activer » gardait sa largeur et poussait la croix hors de l'écran
  // dans six langues : ni la phrase ni les boutons ne pouvaient céder.
  it('avec ses boutons, la rangée passe à la ligne et rien n’y est rigide', () => {
    expect(rule('.refresh-banner--hint')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.refresh-banner__action')).not.toMatch(/flex-shrink:\s*0/);
  });

  // Un délai CSS ne repart pas quand le résultat change, et il ne se retient
  // qu'en le neutralisant classe par classe (`--held` oublié sous mouvement réduit).
  it('l’effacement ne dépend que de sa classe, mouvement réduit compris', () => {
    expect(css).not.toMatch(/refresh-banner-out[^;}]*\d\.\d+s\s+forwards/);
    expect(rule('.refresh-banner--leaving')).toMatch(/refresh-banner-out/);
    expect(css).not.toMatch(/refresh-banner--(running|held)/);
  });

  it('écrit avec l’encre calculée pour l’accent, pas du blanc', () => {
    expect(rule('.refresh-banner')).toMatch(/color:\s*var\(--on-accent/);
    expect(rule('.refresh-banner__action')).toMatch(/color:\s*var\(--on-accent/);
  });
});
