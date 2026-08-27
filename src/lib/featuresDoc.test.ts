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
 *
 * TROU COMBLÉ (2026-08-27) : la détection des routes reposait sur DEUX
 * conventions de nommage — l'identifiant de montage devait finir par
 * `Routes`, et le fichier devait porter le même nom que ce préfixe (« backup »
 * pour retrouver `backupRoutes`). `server/routes/backup.ts` respecte ni l'une
 * ni l'autre : il exporte DEUX routeurs nommés (`adminBackupRouter`,
 * `setupBackupRouter`, suffixe « Router », pas « Routes ») montés chacun sur un
 * préfixe différent, sans qu'aucun ne s'appelle « backup ». Résultat : ses cinq
 * routes étaient invisibles du garde-fou, qui restait vert quoi que dise
 * `docs/FEATURES.md` à leur sujet.
 *
 * La détection résout maintenant chaque routeur par l'IDENTIFIANT que
 * `server/index.ts` monte, jamais par le nom de fichier ni un suffixe figé :
 * un fichier peut fournir un export par défaut (identifiant = celui de
 * l'import par défaut dans `server/index.ts`) et/ou des exports nommés
 * `export const X = Router()` (identifiant = `X` lui-même). Un même fichier
 * peut ainsi fournir plusieurs routeurs montés à des préfixes différents, et
 * chaque route est attribuée au routeur qui la déclare réellement (le nom du
 * récepteur avant `.get/.post/...`), pas seulement à un `router.` générique.
 */
const ROOT = process.cwd();
const DOC = fs.readFileSync(path.join(ROOT, 'docs/FEATURES.md'), 'utf8');

/** Préfixe de montage de chaque IDENTIFIANT (pas fichier) monté dans `server/index.ts`. */
function mountPoints(): Record<string, string> {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.ts'), 'utf8');
  const mounts: Record<string, string> = {};
  for (const m of src.matchAll(/app\.use\('(\/api\/[a-z]+)',\s*(\w+)\)/g)) {
    mounts[m[2]] = m[1];
  }
  return mounts;
}

/**
 * Identifiant local sous lequel chaque fichier de `server/routes/` est
 * importé PAR DÉFAUT dans `server/index.ts` (base du nom de fichier → nom
 * importé). Un fichier sans export par défaut n'y figure simplement pas.
 */
function defaultImportNames(): Record<string, string> {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.ts'), 'utf8');
  const names: Record<string, string> = {};
  for (const m of src.matchAll(/^import (\w+) from '\.\/routes\/(\w+)\.js';/gm)) {
    names[m[2]] = m[1];
  }
  return names;
}

/** Toutes les routes déclarées, chemin complet compris. */
function declaredRoutes(): string[] {
  const mounts = mountPoints();
  const importedDefaults = defaultImportNames();
  const dir = path.join(ROOT, 'server/routes');
  const routes: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue;
    const base = file.replace(/\.ts$/, '');
    const src = fs.readFileSync(path.join(dir, file), 'utf8');

    // Les routeurs que CE fichier fournit, chacun avec son propre préfixe de
    // montage — un fichier peut en fournir plusieurs (cas de `backup.ts`).
    const receivers: { name: string; prefix: string }[] = [];

    const defaultExport = src.match(/^export default (\w+);/m);
    if (defaultExport) {
      const importedName = importedDefaults[base];
      const prefix = importedName ? mounts[importedName] : undefined;
      if (prefix) receivers.push({ name: defaultExport[1], prefix });
    }
    for (const m of src.matchAll(/^export const (\w+)\s*=\s*Router\(\)/gm)) {
      const prefix = mounts[m[1]];
      if (prefix) receivers.push({ name: m[1], prefix });
    }

    for (const { name, prefix } of receivers) {
      const calls = src.matchAll(
        new RegExp(`\\b${name}\\.(get|post|put|delete|all)\\('([^']*)'`, 'g'),
      );
      for (const m of calls) {
        const suffix = m[2] === '/' ? '' : m[2];
        routes.push(`${m[1].toUpperCase()} ${prefix}${suffix}`);
      }
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
