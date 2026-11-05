import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * Les `mime.types` de nginx n'ont pas d'entrée `webmanifest` : le manifeste de
 * l'application installable partait en `application/octet-stream`, avec
 * `nosniff` en prime. Une location exacte lui donne son type
 * (`application/manifest+json`) et les en-têtes du document.
 */
const conf = fs.readFileSync(path.join(process.cwd(), 'nginx.conf'), 'utf8');

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

describe('nginx.conf — manifeste de l’application', () => {
  it('sert manifest.webmanifest en application/manifest+json', () => {
    const b = block('= /manifest.webmanifest');
    // `types {}` vide la table héritée DANS ce bloc seulement : `default_type`
    // décide alors quoi que contienne le `mime.types` de l'image.
    expect(b).toMatch(/types\s*\{\s*\}/);
    expect(b).toMatch(/default_type\s+application\/manifest\+json;/);
  });

  it('garde la revalidation et nosniff, et répond 404 si le fichier manque', () => {
    const b = block('= /manifest.webmanifest');
    expect(b).toMatch(/add_header Cache-Control "no-cache" always;/);
    expect(b).toMatch(/add_header X-Content-Type-Options "nosniff" always;/);
    expect(b).toMatch(/try_files \$uri =404;/);
  });

  it('le fichier produit porte bien ce nom', () => {
    const vite = fs.readFileSync(path.join(process.cwd(), 'vite.config.js'), 'utf8');
    // vite-plugin-pwa écrit `manifest.webmanifest` par défaut ; un autre nom
    // configuré rendrait la location ci-dessus muette.
    expect(vite).not.toMatch(/manifestFilename/);
  });
});
