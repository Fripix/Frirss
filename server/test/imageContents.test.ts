import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * Ce que l'image publiée embarque du serveur compilé.
 *
 * `tsc -p server/tsconfig.json` compile tout `server/` sauf `server/test/` :
 * les tests rangés à côté de leur module (`server/ai/*.test.ts`,
 * `server/backup.test.ts`…) sortent dans `server-dist/` comme le reste, et
 * l'image les publiait (campagne 1.9.0, troisième round). On ne les exclut
 * pas de `tsconfig.json` : c'est lui que `npm run typecheck` vérifie, et ces
 * tests y perdraient leur contrôle de types. Ils sont retirés de
 * `server-dist/` dans l'étape de construction, après la compilation.
 */
const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
/** L'étape de construction : de son `FROM` au `FROM` de l'étape suivante. */
const builder = dockerfile.split(/^FROM /m)[1] ?? '';

/** Les fichiers de test rangés hors de `server/test/`, donc compilés. */
function colocatedTests(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'test' && entry.name !== 'node_modules') found.push(...colocatedTests(full));
    } else if (/\.test\.[jt]s$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe('image Docker — serveur compilé', () => {
  it('le serveur a des tests rangés à côté de ses modules, que tsc compile', () => {
    expect(colocatedTests(path.join(process.cwd(), 'server')).length).toBeGreaterThan(0);
  });

  it('l’image n’embarque pas les tests compilés du serveur', () => {
    const build = builder.indexOf('npm run build');
    const purge = builder.search(/find server-dist\b[^\n]*-name '\*\.test\.js'[^\n]*-delete/);
    expect(build).toBeGreaterThan(-1);
    expect(purge).toBeGreaterThan(build);
  });
});
