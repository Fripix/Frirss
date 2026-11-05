import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * La balise viewport portait `maximum-scale=1.0` depuis le commit initial,
 * sans intention écrite : Chrome Android interdisait alors le zoom à deux
 * doigts (WCAG 1.4.4). Le zoom automatique d'iOS à la saisie est évité par
 * la règle des champs à 16 px, pas par le viewport.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('zoom à deux doigts', () => {
  it('la balise viewport ne bride pas le zoom', () => {
    const html = read('index.html');
    const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
    expect(viewport, 'balise viewport').not.toBeNull();
    const content = viewport![1];
    expect(content).toContain('width=device-width');
    expect(content).not.toMatch(/maximum-scale/i);
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
  });

  it('les champs restent à 16 px sur petit écran (pas de zoom iOS à la saisie)', () => {
    const css = read('src/styles/index.css');
    const block = css.match(/@media \(max-width: 768px\)\s*\{\s*input:not\(\[type='checkbox'\]\)[\s\S]*?\}/);
    expect(block, 'règle des champs').not.toBeNull();
    expect(block![0]).toMatch(/font-size:\s*16px\s*!important/);
  });
});
