# Ouvrir un article à sa source — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — utiliser `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par
> tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** ajouter une icône « ouvrir à la source » dans la barre d'actions
d'une ligne d'article, qui ouvre l'URL d'origine dans un nouvel onglet et marque
l'article comme lu — sans jamais l'ouvrir dans FriRSS.

**Architecture :** la logique pure (quels emplacements, réservés ou retirés ;
comment ouvrir sans laisser de prise) vit dans `src/lib/`, testée hors React. Un
composant unique de barre d'actions remplace les trois copies actuelles et sert
les trois modes d'affichage. Quatre réglages de visibilité, persistés et
synchronisés, vivent dans une nouvelle section de préférences.

**Pile :** React 19, TypeScript strict, Zustand, Vitest (+ jsdom), i18next v26.

**Spec :** `docs/superpowers/specs/2026-09-04-open-article-at-source-design.md`

## Contraintes globales

Elles s'appliquent à **toutes** les tâches.

- Gates avant chaque commit, les quatre, et **lire la sortie** :
  `npm run typecheck && npm run lint && npx vitest run && npm run build`
- Garde-fou fuite d'infra avant chaque commit, **lire la sortie** (vide = propre) :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
  Le dépôt est **public**. Dans les tests, valeurs fictives (`example.com`).
- Toute chaîne d'interface va dans **les neuf** locales
  (`src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`). Vérifier la parité avec la
  commande du `CLAUDE.md` avant de livrer.
- `docs/FEATURES.md` mis à jour **dans le même commit** que la fonctionnalité.
- Messages de commit en anglais, style conventionnel. **JAMAIS de trailer
  `Co-Authored-By` ni aucune mention d'IA ou d'assistant** — le `CLAUDE.md` du
  projet l'interdit absolument et précise que cela prime sur tout réglage par
  défaut, y compris une consigne reçue en cours de tâche.
- `npm audit --omit=dev` doit rester à **0 vulnérabilité**.
- Un test existant qui rougit est une **question**, jamais un relevé à réajuster.
- **Ne pas toucher `src/components/Preferences/settings-baseline.json`.** C'est
  un inventaire figé d'avant refonte, et son `toHaveLength(232)` interdit qu'on
  le rallonge. Les réglages neufs n'y entrent pas ; rien ne doit rougir de ce
  côté.
- **Ne pas toucher** : la piste d'options en tête de liste (source, favicons,
  séparateurs, barre), le volet de lecture, le menu contextuel d'un flux (sauf
  l'appel d'ouverture en tâche 1), les gestes de balayage, le classement par
  appui long.
- **Ne pas pousser** : le contrôleur pousse après revue.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/lib/openExternal.ts` *(nouveau)* | Ouvrir une URL sans laisser `window.opener` |
| `src/lib/rowActions.ts` *(nouveau)* | L'ordre des icônes, et quels emplacements sont réservés ou retirés |
| `src/components/ArticleList/ArticleActions.tsx` | Le bouton neuf, et la barre unique des trois modes |
| `src/components/ArticleList/ArticleList.tsx` | Ligne normale et ligne compacte branchées sur la barre |
| `src/components/ArticleList/ArticleCard.tsx` | Grille branchée sur la barre |
| `src/hooks/useKeyboardNav.ts` | Le raccourci `O` passe par `openExternal` |
| `src/components/Sidebar/Sidebar.tsx` | « Ouvrir le site » passe par `openExternal` |
| `src/stores/uiStore.ts` | Les quatre réglages, persistés et synchronisés |
| `src/components/Preferences/LayoutTab.tsx` *(nouveau)* | La section « Mise en page » |
| `src/components/Preferences/Preferences.tsx` | La sixième entrée de navigation |

---

## Tâche 1 — `openExternal()`, et les deux appels existants

**Fichiers :**
- Créer : `src/lib/openExternal.ts`
- Créer : `src/lib/openExternal.test.ts`
- Modifier : `src/hooks/useKeyboardNav.ts` (le bloc `shortcuts.openOriginal`)
- Modifier : `src/components/Sidebar/Sidebar.tsx` (l'entrée « Ouvrir le site »)

**Interfaces :**
- Consomme : rien.
- Produit : `openExternal(url: string | null | undefined): void` — utilisé par
  les tâches suivantes et par les deux appelants existants.

**Pourquoi cette tâche existe.** `sanitizeHtml.ts` installe un crochet qui pose
`rel="noopener noreferrer"` sur tout lien d'article ouvrant un nouvel onglet.
Mais les deux ouvertures **par script** ne le font pas. Contrairement à
`<a target="_blank">`, pour lequel les navigateurs impliquent `noopener`,
`window.open` ne l'implique pas : la page ouverte garde une référence
`window.opener` vers FriRSS et peut le rediriger.

- [ ] **Étape 1 — Écrire les tests qui échouent**

Créer `src/lib/openExternal.test.ts` :

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openExternal } from './openExternal';

describe('openExternal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ouvre dans un nouvel onglet AVEC noopener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/article');
    // `noopener` est la raison d'être de cette fonction : sans lui, la page
    // ouverte garde `window.opener` et peut rediriger FriRSS.
    expect(open).toHaveBeenCalledWith('https://example.com/article', '_blank', 'noopener');
  });

  it("n'ouvre rien quand il n'y a pas d'URL", () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('');
    openExternal(null);
    openExternal(undefined);
    openExternal('   ');
    expect(open).not.toHaveBeenCalled();
  });
});
```

- [ ] **Étape 2 — Lancer les tests et les voir échouer**

```bash
npx vitest run src/lib/openExternal.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "./openExternal"`.

- [ ] **Étape 3 — Écrire l'implémentation**

Créer `src/lib/openExternal.ts` :

```ts
/**
 * Ouvre une URL dans un nouvel onglet, sans laisser de prise à la page ouverte.
 *
 * ⚠️ `window.open` n'implique **pas** `noopener`, contrairement à
 * `<a target="_blank">` pour lequel les navigateurs le font depuis des années.
 * Sans le troisième argument, la page ouverte garde `window.opener` vers FriRSS
 * et peut le rediriger — c'est le *reverse tabnabbing*, exactement ce dont le
 * crochet DOMPurify de `sanitizeHtml.ts` protège déjà les liens du contenu.
 * Les deux ouvertures par script du projet, elles, ne l'avaient pas.
 *
 * Une URL vide n'ouvre rien : certains articles n'en portent pas, et ouvrir
 * `about:blank` serait pire que ne rien faire.
 */
export function openExternal(url: string | null | undefined): void {
  if (!url?.trim()) return;
  window.open(url, '_blank', 'noopener');
}
```

- [ ] **Étape 4 — Lancer les tests et les voir passer**

```bash
npx vitest run src/lib/openExternal.test.ts
```

Attendu : PASS, 2 tests.

- [ ] **Étape 5 — Brancher le raccourci `O`**

Dans `src/hooks/useKeyboardNav.ts`, ajouter l'import en tête du fichier :

```ts
import { openExternal } from '../lib/openExternal';
```

puis remplacer le bloc existant :

```ts
      } else if (key === shortcuts.openOriginal) {
        e.preventDefault();
        if (store.selectedArticle?.url) {
          window.open(store.selectedArticle.url, '_blank');
        }
```

par :

```ts
      } else if (key === shortcuts.openOriginal) {
        e.preventDefault();
        openExternal(store.selectedArticle?.url);
```

- [ ] **Étape 6 — Brancher « Ouvrir le site »**

Dans `src/components/Sidebar/Sidebar.tsx`, ajouter l'import auprès des autres
imports de `../../lib/` :

```ts
import { openExternal } from '../../lib/openExternal';
```

puis remplacer le corps du `onClick` de l'entrée `sidebar.openSite` :

```ts
        onClick={() => {
          const url = feedSiteUrl(feed, getSampleArticleUrl(feed.id));
          if (url) window.open(url, '_blank');
          onClose();
        }}
```

par :

```ts
        onClick={() => {
          openExternal(feedSiteUrl(feed, getSampleArticleUrl(feed.id)));
          onClose();
        }}
```

- [ ] **Étape 7 — Vérifier qu'aucune ouverture par script ne subsiste**

```bash
git grep -n "window.open" -- src/ | grep -v "openExternal.ts"
```

Attendu : **aucune ligne**. S'il en reste une, c'est un appelant que ce plan n'a
pas vu : le signaler dans le rapport plutôt que de le corriger en silence.

- [ ] **Étape 8 — Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/lib/openExternal.ts src/lib/openExternal.test.ts src/hooks/useKeyboardNav.ts src/components/Sidebar/Sidebar.tsx
git commit -m "fix(security): open external URLs without leaving window.opener"
```

---

## Tâche 2 — `rowActions()`, la logique des emplacements

**Fichiers :**
- Créer : `src/lib/rowActions.ts`
- Créer : `src/lib/rowActions.test.ts`

**Interfaces :**
- Consomme : rien.
- Produit :
  - `type RowActionKind = 'star' | 'readLater' | 'openSource' | 'markRead'`
  - `interface RowActionSettings { star: boolean; readLater: boolean; openSource: boolean; markRead: boolean }`
  - `interface RowSlot { kind: RowActionKind; available: boolean }`
  - `const ROW_ACTION_ORDER: readonly RowActionKind[]`
  - `const DEFAULT_ROW_ACTIONS: RowActionSettings`
  - `function rowActionSlots(article: { url?: string | null }, settings: RowActionSettings): RowSlot[]`
  - `function normalizeRowActions(value: unknown): RowActionSettings`

**Le cœur de la conception.** Deux absences, deux comportements opposés :
l'article sans URL **réserve** son emplacement (la cause varie d'une ligne à
l'autre, et sans réservation le ✓ danserait dans la colonne) ; l'icône masquée
par réglage **retire** le sien (la cause vaut pour toute la liste).

- [ ] **Étape 1 — Écrire les tests qui échouent**

Créer `src/lib/rowActions.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  rowActionSlots, normalizeRowActions, ROW_ACTION_ORDER, DEFAULT_ROW_ACTIONS,
} from './rowActions';

const all = DEFAULT_ROW_ACTIONS;
const withUrl = { url: 'https://example.com/a' };
const noUrl = { url: '' };
const kinds = (article: { url?: string | null }, s = all) =>
  rowActionSlots(article, s).map((x) => x.kind);

describe('ordre des icônes', () => {
  it('est le même partout : étoile, à lire plus tard, ouvrir, marquer lu', () => {
    expect(ROW_ACTION_ORDER).toEqual(['star', 'readLater', 'openSource', 'markRead']);
  });

  it('rend les quatre dans cet ordre quand tout est actif', () => {
    expect(kinds(withUrl)).toEqual(['star', 'readLater', 'openSource', 'markRead']);
  });
});

describe('article sans URL source', () => {
  it("RÉSERVE l'emplacement au lieu de le retirer", () => {
    // Sans réservation, le ✓ remonterait d'un cran sur ces lignes-là et
    // cesserait de tomber au même endroit d'une ligne à l'autre.
    expect(kinds(noUrl)).toEqual(['star', 'readLater', 'openSource', 'markRead']);
    const slot = rowActionSlots(noUrl, all).find((s) => s.kind === 'openSource');
    expect(slot!.available).toBe(false);
  });

  it('traite une URL absente ou blanche comme absente', () => {
    for (const url of ['', '   ', null, undefined]) {
      const slot = rowActionSlots({ url }, all).find((s) => s.kind === 'openSource');
      expect(slot!.available).toBe(false);
    }
  });

  it('laisse les trois autres disponibles', () => {
    const slots = rowActionSlots(noUrl, all).filter((s) => s.kind !== 'openSource');
    expect(slots.every((s) => s.available)).toBe(true);
  });
});

describe('réglages de visibilité', () => {
  it('RETIRE l’emplacement d’une icône masquée', () => {
    expect(kinds(withUrl, { ...all, openSource: false }))
      .toEqual(['star', 'readLater', 'markRead']);
  });

  it('le réglage l’emporte sur l’absence d’URL', () => {
    // Les deux causes se présentent : le réglage gagne, l'emplacement
    // disparaît. Le réservé n'existe que pour absorber une variation d'une
    // ligne à l'autre ; masquée partout, il n'y a plus rien à absorber.
    expect(kinds(noUrl, { ...all, openSource: false }))
      .toEqual(['star', 'readLater', 'markRead']);
  });

  it('permet de tout masquer', () => {
    expect(rowActionSlots(withUrl, {
      star: false, readLater: false, openSource: false, markRead: false,
    })).toEqual([]);
  });
});

describe('normalizeRowActions', () => {
  it('complète une valeur partielle avec les défauts', () => {
    // Un réglage synchronisé depuis un appareil resté sur une version
    // antérieure ne connaît pas les clés ajoutées depuis : sans complétion,
    // `settings[kind]` vaudrait `undefined`, donc faux, et l'icône
    // disparaîtrait sans que personne l'ait demandé.
    expect(normalizeRowActions({ star: false })).toEqual({
      star: false, readLater: true, openSource: true, markRead: true,
    });
  });

  it('rend les défauts sur une valeur inutilisable', () => {
    for (const v of [null, undefined, 'oui', 42, []]) {
      expect(normalizeRowActions(v)).toEqual(DEFAULT_ROW_ACTIONS);
    }
  });

  it('ignore les clés inconnues', () => {
    expect(normalizeRowActions({ star: true, licorne: true })).toEqual(DEFAULT_ROW_ACTIONS);
  });
});
```

- [ ] **Étape 2 — Lancer les tests et les voir échouer**

```bash
npx vitest run src/lib/rowActions.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "./rowActions"`.

- [ ] **Étape 3 — Écrire l'implémentation**

Créer `src/lib/rowActions.ts` :

```ts
/** Les quatre actions d'une ligne d'article, dans leur ordre d'affichage. */
export type RowActionKind = 'star' | 'readLater' | 'openSource' | 'markRead';

/**
 * L'ordre, unique pour les trois modes d'affichage.
 *
 * ⚠️ Le ✓ reste en DERNIER, et ce n'est pas cosmétique : la spec de l'issue #10
 * note qu'en compact, le ✓ de la ligne suivante tombe exactement là où était le
 * précédent, ce qui permet d'enchaîner les clics sans bouger la souris. Insérer
 * avant lui préserve cette propriété ; le déplacer la casse.
 *
 * Avant cette liste, la ligne compacte inversait l'étoile et « à lire plus
 * tard » par rapport aux deux autres modes. Personne n'avait choisi cette
 * divergence.
 */
export const ROW_ACTION_ORDER: readonly RowActionKind[] = [
  'star', 'readLater', 'openSource', 'markRead',
] as const;

/** Quelles icônes l'utilisateur veut voir. Toutes, par défaut. */
export interface RowActionSettings {
  star: boolean;
  readLater: boolean;
  openSource: boolean;
  markRead: boolean;
}

export const DEFAULT_ROW_ACTIONS: RowActionSettings = {
  star: true, readLater: true, openSource: true, markRead: true,
};

export interface RowSlot {
  kind: RowActionKind;
  /**
   * `false` = emplacement RÉSERVÉ, vide : l'action n'existe pas pour CET
   * article. Il occupe quand même sa place, sans quoi les icônes suivantes
   * se décaleraient sur cette ligne-là.
   */
  available: boolean;
}

/**
 * Les emplacements d'une ligne, dans l'ordre.
 *
 * Deux absences, deux traitements opposés :
 *  - **article sans URL** → emplacement réservé (la cause varie par ligne) ;
 *  - **icône masquée par réglage** → emplacement retiré (la cause vaut pour
 *    toute la liste, donc rien ne se décale).
 *
 * Quand les deux se présentent, le réglage l'emporte : masquée partout, il n'y
 * a plus de variation à absorber.
 */
export function rowActionSlots(
  article: { url?: string | null },
  settings: RowActionSettings,
): RowSlot[] {
  return ROW_ACTION_ORDER
    .filter((kind) => settings[kind])
    .map((kind) => ({
      kind,
      available: kind === 'openSource' ? !!article.url?.trim() : true,
    }));
}

/**
 * Ramène une valeur venue du stockage ou de la synchronisation à un réglage
 * complet.
 *
 * ⚠️ Indispensable : un appareil resté sur une version antérieure renvoie un
 * objet auquel il manque les clés ajoutées depuis. Sans complétion,
 * `settings[kind]` vaudrait `undefined` — donc faux — et l'icône disparaîtrait
 * sans que personne l'ait demandé.
 */
export function normalizeRowActions(value: unknown): RowActionSettings {
  const src = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
  const out = { ...DEFAULT_ROW_ACTIONS };
  for (const kind of ROW_ACTION_ORDER) {
    if (typeof src[kind] === 'boolean') out[kind] = src[kind] as boolean;
  }
  return out;
}
```

- [ ] **Étape 4 — Lancer les tests et les voir passer**

```bash
npx vitest run src/lib/rowActions.test.ts
```

Attendu : PASS, 11 tests.

- [ ] **Étape 5 — Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/lib/rowActions.ts src/lib/rowActions.test.ts
git commit -m "feat(list): decide which row action slots are shown, reserved or removed"
```

---

## Tâche 3 — Le bouton, et la barre d'actions unique

**Fichiers :**
- Modifier : `src/components/ArticleList/ArticleActions.tsx`
- Modifier : `src/components/ArticleList/ArticleList.tsx` (ligne compacte et ligne normale)
- Modifier : `src/components/ArticleList/ArticleCard.tsx` (grille)
- Modifier : `src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`
- Modifier : `docs/FEATURES.md`

**Interfaces :**
- Consomme : `openExternal` (tâche 1) ; `rowActionSlots`, `RowActionSettings`,
  `DEFAULT_ROW_ACTIONS` (tâche 2).
- Produit : `<ArticleRowActions />`, et `OpenSourceButton`.

**Note sur les réglages.** La tâche 4 les branchera sur `uiStore`. Ici,
`ArticleRowActions` reçoit `DEFAULT_ROW_ACTIONS` en dur — les quatre icônes sont
donc visibles, ce qui est le comportement d'aujourd'hui plus la nouvelle.

- [ ] **Étape 1 — Écrire le libellé dans les neuf locales**

Ajouter la clé `openSource` dans la famille `articleRow` de chaque locale.
Script Node (les JSON round-trippent avec `JSON.stringify(obj, null, 2) + "\n"`) :

```bash
node -e '
const fs = require("fs");
const T = { fr: "Ouvrir à la source", en: "Open at source", de: "An der Quelle öffnen",
  es: "Abrir en el origen", it: "Apri alla fonte", nl: "Bij de bron openen",
  pl: "Otwórz u źródła", pt: "Abrir na origem", uk: "Відкрити в джерелі" };
for (const [l, v] of Object.entries(T)) {
  const p = `src/locales/${l}.json`;
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.articleRow.openSource = v;
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
}
console.log("ok");
'
```

Vérifier la parité :

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk"];const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":"parité ok")'
```

Attendu : `parité ok`.

- [ ] **Étape 2 — Ajouter le bouton et la barre**

Dans `src/components/ArticleList/ArticleActions.tsx`, ajouter en tête les
imports nécessaires, auprès de ceux déjà présents :

```ts
import { openExternal } from '../../lib/openExternal';
import { rowActionSlots, DEFAULT_ROW_ACTIONS, type RowActionSettings } from '../../lib/rowActions';
```

puis ajouter à la fin du fichier :

```tsx
interface OpenSourceButtonProps {
  onClick: (e: ReactMouseEvent) => void;
}

/**
 * Ouvrir l'article à sa source.
 *
 * Le glyphe est celui de « Ouvrir le site » dans le menu contextuel d'un flux :
 * même verbe, même signe. L'icône porte l'action (« ouvrir ailleurs »), le
 * contexte porte l'objet — un article ici, un flux là-bas.
 *
 * Pas de geste d'appui long, contrairement à l'étoile et à « à lire plus
 * tard » : cette action n'a rien à classer.
 */
export function OpenSourceButton({ onClick }: OpenSourceButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="p-1 rounded transition-colors hover:bg-black/5"
      style={{ color: 'var(--star-inactive)' }}
      title={t('articleRow.openSource')}
      aria-label={t('articleRow.openSource')}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </button>
  );
}

interface ArticleRowActionsProps {
  article: Article;
  isReadLater: boolean;
  /** Classe du conteneur : chaque mode d'affichage garde sa disposition. */
  className: string;
  /** Réglages de visibilité. La grille passe les mêmes que les lignes. */
  settings?: RowActionSettings;
  /** Utilisé par la grille, qui empêche le clic d'atteindre la carte. */
  onContainerClick?: (e: ReactMouseEvent) => void;
  onToggleStar: (e: ReactMouseEvent) => void;
  onToggleReadLater: (e: ReactMouseEvent) => void;
  onOpenSource: (e: ReactMouseEvent) => void;
  onToggleRead: (e: ReactMouseEvent) => void;
}

/**
 * La barre d'actions d'une ligne — un seul composant pour les trois modes.
 *
 * Avant, les trois boutons étaient écrits trois fois, et la ligne compacte
 * n'avait même pas de conteneur : ses boutons étaient enfants directs de la
 * ligne, donc écartés du `gap-3` de celle-ci, comme le titre et l'heure.
 *
 * Un emplacement indisponible (`available: false`) rend une case VIDE de la
 * même taille qu'un bouton, jamais rien : c'est ce qui empêche le ✓ de danser
 * d'une ligne à l'autre. Même raison que la pastille « non lu », dont la place
 * est déjà réservée quelques lignes plus haut dans `ArticleList.tsx`.
 */
export function ArticleRowActions({
  article, isReadLater, className, settings = DEFAULT_ROW_ACTIONS,
  onContainerClick, onToggleStar, onToggleReadLater, onOpenSource, onToggleRead,
}: ArticleRowActionsProps) {
  const slots = rowActionSlots(article, settings);
  if (!slots.length) return null;
  return (
    <div className={className} onClick={onContainerClick}>
      {slots.map((slot) => {
        if (!slot.available) {
          // Même boîte qu'un bouton : `p-1` autour d'un carré de 3.5.
          return (
            <span key={slot.kind} className="p-1 inline-flex" aria-hidden="true">
              <span className="w-3.5 h-3.5" />
            </span>
          );
        }
        switch (slot.kind) {
          case 'star':
            return <StarButton key={slot.kind} starred={article.starred} onClick={onToggleStar} article={article} />;
          case 'readLater':
            return <ReadLaterButton key={slot.kind} active={isReadLater} onClick={onToggleReadLater} article={article} />;
          case 'openSource':
            return <OpenSourceButton key={slot.kind} onClick={onOpenSource} />;
          case 'markRead':
            return <MarkReadButton key={slot.kind} read={article.read} onClick={onToggleRead} />;
        }
      })}
    </div>
  );
}
```

- [ ] **Étape 3 — Brancher la ligne compacte**

Dans `src/components/ArticleList/ArticleList.tsx`, remplacer les trois boutons
de la branche compacte :

```tsx
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} article={article} />
        <StarButton starred={article.starred} onClick={onToggleStar} article={article} />
        <MarkReadButton read={article.read} onClick={onToggleRead} />
```

par :

```tsx
        <ArticleRowActions
          article={article}
          isReadLater={isReadLater}
          className="flex items-center gap-1 flex-shrink-0"
          onToggleStar={onToggleStar}
          onToggleReadLater={onToggleReadLater}
          onOpenSource={onOpenSource}
          onToggleRead={onToggleRead}
        />
```

- [ ] **Étape 4 — Brancher la ligne normale**

Toujours dans `src/components/ArticleList/ArticleList.tsx`, remplacer :

```tsx
      <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
        <StarButton starred={article.starred} onClick={onToggleStar} article={article} />
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} article={article} />
        <MarkReadButton read={article.read} onClick={onToggleRead} />
      </div>
```

par :

```tsx
      <ArticleRowActions
        article={article}
        isReadLater={isReadLater}
        className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5"
        onToggleStar={onToggleStar}
        onToggleReadLater={onToggleReadLater}
        onOpenSource={onOpenSource}
        onToggleRead={onToggleRead}
      />
```

- [ ] **Étape 5 — Déclarer et passer `onOpenSource`**

Dans `src/components/ArticleList/ArticleList.tsx`, ajouter la prop à
l'interface `ArticleRowProps`, sous `onToggleReadLater` :

```ts
  onOpenSource: (e: ReactMouseEvent) => void;
```

l'ajouter à la déstructuration de `ArticleRow` :

```tsx
function ArticleRow({ article, viewMode, showSource, favicon, staggerIndex, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater, onOpenSource }: ArticleRowProps) {
```

remplacer l'import des boutons en tête de fichier :

```ts
import { StarButton, ReadLaterButton, MarkReadButton } from './ArticleActions';
```

par :

```ts
import { ArticleRowActions } from './ArticleActions';
```

et, à l'endroit où `onToggleStar` / `onToggleRead` / `onToggleReadLater` sont
passés à la ligne (le bloc qui contient
`onToggleStar={(e) => { e.stopPropagation(); toggleStar(article); }}`), ajouter :

```tsx
      onOpenSource={(e) => {
        e.stopPropagation();
        openExternal(article.url);
        // Marquage SOUS CONDITION, jamais la bascule : `toggleRead` sur un
        // article déjà lu le repasserait en non lu, l'inverse de l'intention.
        if (!article.read) toggleRead(article);
      }}
```

avec l'import correspondant en tête de fichier :

```ts
import { openExternal } from '../../lib/openExternal';
```

⚠️ Ce bloc de props existe à **deux** endroits dans ce fichier (la liste plate
et la liste groupée par date). Les deux doivent recevoir `onOpenSource`. Après
l'édition, vérifier :

```bash
grep -c "onOpenSource=" src/components/ArticleList/ArticleList.tsx
```

Attendu : **4** — deux passages depuis la liste, deux usages dans `ArticleRow`.

- [ ] **Étape 6 — Brancher la grille**

Dans `src/components/ArticleList/ArticleCard.tsx`, remplacer :

```tsx
      <div className="article-card__actions" onClick={(e) => e.stopPropagation()}>
        <StarButton starred={article.starred} onClick={onToggleStar} article={article} />
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} article={article} />
        <MarkReadButton read={article.read} onClick={onToggleRead} />
      </div>
```

par :

```tsx
      <ArticleRowActions
        article={article}
        isReadLater={isReadLater}
        className="article-card__actions"
        onContainerClick={(e) => e.stopPropagation()}
        onToggleStar={onToggleStar}
        onToggleReadLater={onToggleReadLater}
        onOpenSource={onOpenSource}
        onToggleRead={onToggleRead}
      />
```

et remplacer l'import :

```ts
import { StarButton, ReadLaterButton, MarkReadButton } from './ArticleActions';
```

par :

```ts
import { ArticleRowActions } from './ArticleActions';
```

Ajouter à l'interface des props de `ArticleCard` :

```ts
  onOpenSource: (e: ReactMouseEvent) => void;
```

l'ajouter à la déstructuration du composant, et le passer là où `ArticleList.tsx`
rend une `<ArticleCard … />` :

```tsx
      onOpenSource={(e) => {
        e.stopPropagation();
        openExternal(article.url);
        // Marquage SOUS CONDITION, jamais la bascule : `toggleRead` sur un
        // article déjà lu le repasserait en non lu, l'inverse de l'intention.
        if (!article.read) toggleRead(article);
      }}
```

- [ ] **Étape 7 — Vérifier à l'œil, sur les trois modes**

```bash
npm run dev
```

Ouvrir l'application, puis vérifier — c'est le seul moyen : aucun test ne rend
ces composants.

1. **Liste normale** : quatre icônes en colonne, ordre étoile → à lire plus tard
   → ouvrir → ✓.
2. **Liste compacte** : quatre icônes en ligne, **même ordre** (avant, l'étoile
   et « à lire plus tard » y étaient inversées), écartement régulier et resserré.
3. **Grille** : quatre icônes, révélées au survol sur un pointeur, toujours
   visibles au doigt.
4. **Un clic sur l'icône neuve** ouvre un onglet vers l'article **et** marque la
   ligne lue — sans ouvrir l'article dans FriRSS.
5. **Sous le filtre « Non lus »**, la ligne disparaît après confirmation du
   serveur. C'est voulu.
6. **Un article déjà lu** : le clic ouvre l'onglet et ne le repasse **pas** en
   non lu.

- [ ] **Étape 8 — Mettre `docs/FEATURES.md` à jour**

Dans la section **`## Liste d'articles`**, consigner : la quatrième icône et ce
que fait son clic (ouvrir, marquer lu **sous condition**, sans sélectionner
l'article) ; la conséquence sous le filtre « Non lus », où la ligne part après
confirmation du serveur ; la barre unique aux trois modes, avec le fait que la
ligne compacte n'avait aucun conteneur et héritait du `gap-3` de la ligne ;
l'ordre désormais identique partout et la raison du ✓ en dernier (l'enchaînement
de clics de l'issue #10) ; et le piège de l'emplacement **réservé** pour un
article sans URL, opposé à l'emplacement **retiré** par réglage.

- [ ] **Étape 9 — Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/components/ArticleList/ src/locales/ docs/FEATURES.md
git commit -m "feat(list): open an article at its source from the row"
```

---

## Tâche 4 — Les quatre réglages, et la section « Mise en page »

**Fichiers :**
- Modifier : `src/stores/uiStore.ts`
- Créer : `src/components/Preferences/LayoutTab.tsx`
- Modifier : `src/components/Preferences/Preferences.tsx`
- Modifier : `src/components/ArticleList/ArticleList.tsx`, `ArticleCard.tsx` (passer les réglages)
- Modifier : `src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`
- Modifier : `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`

**Interfaces :**
- Consomme : `RowActionSettings`, `DEFAULT_ROW_ACTIONS`, `normalizeRowActions`,
  `RowActionKind` (tâche 2) ; `<ArticleRowActions settings=… />` (tâche 3).
- Produit : `useUiStore(s => s.rowActions)` et `setRowAction(kind, visible)`.

**Un seul objet, pas quatre booléens.** Une clé unique en stockage et une seule
entrée dans les deux listes de synchronisation ; ajouter une cinquième icône un
jour ne touchera pas ces listes.

- [ ] **Étape 1 — Ajouter le réglage au magasin**

Dans `src/stores/uiStore.ts`, ajouter l'import :

```ts
import { normalizeRowActions, type RowActionKind, type RowActionSettings } from '../lib/rowActions';
```

déclarer dans l'interface d'état, auprès de `showFavicons` :

```ts
  /** Quelles icônes d'action apparaissent sur une ligne d'article. */
  rowActions: RowActionSettings;
  setRowAction: (kind: RowActionKind, visible: boolean) => void;
```

et implémenter, auprès de `toggleFavicons` :

```ts
  // Icônes d'action d'une ligne d'article (Préférences → Mise en page)
  rowActions: normalizeRowActions(loadJson('frirss_rowActions', null)),
  setRowAction: (kind, visible) => {
    set((state) => {
      const next = { ...state.rowActions, [kind]: visible };
      localStorage.setItem('frirss_rowActions', JSON.stringify(next));
      return { rowActions: next };
    });
  },
```

- [ ] **Étape 2 — Le faire survivre à la synchronisation**

Toujours dans `src/stores/uiStore.ts` :

1. ajouter `'rowActions'` au tableau `jsonKeys` ;
2. ajouter `'rowActions'` au tableau exporté `UI_SYNC_KEYS` ;
3. dans la boucle de restauration, normaliser comme le fait déjà
   `offlineImagePreset` — remplacer :

```ts
        const value = k === 'offlineImagePreset' ? normalizeImagePreset(prefs[k]) : prefs[k];
```

par :

```ts
        const value = k === 'offlineImagePreset' ? normalizeImagePreset(prefs[k])
          : k === 'rowActions' ? normalizeRowActions(prefs[k])
          : prefs[k];
```

⚠️ Sans le point 3, un appareil resté sur une version antérieure renverrait un
objet incomplet et ferait disparaître des icônes en silence.

- [ ] **Étape 3 — Écrire les libellés dans les neuf locales**

```bash
node -e '
const fs = require("fs");
const T = {
 fr: {section:"Mise en page", title:"Icônes d’action des articles", hint:"Choisissez les icônes affichées sur chaque ligne d’article. Les gestes, les raccourcis et le volet de lecture ne changent pas.", star:"Favori", readLater:"À lire plus tard", openSource:"Ouvrir à la source", markRead:"Marquer comme lu"},
 en: {section:"Layout", title:"Article action icons", hint:"Choose which icons appear on each article row. Gestures, shortcuts and the reading pane are unaffected.", star:"Star", readLater:"Read later", openSource:"Open at source", markRead:"Mark as read"},
 de: {section:"Layout", title:"Aktionssymbole für Artikel", hint:"Wählen Sie, welche Symbole in jeder Artikelzeile erscheinen. Gesten, Tastenkürzel und der Lesebereich bleiben unverändert.", star:"Favorit", readLater:"Später lesen", openSource:"An der Quelle öffnen", markRead:"Als gelesen markieren"},
 es: {section:"Diseño", title:"Iconos de acción de los artículos", hint:"Elija qué iconos aparecen en cada fila de artículo. Los gestos, los atajos y el panel de lectura no cambian.", star:"Favorito", readLater:"Leer más tarde", openSource:"Abrir en el origen", markRead:"Marcar como leído"},
 it: {section:"Layout", title:"Icone di azione degli articoli", hint:"Scegli quali icone appaiono su ogni riga di articolo. Gesti, scorciatoie e riquadro di lettura non cambiano.", star:"Preferito", readLater:"Leggi dopo", openSource:"Apri alla fonte", markRead:"Segna come letto"},
 nl: {section:"Lay-out", title:"Actiepictogrammen voor artikelen", hint:"Kies welke pictogrammen op elke artikelregel verschijnen. Gebaren, sneltoetsen en het leespaneel veranderen niet.", star:"Favoriet", readLater:"Later lezen", openSource:"Bij de bron openen", markRead:"Markeren als gelezen"},
 pl: {section:"Układ", title:"Ikony akcji artykułu", hint:"Wybierz, które ikony pojawiają się w każdym wierszu artykułu. Gesty, skróty i panel czytania pozostają bez zmian.", star:"Ulubione", readLater:"Przeczytaj później", openSource:"Otwórz u źródła", markRead:"Oznacz jako przeczytane"},
 pt: {section:"Disposição", title:"Ícones de ação dos artigos", hint:"Escolha os ícones que aparecem em cada linha de artigo. Gestos, atalhos e o painel de leitura não mudam.", star:"Favorito", readLater:"Ler mais tarde", openSource:"Abrir na origem", markRead:"Marcar como lido"},
 uk: {section:"Компонування", title:"Піктограми дій статті", hint:"Оберіть, які піктограми з’являються в кожному рядку статті. Жести, скорочення та панель читання не змінюються.", star:"Обране", readLater:"Прочитати пізніше", openSource:"Відкрити в джерелі", markRead:"Позначити прочитаним"},
};
for (const [l, v] of Object.entries(T)) {
  const p = `src/locales/${l}.json`;
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.preferences.sections.layout = v.section;
  d.preferences.layout = { title: v.title, hint: v.hint, star: v.star,
    readLater: v.readLater, openSource: v.openSource, markRead: v.markRead };
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
}
console.log("ok");
'
```

Vérifier la parité avec la commande de la tâche 3, étape 1. Attendu : `parité ok`.

- [ ] **Étape 4 — Écrire la section**

Créer `src/components/Preferences/LayoutTab.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { ROW_ACTION_ORDER } from '../../lib/rowActions';
import ToggleSwitch from '../ToggleSwitch';

/**
 * Préférences → Mise en page.
 *
 * Ces interrupteurs ne concernent que la barre d'actions d'une LIGNE. Le volet
 * de lecture garde ses propres boutons : masquer le ✓ de la liste ne doit pas
 * retirer le moyen de marquer lu l'article qu'on est en train de lire.
 *
 * Ce n'est pas non plus la piste d'options en tête de liste (source, favicons,
 * séparateurs de dates), qui règle ce que la ligne montre du CONTENU, là où
 * ceci règle quels OUTILS l'interface propose.
 */
export default function LayoutTab() {
  const { t } = useTranslation();
  const rowActions = useUiStore((s) => s.rowActions);
  const setRowAction = useUiStore((s) => s.setRowAction);

  return (
    <div className="max-w-xl">
      <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--list-title)' }}>
        {t('preferences.layout.title')}
      </h3>
      <p className="text-[11px] opacity-70 mb-3" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.layout.hint')}
      </p>

      {ROW_ACTION_ORDER.map((kind) => (
        <div key={kind} className="flex items-start justify-between gap-4 select-none mt-4">
          <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
            {t(`preferences.layout.${kind}`)}
          </span>
          <span className="mt-0.5">
            <ToggleSwitch
              checked={rowActions[kind]}
              onChange={(v: boolean) => setRowAction(kind, v)}
              ariaLabel={t(`preferences.layout.${kind}`)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Étape 5 — Ajouter l'entrée de navigation**

Dans `src/components/Preferences/Preferences.tsx` :

1. importer, auprès des autres onglets :

```ts
import LayoutTab from './LayoutTab';
```

2. ajouter `'layout'` au tableau `SECTIONS`, **entre `appearance` et `labels`** :

```ts
  const SECTIONS = ['general', 'appearance', 'layout', 'labels', 'feeds', 'offline'] as const;
```

3. rendre le volet, à la suite de celui d'`appearance` :

```tsx
          {visited.has('layout') && <Pane id="layout" tab={tab}><LayoutTab /></Pane>}
```

- [ ] **Étape 6 — Brancher les réglages sur les lignes**

Dans `src/components/ArticleList/ArticleList.tsx`, lire le réglage auprès des
autres sélecteurs `useUiStore` du composant de liste :

```ts
  const rowActions = useUiStore((s) => s.rowActions);
```

ajouter `rowActions: RowActionSettings;` aux interfaces de props d'`ArticleRow`
(dans `ArticleList.tsx`) et d'`ArticleCard` (dans `ArticleCard.tsx`), l'ajouter
à leurs déstructurations, le passer aux deux composants là où ils sont rendus :

```tsx
      rowActions={rowActions}
```

et l'ajouter aux **trois** `<ArticleRowActions />` posés en tâche 3 :

```tsx
          settings={rowActions}
```

Vérifier ensuite :

```bash
grep -c "settings={rowActions}" src/components/ArticleList/ArticleList.tsx src/components/ArticleList/ArticleCard.tsx
```

Attendu : **2** pour `ArticleList.tsx` (compacte + normale), **1** pour
`ArticleCard.tsx`.

- [ ] **Étape 7 — Vérifier à l'œil**

```bash
npm run dev
```

1. **Préférences → Mise en page** : quatre interrupteurs, tous actifs.
2. **Décocher « Ouvrir à la source »** : l'icône disparaît des trois modes, et
   les autres se resserrent — l'emplacement est **retiré**, pas réservé.
3. **Recharger la page** : le réglage tient (`localStorage`).
4. **Tout décocher** : les lignes n'ont plus d'icônes, et rien ne casse.
5. **Un article sans URL source**, réglage « Ouvrir » actif : l'emplacement
   reste **vide mais présent**, le ✓ ne bouge pas d'une ligne à l'autre.

- [ ] **Étape 8 — Documenter**

Dans `docs/FEATURES.md`, section **`## Préférences`** : la nouvelle section
« Mise en page », ce qu'elle règle, et ce qu'elle ne règle **pas** — ni le volet
de lecture, ni la piste d'options en tête de liste. Y consigner aussi le piège
de `normalizeRowActions` : un appareil resté sur une version antérieure renvoie
un objet incomplet, et sans normalisation des icônes disparaîtraient en silence,
côté chargement **comme** côté restauration synchronisée.

Dans `docs/RELEASE-NEXT.md`, sous « Fonctionnalités » :

```markdown
- **Ouvrir un article à sa source depuis la liste.** Une icône sur chaque ligne
  ouvre l'article sur le site d'origine dans un nouvel onglet et le marque lu,
  sans l'ouvrir dans FriRSS — pour qui préfère lire ses flux à la source.
  Demandé dans l'issue #11.
- **Choisir les icônes affichées sur une ligne.** Une nouvelle section
  « Mise en page » dans les préférences permet d'afficher ou de masquer chacune
  des quatre icônes, une par une. Les gestes, les raccourcis et le volet de
  lecture ne changent pas.
```

- [ ] **Étape 9 — Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
npm audit --omit=dev
```

Attendu : `found 0 vulnerabilities`.

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/stores/uiStore.ts src/components/Preferences/ src/components/ArticleList/ src/locales/ docs/FEATURES.md docs/RELEASE-NEXT.md
git commit -m "feat(preferences): choose which action icons a row shows"
```

---

## Hors périmètre

Le volet de lecture, qui porte déjà « Ouvrir l'original » et le raccourci `O`.
Le menu contextuel d'un flux, qui répond déjà à la seconde moitié de l'issue #11
— seul son appel d'ouverture change, en tâche 1. La piste d'options en tête de
liste. Et la découvrabilité de « Ouvrir le site », qui relève du README.
