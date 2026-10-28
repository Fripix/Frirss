import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Garde-fou : un bouton qui ne montre qu'une icône porte un `aria-label`.
 *
 * Un `title` seul ne suffit pas (voir « Noms accessibles » dans
 * docs/FEATURES.md) : le tactile ne l'affiche jamais et les lecteurs d'écran
 * l'annoncent inégalement. Les « A » de la barre latérale étaient même nommés
 * « A » par le texte de leur SVG.
 *
 * Le balayage lit le JSX tel quel : il suit les accolades pour trouver la fin
 * de la balise ouvrante (un `>` dans `size > MIN` n'en est pas la fin), retire
 * les SVG et les commentaires, et considère comme libellé visible tout texte
 * ou toute expression qui n'est pas une simple icône. Il ne voit pas les
 * boutons construits ailleurs (`ToolbarBtn`, `ActionBtn`) : ceux-là posent
 * l'`aria-label` depuis leur prop.
 */
const ROOT = path.resolve(__dirname, '..', 'components');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

/** Fin de la balise ouvrante qui commence à `start` (index du `<`). */
function openTagEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

export function unnamedIconButtons(src: string): number[] {
  const lines: number[] = [];
  let from = 0;
  for (;;) {
    const start = src.indexOf('<button', from);
    if (start < 0) break;
    const end = openTagEnd(src, start);
    if (end < 0) break;
    from = end + 1;
    const attrs = src.slice(start, end);
    if (attrs.endsWith('/')) {
      if (!/aria-label/.test(attrs)) lines.push(src.slice(0, start).split('\n').length);
      continue;
    }
    const close = src.indexOf('</button>', end);
    if (close < 0) break;
    if (/aria-label|aria-labelledby/.test(attrs)) continue;
    const body = src
      .slice(end + 1, close)
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, '');
    // Rien, ou seulement des symboles : l'icône est tout ce qu'on voit.
    if (/^(?:[{}()?:'"`×+−\-–✕⋯…·]|✏️|🔑)*$/u.test(body)) lines.push(src.slice(0, start).split('\n').length);
  }
  return lines;
}

describe('boutons à icône seule', () => {
  it('le balayage repère un bouton sans nom, même avec un `>` dans ses attributs', () => {
    expect(unnamedIconButtons('<button onClick={() => { if (a > b) go(); }} title="x"><svg><text>A</text></svg></button>')).toEqual([1]);
    expect(unnamedIconButtons('<button>×</button>')).toEqual([1]);
    expect(unnamedIconButtons('<button sw={x} />')).toEqual([1]);
    expect(unnamedIconButtons('<button aria-label="Fermer"><svg /></button>')).toEqual([]);
    expect(unnamedIconButtons("<button>{t('app.close')}</button>")).toEqual([]);
  });

  it('chacun porte un aria-label', () => {
    const hits: string[] = [];
    for (const file of sources(ROOT)) {
      for (const line of unnamedIconButtons(fs.readFileSync(file, 'utf8'))) {
        hits.push(`${path.relative(ROOT, file)}:${line}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
