import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Anti-dérive de `docs/FEATURES.md`.
 *
 * Ce test échoue si une route serveur, une variable d'environnement ou une
 * famille de traductions existe dans le code sans être mentionnée dans
 * l'inventaire. Le but est qu'on ne puisse pas ajouter une fonctionnalité en
 * oubliant de la consigner.
 *
 * CE QU'IL N'ATTRAPE PAS, et qu'aucun test ne pourrait attraper : une
 * description devenue fausse. Si une fonctionnalité change de comportement sans
 * changer de route ni de clé i18n, l'inventaire ment et le test reste vert. La
 * prose reste sous responsabilité humaine.
 */
const ROOT = process.cwd();
const DOC = fs.readFileSync(path.join(ROOT, 'docs/FEATURES.md'), 'utf8');

/** Préfixe de montage de chaque routeur, depuis `server/index.ts`. */
function mountPoints(): Record<string, string> {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.ts'), 'utf8');
  const mounts: Record<string, string> = {};
  for (const m of src.matchAll(/app\.use\('(\/api\/[a-z]+)',\s*(\w+)Routes\)/g)) {
    mounts[m[2]] = m[1];
  }
  return mounts;
}

/** Toutes les routes déclarées, chemin complet compris. */
function declaredRoutes(): string[] {
  const mounts = mountPoints();
  const dir = path.join(ROOT, 'server/routes');
  const routes: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue;
    const base = mounts[file.replace(/\.ts$/, '')];
    if (!base) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|delete|all)\('([^']*)'/g)) {
      const suffix = m[2] === '/' ? '' : m[2];
      routes.push(`${m[1].toUpperCase()} ${base}${suffix}`);
    }
  }
  return [...new Set(routes)];
}

/** Variables d'environnement documentées dans le tableau du README. */
function declaredEnvVars(): string[] {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  return [...new Set([...readme.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]))];
}

/** Familles de traductions de premier niveau. */
function i18nNamespaces(): string[] {
  const fr = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales/fr.json'), 'utf8'));
  return Object.keys(fr);
}

describe('docs/FEATURES.md suit le code', () => {
  it('mentionne chaque route serveur', () => {
    const lines = DOC.split('\n');
    const missing = declaredRoutes().filter((r) => {
      const [method, full] = r.split(' ');
      // Plusieurs méthodes partagent un même chemin (GET et PUT sur
      // /api/preferences) : il faut donc UNE ligne portant les deux, pas la
      // première ligne qui mentionne le chemin.
      return !lines.some((l) => l.includes(`\`${full}\``) && l.toUpperCase().includes(method));
    });
    expect(
      missing,
      `Routes absentes de docs/FEATURES.md :\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('mentionne chaque variable d’environnement du README', () => {
    const missing = declaredEnvVars().filter((v) => !DOC.includes(v));
    expect(
      missing,
      `Variables absentes de docs/FEATURES.md :\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('mentionne chaque famille de traductions', () => {
    const missing = i18nNamespaces().filter((ns) => !DOC.includes(`\`${ns}\``));
    expect(
      missing,
      `Familles i18n absentes de docs/FEATURES.md :\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('renvoie vers les specs qui existent encore', () => {
    const referenced = [...DOC.matchAll(/docs\/superpowers\/specs\/([\w.-]+\.md)/g)].map((m) => m[1]);
    const onDisk = new Set(fs.readdirSync(path.join(ROOT, 'docs/superpowers/specs')));
    const dangling = [...new Set(referenced)].filter((f) => !onDisk.has(f));
    expect(dangling, `Specs référencées mais absentes :\n${dangling.join('\n')}`).toEqual([]);
  });
});
