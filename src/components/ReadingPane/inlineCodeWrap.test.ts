import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Relecture du second round 1.9.0 (R2-7). M-11 coupait le `<code>` en ligne
 * avec `overflow-wrap: anywhere` : un long nom de fichier ne sortait plus de
 * la colonne à 320 px. Mais `anywhere`, contrairement à `break-word`, compte
 * dans la largeur min-content : une cellule de tableau qui contient du code
 * peut alors se réduire à un caractère, et le tableau se tasse dans la
 * colonne au lieu de défiler dans `.article-scroll-x`. `break-word` coupe
 * toujours le mot qui déborde d'un paragraphe, sans toucher au min-content.
 *
 * jsdom ne met rien en page : la règle se vérifie ici, sur la feuille de
 * style. La mesure réelle (Chrome, `getBoundingClientRect`, tableau
 * `Option | Description` dans 288 px) est décrite dans `docs/FEATURES.md`.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../../styles/index.css'), 'utf8');
/** Le bloc dont `sel` est le SEUL sélecteur (pas `pre, code { … }`). */
const rule = (sel: string) =>
  css.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const decl = (body: string, prop: string) =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`))?.[1]?.trim();

describe('code en ligne dans un article (R2-7)', () => {
  it('se coupe sans réduire la largeur min-content d’une cellule de tableau', () => {
    expect(decl(rule('.article-content code'), 'overflow-wrap')).toBe('break-word');
  });

  // `break-word` ne suffit pas pour une option de ligne de commande : le texte
  // se coupe de toute façon après un trait d'union, et
  // `--experimental-network-imports` tenait sur quatre lignes dans un tableau
  // qui ne défilait toujours pas (mesuré dans Chrome à 288 px).
  it('dans une cellule de tableau, il tient sur une ligne : c’est le tableau qui défile', () => {
    const body = css.match(/\}\s*(?:\/\*[\s\S]*?\*\/\s*)?\.article-content td code,\s*\.article-content th code\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(decl(body, 'white-space')).toBe('nowrap');
  });

  it('le code d’un bloc <pre> ne se coupe pas, il défile', () => {
    expect(decl(rule('.article-content pre code'), 'overflow-wrap')).toBe('normal');
  });
});
