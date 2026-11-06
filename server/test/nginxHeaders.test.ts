import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * En-têtes de sécurité de chaque location de `nginx.conf` qui répond elle-même.
 *
 * Piège nginx : une requête est servie par UNE location, et un bloc qui
 * déclare le moindre `add_header` n'hérite d'aucun de ceux du niveau
 * supérieur. Chaque location porte donc sa propre liste. Le 404 de `@spa`
 * (`/.env`, `/x.js.map`…) partait sans aucun en-tête : la location n'en
 * déclarait pas, et le niveau `server` non plus (campagne 1.9.0, second round).
 * Le `if` qui rend ce 404 hérite, lui, des `add_header` de `@spa` : il n'en
 * déclare aucun.
 */
const conf = fs.readFileSync(path.join(process.cwd(), 'nginx.conf'), 'utf8')
  .split('\n').map((l) => l.replace(/^\s*#.*$/, '')).join('\n'); // commentaires retirés

function block(selector: string): string {
  const start = conf.indexOf(`location ${selector} {`);
  expect(start, `location ${selector}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = conf.indexOf('{', start); i < conf.length; i++) {
    if (conf[i] === '{') depth++;
    if (conf[i] === '}' && --depth === 0) return conf.slice(start, i + 1);
  }
  throw new Error('bloc non fermé');
}

const header = (b: string, name: string) => new RegExp(`add_header ${name} "([^"]*)" always;`).exec(b)?.[1];
const SECURITY = ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy'];
const ASSETS = '~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$';

describe('nginx.conf — en-têtes de sécurité', () => {
  it('le 404 de @spa porte les mêmes en-têtes que le document', () => {
    const doc = block('/');
    const spa = block('@spa');
    for (const name of [...SECURITY, 'Content-Security-Policy']) {
      expect(header(spa, name), name).toBeDefined();
      expect(header(spa, name), name).toBe(header(doc, name));
    }
    // Déclarés sur la location, hors du `if` : le `if` en hérite, et un
    // `add_header` dans le `if` couperait cet héritage pour lui seul.
    const ifBlock = /if \(.*\) \{[^}]*\}/.exec(spa)?.[0] ?? '';
    expect(ifBlock).toContain('return 404;');
    expect(ifBlock).not.toContain('add_header');
  });

  it('chaque location qui répond elle-même porte les trois en-têtes de base', () => {
    for (const sel of ['/', '@spa', '= /sw.js', '= /manifest.webmanifest', ASSETS]) {
      for (const name of SECURITY) expect(header(block(sel), name), `${sel} ${name}`).toBeDefined();
    }
  });

  it('/sw.js reste sans CSP, et les fichiers hachés restent immuables', () => {
    // Un service worker applique la CSP de son propre script à ses fetch() :
    // `connect-src 'self'` y casserait toutes les images d'articles.
    expect(block('= /sw.js')).not.toContain('Content-Security-Policy');
    expect(block(ASSETS)).toMatch(/add_header Cache-Control "public, immutable";/);
    expect(block(ASSETS)).toMatch(/expires 1y;/);
  });
});
