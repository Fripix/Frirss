import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Garde-fou : les survols et les messages d'erreur suivent le thème.
 *
 * `hover:bg-black/5` assombrit l'élément survolé : sur un fond sombre (Night,
 * Desk) l'effet ne se voit pas, et `hover:bg-white/5` a le défaut inverse sur
 * un fond clair. Les classes `hover-tint` / `hover-tint-strong` / `tint` de
 * index.css teintent à partir de la couleur du texte, visible partout. Même
 * chose pour les rouges Tailwind : un thème choisit sa couleur `--danger`.
 *
 * Restent permis, parce qu'ils ne dépendent pas du thème : le voile noir sous
 * une boîte (`bg-black/40`) et le blanc posé sur un fond d'accent ou une image.
 */
const ROOT = path.resolve(__dirname, '..');
const FORBIDDEN = /(?:^|[\s'"`])(?:hover:|active:)?bg-(?:black|white)\/(?:5|10|\[\.0\d\])(?![\d.])|\b(?:text|bg|border)-red-\d+/;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

describe('teintes qui suivent le thème', () => {
  it("aucun survol noir ou blanc fixe, aucun rouge Tailwind dans l'interface", () => {
    const hits: string[] = [];
    for (const file of sources(ROOT)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('les classes de teinte existent dans la feuille de style', () => {
    const css = fs.readFileSync(path.join(ROOT, 'styles/index.css'), 'utf8');
    for (const cls of ['.hover-tint:hover', '.hover-tint-strong:hover', '.active-tint:active', '.tint', '.hover-danger-tint:hover', '.text-danger', '.danger-note']) {
      expect(css, cls).toContain(cls);
    }
  });
});
