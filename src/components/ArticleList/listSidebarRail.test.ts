import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * A-3 (campagne 1.9.0) : le ☰ de secours flottait au-dessus de la première
 * ligne et recouvrait sa pastille « non lu » (grille), son point (liste
 * compacte), sa vignette (aperçu). Il vit dans un rail réservé à gauche du
 * corps de la liste (`.list-body--rail`) : rien n'est dessous, à aucune
 * position de défilement, et la liste commence toujours tout en haut
 * (décision du propriétaire) — le rail prend de la largeur, jamais de la
 * hauteur.
 *
 * jsdom ne met rien en page : la géométrie se vérifie ici, sur la feuille de
 * style. La mesure réelle (Chrome, `getBoundingClientRect`) est décrite dans
 * `docs/FEATURES.md`.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../../styles/index.css'), 'utf8');
const rule = (sel: string, from = css) => from.match(new RegExp(`(?:^|\\n|\\{)\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const px = (decl: string, prop: string) => Number(decl.match(new RegExp(`(?:^|;|\\s)${prop}:\\s*(\\d+)px`))?.[1] ?? NaN);
/** Le contenu de tous les blocs `@media (pointer: coarse)`, mis bout à bout. */
const coarse = [...css.matchAll(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');

/** Le bouton finit avant le rail, avec au moins 4 px d'air. */
const fits = (button: string, rail: string) => px(button, 'left') + px(button, 'width') + 4 <= px(rail, '--list-rail');

describe('☰ de secours — un rail, pas un recouvrement', () => {
  it('à la souris, le bouton tient dans le rail', () => {
    expect(fits(rule('.list-sidebar-reveal'), rule('.list-body--rail'))).toBe(true);
  });

  it('au doigt (44 px), le rail s’élargit avec lui', () => {
    const button = rule('.list-sidebar-reveal', coarse);
    const rail = rule('.list-body--rail', coarse);
    expect(px(button, 'width')).toBe(44);
    expect(fits(`left: ${px(rule('.list-sidebar-reveal'), 'left')}px; ${button}`, rail)).toBe(true);
  });

  it('le contenu commence après le rail, et toujours tout en haut', () => {
    const r = rule('.list-body--rail');
    expect(r).toMatch(/padding-left:\s*var\(--list-rail\)/);
    expect(r).not.toMatch(/padding-top|margin-top|padding:/);
  });
});
