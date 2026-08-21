import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Non-régression de la refonte : aucun réglage ne doit disparaître.
 *
 * Le relevé `settings-baseline.json` a été figé avant la refonte. Ce test
 * échoue si une de ces clés n'est plus référencée nulle part dans le panneau.
 *
 * Ce qu'il n'attrape PAS, et qui reste à vérifier à l'œil : un réglage encore
 * référencé mais devenu inatteignable, ou dont l'action ne fait plus rien.
 *
 * `preferences.tabs.*` est volontairement hors relevé : la refonte restructure
 * les libellés de navigation, dix onglets devenant six sections.
 */
const DIR = path.join(process.cwd(), 'src/components/Preferences');

function referencedKeys(): Set<string> {
  const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'));
  const src = fs.readdirSync(DIR)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8'))
    .join('\n');

  const keys = new Set<string>();
  for (const m of src.matchAll(/t\(\s*'((?:preferences|admin)\.[a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/t\(\s*`((?:preferences|admin)\.[a-zA-Z0-9_.]+)\.\$\{/g)) {
    let d: unknown = fr;
    for (const part of m[1].split('.')) d = (d as Record<string, unknown>)?.[part];
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d as Record<string, unknown>)) keys.add(`${m[1]}.${k}`);
    }
  }
  return keys;
}

describe('couverture des réglages du panneau Préférences', () => {
  const baseline: string[] = JSON.parse(
    fs.readFileSync(path.join(DIR, 'settings-baseline.json'), 'utf8'),
  );

  it('fige 232 réglages', () => {
    expect(baseline).toHaveLength(232);
  });

  it('référence encore chaque réglage du relevé', () => {
    const found = referencedKeys();
    const missing = baseline.filter((k) => !found.has(k));
    expect(missing, `réglages perdus par la refonte :\n${missing.join('\n')}`).toEqual([]);
  });

  it('chaque réglage du relevé existe dans les 9 locales', () => {
    const locales = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'uk'];
    const missing: string[] = [];
    for (const loc of locales) {
      const json = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), `src/locales/${loc}.json`), 'utf8'),
      );
      for (const key of baseline) {
        let d: unknown = json;
        for (const part of key.split('.')) d = (d as Record<string, unknown>)?.[part];
        if (typeof d !== 'string') missing.push(`${loc}: ${key}`);
      }
    }
    expect(missing, `traductions manquantes :\n${missing.slice(0, 20).join('\n')}`).toEqual([]);
  });
});
