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
 * `preferences.tabs.*` était volontairement hors relevé : la refonte restructure
 * les libellés de navigation, dix onglets devenant six sections. Ces clés ont
 * depuis été retirées des 9 locales (leur seul usage restant, hors panneau
 * Préférences, a migré vers `preferences.refresh.title`) ; le test ci-dessous
 * vérifie que ce retrait reste assumé.
 *
 * Vérification des traductions et pluriels i18next : une clé appelée avec un
 * argument `count` (ex. `t('preferences.offline.imagesCached', { count })`)
 * n'est jamais stockée telle quelle dans les locales — i18next v26 la résout
 * via ses formes suffixées (`_zero`, `_one`, `_two`, `_few`, `_many`,
 * `_other`). Le test considère donc une clé du relevé présente dans une
 * locale si la clé exacte OU au moins une de ces formes suffixées y résout
 * une chaîne. Ne pas ajouter de clé "nue" en doublon des formes `_one`/
 * `_other` pour faire passer ce test : ces clés nues seraient inatteignables
 * à l'exécution (cf. review du 21/08/2026 : 18 clés mortes ajoutées puis
 * retirées pour cette raison).
 */
const DIR = path.join(process.cwd(), 'src/components/Preferences');
const PLURAL_SUFFIXES = ['', '_zero', '_one', '_two', '_few', '_many', '_other'];

/**
 * Tous les fichiers source du panneau, sous-dossiers compris. Le parcours était
 * à plat : déplacer un réglage dans un sous-dossier le rendait invisible au
 * relevé, et le garde-fou rougissait sans que rien ne soit cassé. Un
 * sous-dossier du panneau reste le panneau.
 */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Vrai si `key` ou une de ses formes pluriel suffixées résout une chaîne dans `json`. */
function resolvesInLocale(json: unknown, key: string): boolean {
  return PLURAL_SUFFIXES.some((suffix) => {
    let d: unknown = json;
    for (const part of `${key}${suffix}`.split('.')) d = (d as Record<string, unknown>)?.[part];
    return typeof d === 'string';
  });
}

function referencedKeys(): Set<string> {
  const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'));
  const src = sourceFiles(DIR)
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  const keys = new Set<string>();
  // Clé statique : simple quotes, double quotes ou backticks. Le backreference \1
  // impose la même sorte de guillemet en ouverture/fermeture, et comme le
  // caractère `$` n'appartient pas à la classe de la clé, un backtick avec
  // interpolation (`${`) ne matche jamais ici — il tombe dans la regex suivante.
  for (const m of src.matchAll(/t\(\s*(['"`])((?:preferences|admin)\.[a-zA-Z0-9_.]+)\1/g)) keys.add(m[2]);
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

  it('chaque réglage du relevé existe dans les 9 locales (formes pluriel comprises)', () => {
    const locales = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'uk'];
    const missing: string[] = [];
    for (const loc of locales) {
      const json = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), `src/locales/${loc}.json`), 'utf8'),
      );
      for (const key of baseline) {
        if (!resolvesInLocale(json, key)) missing.push(`${loc}: ${key}`);
      }
    }
    expect(
      missing,
      `traductions manquantes (clé nue et toutes formes pluriel absentes) :\n${missing.slice(0, 20).join('\n')}`,
    ).toEqual([]);
  });

  it('a bien retiré les anciens libellés d’onglets, seul retrait assumé', () => {
    const fr = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'),
    );
    expect(fr.preferences.tabs).toBeUndefined();
  });
});
