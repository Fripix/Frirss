import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Garde-fou des traductions.
 *
 * La commande de parité du `CLAUDE.md` ne vérifie qu'une chose : que les clés
 * du français existent ailleurs. Elle ne voit ni une clé utilisée dans le code
 * mais absente des fichiers — elle s'afficherait brute à l'utilisateur —, ni
 * une clé traduite neuf fois pour rien, ni un pluriel incomplet là où le
 * polonais et l'ukrainien en réclament quatre formes.
 *
 * CE QU'IL N'ATTRAPE PAS : une traduction fausse ou maladroite. Aucun test ne
 * le peut ; cela reste sous responsabilité humaine.
 */
const ROOT = process.cwd();
const LOCALES = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'uk', 'zh'] as const;
/** pl et uk déclinent en quatre formes ; les autres se contentent de deux. */
const PLURAL_FORMS: Record<string, string[]> = {
  pl: ['_one', '_few', '_many', '_other'],
  uk: ['_one', '_few', '_many', '_other'],
};
const DEFAULT_FORMS = ['_one', '_other'];

type Tree = Record<string, unknown>;
const load = (l: string): Tree =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `src/locales/${l}.json`), 'utf8'));
const TREES = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<string, Tree>;

function flatten(o: Tree, prefix = ''): Record<string, unknown> {
  return Object.entries(o).reduce<Record<string, unknown>>((acc, [k, v]) => {
    if (v && typeof v === 'object') Object.assign(acc, flatten(v as Tree, `${prefix}${k}.`));
    else acc[`${prefix}${k}`] = v;
    return acc;
  }, {});
}
const FLAT = Object.fromEntries(LOCALES.map((l) => [l, flatten(TREES[l])]));

const resolve = (l: string, key: string): unknown =>
  key.split('.').reduce<unknown>((d, p) => (d as Tree | undefined)?.[p], TREES[l]);

/** Vrai si la clé résout, sous sa forme nue ou sous l'une de ses formes pluriel. */
const exists = (l: string, key: string): boolean =>
  ['', '_zero', '_one', '_two', '_few', '_many', '_other']
    .some((s) => typeof resolve(l, key + s) === 'string');

/** Tout le code de l'application, tests exclus. */
function sourceText(): string {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'locales') walk(full);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        files.push(full);
      }
    }
  })(path.join(ROOT, 'src'));
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

/**
 * Clés citées par le code. On retient tout littéral en forme de clé dont la
 * famille existe — ce qui couvre `t('a.b')` comme les modules qui RENDENT une
 * clé (`backupErrors.ts`, `loginErrors.ts`) sans appeler `t` eux-mêmes.
 * Les familles interpolées (`t(`x.y.${z}`)`) sont dépliées en entier : leur
 * contenu est choisi à l'exécution, on ne peut pas savoir laquelle sert.
 */
function referencedKeys(src: string): Set<string> {
  const families = Object.keys(TREES.fr);
  const keys = new Set<string>();
  for (const m of src.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)['"`]/g)) {
    if (families.includes(m[1].split('.')[0])) keys.add(m[1]);
  }
  for (const m of src.matchAll(/t\(\s*`((?:[a-zA-Z]+\.)+)\$\{/g)) {
    const prefix = m[1].slice(0, -1);
    const node = resolve('fr', prefix);
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node as Tree)) keys.add(`${prefix}.${k}`);
    }
  }
  return keys;
}

const SRC = sourceText();
const REFERENCED = referencedKeys(SRC);

describe('couverture des traductions', () => {
  it('chaque clé citée par le code existe dans les 10 locales', () => {
    const missing: string[] = [];
    for (const l of LOCALES) {
      for (const key of REFERENCED) if (!exists(l, key)) missing.push(`${l}: ${key}`);
    }
    expect(missing, `Clés manquantes — elles s'afficheraient brutes :\n${missing.join('\n')}`).toEqual([]);
  });

  it('aucune clé traduite neuf fois sans servir', () => {
    const defined = new Set(
      Object.keys(FLAT.fr).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')),
    );
    // Second garde : une clé peut être citée sous une forme que la regex ne
    // capture pas. On exige donc aussi l'absence de toute occurrence textuelle.
    const orphans = [...defined].filter((k) => !REFERENCED.has(k) && !SRC.includes(k));
    expect(orphans, `Clés définies mais jamais utilisées :\n${orphans.join('\n')}`).toEqual([]);
  });

  it('les 10 locales ont exactement le même jeu de clés', () => {
    const drift: string[] = [];
    const strip = (keys: string[]) =>
      new Set(keys.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')));
    const ref = strip(Object.keys(FLAT.fr));
    for (const l of LOCALES.filter((x) => x !== 'fr')) {
      const here = strip(Object.keys(FLAT[l]));
      for (const k of ref) if (!here.has(k)) drift.push(`${l} : ${k} manquante`);
      for (const k of here) if (!ref.has(k)) drift.push(`${l} : ${k} en trop`);
    }
    expect(drift, `Dérive entre locales :\n${drift.join('\n')}`).toEqual([]);
  });

  it('toute clé appelée avec un compte porte ses formes pluriel', () => {
    const counted = new Set<string>();
    for (const m of SRC.matchAll(/t\(\s*['"`]([a-zA-Z][\w.]+)['"`]\s*,\s*\{[^}]*\bcount\b/g)) {
      counted.add(m[1]);
    }
    const incomplete: string[] = [];
    for (const l of LOCALES) {
      const forms = PLURAL_FORMS[l] ?? DEFAULT_FORMS;
      for (const key of counted) {
        // Une clé nue suffit quand le texte est invariable (« {{count}} MIN »).
        if (typeof resolve(l, key) === 'string') continue;
        const missing = forms.filter((f) => typeof resolve(l, key + f) !== 'string');
        if (missing.length) incomplete.push(`${l} : ${key} — manque ${missing.join(', ')}`);
      }
    }
    expect(incomplete, `Pluriels incomplets :\n${incomplete.join('\n')}`).toEqual([]);
  });
});
