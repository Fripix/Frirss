# Marquer lu au-dessus / en dessous — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Les étapes sont
> des cases à cocher (`- [ ]`).

**But :** depuis le menu contextuel d'un article, marquer lus tous les articles
plus anciens (« en dessous ») ou plus récents (« au-dessus ») dans la vue
courante — issue #15.

**Architecture :** deux entrées de plus dans le modèle pur du menu, un module pur
pour les conversions d'horodatage, un appel d'API supplémentaire pour le sens
« au-dessus », une action de store qui orchestre, et le câblage du composant.
« En dessous » tient en un appel (`mark-all-as-read` avec `ts`) ; « au-dessus »
relève les identifiants plus récents puis marque par lots.

**Spec :** `docs/superpowers/specs/2026-09-24-mark-above-below-read-design.md`

**Stack :** TypeScript strict, React 18, Zustand, vitest, i18next v26.

## Contraintes globales

- **Gates avant CHAQUE commit** : `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **Garde-fou fuite d'infra avant CHAQUE commit** (sortie vide attendue) :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- **Messages de commit** : conventionnels, en anglais, neutres. **Jamais** de
  trailer `Co-Authored-By`, jamais de mention d'IA ni de la conversation.
- **Pas de push** : le contrôleur pousse, pas l'agent d'exécution.
- **TDD** : test d'abord, vu ROUGE, puis le code, puis VERT.
- **i18n** : toute chaîne d'interface dans **les dix** locales
  (`fr, en, de, es, it, nl, pl, pt, uk, zh`). Édition par script Node
  (`JSON.stringify(obj, null, 2) + "\n"`), jamais à la main.
- **Rédaction** : commentaires de production et titres de tests en **français
  accentué**, comme tout le dépôt.
- **Libellés retenus** : `Tout lu en dessous` / `Tout lu au-dessus` (fr),
  `Mark below as read` / `Mark above as read` (en). Sans flèche dans la chaîne :
  ce menu n'a pas d'icônes, et un « ↓ » se lit « flèche vers le bas » au lecteur
  d'écran pour une information que les mots portent déjà.
- **Branche** : `dev`.

---

### Task 1 : les deux entrées du menu, et leurs dix traductions

**Files:**
- Modify: `src/lib/articleMenu.ts`
- Modify: `src/lib/articleMenu.test.ts`
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json`

**Interfaces:**
- Produit : deux valeurs de plus dans `ArticleMenuKind` — `markBelowRead`,
  `markAboveRead` — et les entrées correspondantes rendues par
  `articleMenuItems`, avec les clés `articleRow.markBelowRead` et
  `articleRow.markAboveRead`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Dans `src/lib/articleMenu.test.ts`, remplacer les deux premiers cas par ceux-ci
et ajouter le troisième :

```ts
  it('liste les sept entrées, dans l’ordre, pour un article non lu et non favori avec URL', () => {
    expect(articleMenuItems(base, false)).toEqual([
      { kind: 'openSource', labelKey: 'articleRow.openSource' },
      { kind: 'toggleRead', labelKey: 'articleRow.markRead' },
      { kind: 'markBelowRead', labelKey: 'articleRow.markBelowRead' },
      { kind: 'markAboveRead', labelKey: 'articleRow.markAboveRead' },
      { kind: 'toggleStar', labelKey: 'articleRow.addStar' },
      { kind: 'toggleReadLater', labelKey: 'articleRow.addReadLater' },
      { kind: 'copyLink', labelKey: 'articleRow.copyLink' },
    ]);
  });

  it('les libellés suivent l’état de l’article, sauf ceux des deux marquages de plage', () => {
    const labels = articleMenuItems({ ...base, read: true, starred: true }, true).map((i) => i.labelKey);
    expect(labels).toEqual([
      'articleRow.openSource',
      'articleRow.markUnread',
      'articleRow.markBelowRead',
      'articleRow.markAboveRead',
      'articleRow.removeStar',
      'articleRow.removeReadLater',
      'articleRow.copyLink',
    ]);
  });

  it('garde les deux marquages de plage même sans URL — ils ne dépendent pas du lien', () => {
    expect(articleMenuItems({ ...base, url: '' }, false).map((i) => i.kind)).toEqual([
      'toggleRead', 'markBelowRead', 'markAboveRead', 'toggleStar', 'toggleReadLater',
    ]);
  });
```

Le troisième cas de la suite existante (« drops open-at-source and copy-link
without a URL ») est remplacé par celui ci-dessus : il affirmait la même chose
sur une liste qui n'existe plus.

- [ ] **Étape 2 : voir les tests échouer**

Run: `npx vitest run src/lib/articleMenu.test.ts`
Expected: ÉCHEC — les entrées `markBelowRead` / `markAboveRead` manquent.

- [ ] **Étape 3 : écrire le code**

Dans `src/lib/articleMenu.ts` :

```ts
export type ArticleMenuKind =
  | 'openSource' | 'toggleRead' | 'markBelowRead' | 'markAboveRead'
  | 'toggleStar' | 'toggleReadLater' | 'copyLink';
```

et, dans `articleMenuItems`, juste après le `push` de `toggleRead` :

```ts
  // Marquages de plage (issue #15) : placés contre « Marquer lu », dont ils
  // sont l'extension, et TOUJOURS présents — la position d'une ligne dans la
  // liste chargée ne dit pas si le flux contient quelque chose au-dessus ou en
  // dessous, donc les masquer selon l'index mentirait une fois sur deux.
  items.push({ kind: 'markBelowRead', labelKey: 'articleRow.markBelowRead' });
  items.push({ kind: 'markAboveRead', labelKey: 'articleRow.markAboveRead' });
```

- [ ] **Étape 4 : ajouter les deux clés dans les dix locales**

Valeurs françaises et anglaises imposées :

```json
"markBelowRead": "Tout lu en dessous",
"markAboveRead": "Tout lu au-dessus"
```
```json
"markBelowRead": "Mark below as read",
"markAboveRead": "Mark above as read"
```

Les huit autres locales reçoivent une traduction du même registre — le verbe
déjà employé par le bouton « Tout lu » de chaque locale (clé
`articleList.markAllRead`), plus la direction. Écrire les JSON par script Node.

- [ ] **Étape 5 : voir les tests passer, et la parité des locales**

```bash
npx vitest run src/lib/articleMenu.test.ts src/lib/i18nCoverage.test.ts
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk","zh"].filter(l=>fs.existsSync(`src/locales/${l}.json`));const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":`parité ok (${L.length} locales)`)'
```
Attendu : tests verts et `parité ok (10 locales)`.

- [ ] **Étape 6 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/lib/articleMenu.ts src/lib/articleMenu.test.ts src/locales
git commit -m "feat(menu): offer mark-above and mark-below entries"
```

---

### Task 2 : les bornes temporelles (module pur)

**Files:**
- Create: `src/lib/relativeRead.ts`
- Test: `src/lib/relativeRead.test.ts`

**Interfaces:**
- Produit : `exclusiveOlderThanUsec(publishedMs: number): string` et
  `exclusiveNewerThanSec(publishedMs: number): number`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/lib/relativeRead.test.ts
import { describe, it, expect } from 'vitest';
import { exclusiveOlderThanUsec, exclusiveNewerThanSec } from './relativeRead';

describe('exclusiveOlderThanUsec', () => {
  it('convertit les millisecondes en microsecondes', () => {
    // 1 700 000 000 000 ms → 1 700 000 000 000 000 µs, moins une pour l'exclusion
    expect(exclusiveOlderThanUsec(1_700_000_000_000)).toBe('1699999999999999');
  });

  it('exclut l’article cliqué : sa propre borne est strictement avant lui', () => {
    const published = 1_700_000_000_000;
    expect(Number(exclusiveOlderThanUsec(published))).toBeLessThan(published * 1000);
  });

  it('rend une chaîne — l’API reçoit un entier de 16 chiffres que JSON arrondirait', () => {
    expect(typeof exclusiveOlderThanUsec(1_700_000_000_000)).toBe('string');
  });
});

describe('exclusiveNewerThanSec', () => {
  it('convertit les millisecondes en secondes', () => {
    expect(exclusiveNewerThanSec(1_700_000_000_000)).toBe(1_700_000_001);
  });

  it('exclut l’article cliqué : sa borne est strictement après lui', () => {
    const published = 1_700_000_000_000;
    expect(exclusiveNewerThanSec(published)).toBeGreaterThan(published / 1000);
  });

  it('arrondit vers le bas avant d’exclure, pour ne pas sauter deux secondes', () => {
    expect(exclusiveNewerThanSec(1_700_000_000_900)).toBe(1_700_000_001);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Run: `npx vitest run src/lib/relativeRead.test.ts`
Expected: ÉCHEC — `Failed to resolve import "./relativeRead"`.

- [ ] **Étape 3 : écrire le module**

```ts
// src/lib/relativeRead.ts
/**
 * Bornes temporelles d'un « tout lu en dessous / au-dessus » (issue #15).
 *
 * Trois unités se croisent dans ce seul geste : `Article.published` est en
 * MILLISECONDES, `mark-all-as-read` attend des MICROSECONDES (`ts`), et la
 * borne `ot` de `stream/items/ids` attend des SECONDES. Chaque conversion
 * décale d'une unité pour EXCLURE l'article cliqué : il garde son état, c'est
 * ce qu'on attend d'un « en dessous ».
 * Spec : docs/superpowers/specs/2026-09-24-mark-above-below-read-design.md
 */

/** Tout ce qui est strictement plus ancien que cet article, en microsecondes. */
export function exclusiveOlderThanUsec(publishedMs: number): string {
  // Chaîne, pas nombre : 16 chiffres dépassent la précision sûre d'un `number`
  // dès qu'un appelant s'aviserait de les additionner.
  return String(publishedMs * 1000 - 1);
}

/**
 * Tout ce qui est strictement plus récent, en secondes.
 *
 * ⚠️ Conséquence assumée de la seconde d'écart : les articles publiés dans la
 * MÊME seconde que celui qu'on a cliqué ne sont pas marqués. C'est le sens
 * prudent — mieux vaut en oublier un que marquer lu l'article qu'on regarde.
 */
export function exclusiveNewerThanSec(publishedMs: number): number {
  return Math.floor(publishedMs / 1000) + 1;
}
```

- [ ] **Étape 4 : voir les tests passer**

Run: `npx vitest run src/lib/relativeRead.test.ts`
Expected: SUCCÈS, 6 tests.

- [ ] **Étape 5 : prouver que l'exclusion mord**

Retirer les décalages (`- 1` et `+ 1`), relancer le fichier : les deux tests
d'exclusion doivent ROUGIR. Remettre les décalages, ils reverdissent. Rapporter
les deux sorties.

- [ ] **Étape 6 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/lib/relativeRead.ts src/lib/relativeRead.test.ts
git commit -m "feat(read): time bounds that never include the clicked article"
```

---

### Task 3 : relever les identifiants plus récents

**Files:**
- Modify: `src/api/feeds.ts`
- Test: `src/api/feeds.itemIds.test.ts`

**Interfaces:**
- Produit : `itemIdsNewerThan(streamId: string, sinceSec: number): Promise<string[]>`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/api/feeds.itemIds.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { itemIdsNewerThan } from './feeds';

const get = vi.mocked(client.get);

beforeEach(() => { vi.clearAllMocks(); });

describe('itemIdsNewerThan', () => {
  it('demande le bon flux, la borne basse et une grande page', async () => {
    get.mockResolvedValue({ data: { itemRefs: [{ id: '1' }], continuation: null } } as never);

    await itemIdsNewerThan('feed/21', 1_700_000_001);

    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain('/stream/items/ids');
    expect(config.params.s).toBe('feed/21');
    expect(config.params.ot).toBe(1_700_000_001);
    expect(config.params.n).toBe(1000);
  });

  it('suit la continuation jusqu’à épuisement et rend tous les identifiants', async () => {
    get
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '1' }, { id: '2' }], continuation: 'C1' } } as never)
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '3' }], continuation: null } } as never);

    await expect(itemIdsNewerThan('feed/21', 1)).resolves.toEqual(['1', '2', '3']);
    expect((get.mock.calls[1][1] as { params: Record<string, unknown> }).params.c).toBe('C1');
  });

  it('rend une liste vide plutôt que des trous quand la réponse est muette', async () => {
    get.mockResolvedValue({ data: {} } as never);
    await expect(itemIdsNewerThan('feed/21', 1)).resolves.toEqual([]);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Run: `npx vitest run src/api/feeds.itemIds.test.ts`
Expected: ÉCHEC — `itemIdsNewerThan is not a function`.

- [ ] **Étape 3 : écrire la fonction**

Dans `src/api/feeds.ts`, à côté de `fetchStreamPage` :

```ts
/**
 * Les identifiants des articles plus récents qu'un instant donné, dans un flux.
 *
 * Il n'existe pas d'équivalent de `mark-all-as-read` pour ce sens : marquer
 * « au-dessus » suppose de connaître la liste. Une page d'identifiants est
 * légère (quelques dizaines de kilo-octets pour un millier), donc on suit la
 * continuation jusqu'au bout plutôt que de plafonner arbitrairement.
 */
export async function itemIdsNewerThan(streamId: string, sinceSec: number): Promise<string[]> {
  const ids: string[] = [];
  let continuation: string | null = null;
  for (;;) {
    const params: Record<string, string | number> = {
      output: 'json', n: 1000, s: streamId, ot: sinceSec,
    };
    if (continuation) params.c = continuation;
    const { data } = await client.get<{ itemRefs?: { id: string }[]; continuation?: string | null }>(
      `${BASE}/stream/items/ids`,
      { params },
    );
    for (const ref of data.itemRefs || []) ids.push(ref.id);
    continuation = data.continuation || null;
    if (!continuation) return ids;
  }
}
```

- [ ] **Étape 4 : voir les tests passer**

Run: `npx vitest run src/api/feeds.itemIds.test.ts`
Expected: SUCCÈS, 3 tests.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/api/feeds.ts src/api/feeds.itemIds.test.ts
git commit -m "feat(api): list the item ids newer than a given instant"
```

---

### Task 4 : le corpus de recherche suit un marquage de plage

**Files:**
- Modify: `src/lib/searchCorpus.ts`
- Modify: `src/lib/searchCorpus.test.ts`

**Interfaces:**
- Consomme : `Corpus`, `CorpusEntry` (déjà dans le module).
- Produit : `patchCorpusByDate(corpus: Corpus, bound: { direction: 'above' | 'below'; publishedMs: number }, patch: Partial<Article>): Corpus`.

**Pourquoi cette tâche existe :** `markAllAsRead` jette le corpus
(`dropSearchCorpus`) parce qu'il ne peut pas savoir ce qu'il a touché. Ici, si :
le corpus connaît la date de chacun de ses articles, donc le même critère
s'applique exactement. Le garder évite de refermer la recherche de
l'utilisateur au milieu de son travail — ce que `dropSearchCorpus` imposerait,
puisqu'un balayage en cours perdrait son corpus sous lui.

- [ ] **Étape 1 : écrire les tests qui échouent**

À ajouter dans `src/lib/searchCorpus.test.ts` :

```ts
describe('patchCorpusByDate', () => {
  const daté = (id: string, publishedMs: number): CorpusEntry => ({
    article: { ...art(id, 'titre'), published: publishedMs },
    haystack: 'titre',
  });

  const corpus = () => addPage(createCorpus('feed/1', '7', 0), [
    daté('vieux', 1_000), daté('pivot', 2_000), daté('neuf', 3_000),
  ], null, 0);

  it('marque ce qui est plus ancien, sans toucher au pivot ni au plus récent', () => {
    const c = patchCorpusByDate(corpus(), { direction: 'below', publishedMs: 2_000 }, { read: true });
    expect(c.entries.map((e) => [e.article.id, e.article.read])).toEqual([
      ['vieux', true], ['pivot', false], ['neuf', false],
    ]);
  });

  it('marque ce qui est plus récent, sans toucher au pivot ni au plus ancien', () => {
    const c = patchCorpusByDate(corpus(), { direction: 'above', publishedMs: 2_000 }, { read: true });
    expect(c.entries.map((e) => [e.article.id, e.article.read])).toEqual([
      ['vieux', false], ['pivot', false], ['neuf', true],
    ]);
  });

  it('ne touche pas au texte cherchable : seul l’état change', () => {
    const c = patchCorpusByDate(corpus(), { direction: 'below', publishedMs: 2_000 }, { read: true });
    expect(c.entries.map((e) => e.haystack)).toEqual(['titre', 'titre', 'titre']);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Run: `npx vitest run src/lib/searchCorpus.test.ts`
Expected: ÉCHEC — `patchCorpusByDate is not exported`.

- [ ] **Étape 3 : écrire la fonction**

```ts
/**
 * Répercute un marquage de plage (« tout lu en dessous / au-dessus ») sur le
 * corpus gardé. Contrairement à un « tout marquer comme lu », le critère est
 * connu exactement — une date — donc le corpus reste juste et n'a pas à être
 * jeté.
 */
export function patchCorpusByDate(
  corpus: Corpus,
  bound: { direction: 'above' | 'below'; publishedMs: number },
  patch: Partial<Article>,
): Corpus {
  const touche = (published: number) => bound.direction === 'below'
    ? published < bound.publishedMs
    : published > bound.publishedMs;
  return {
    ...corpus,
    entries: corpus.entries.map((e) => (
      touche(e.article.published) ? { ...e, article: { ...e.article, ...patch } } : e
    )),
  };
}
```

- [ ] **Étape 4 : voir les tests passer**

Run: `npx vitest run src/lib/searchCorpus.test.ts`
Expected: SUCCÈS (13 tests existants + 3 nouveaux).

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/lib/searchCorpus.ts src/lib/searchCorpus.test.ts
git commit -m "feat(search): apply a dated bulk read to the kept corpus"
```

---

### Task 5 : l'action du store

**Files:**
- Modify: `src/stores/feedStore.ts`
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json` (une clé de toast)
- Test: `src/stores/feedStore.markRange.test.ts`

**Interfaces:**
- Consomme : `exclusiveOlderThanUsec`, `exclusiveNewerThanSec` (Task 2),
  `itemIdsNewerThan` (Task 3), `patchCorpusByDate` (Task 4),
  `markAllAsRead(streamId, timestampUsec)` et `markAsRead(ids)` (déjà dans
  `src/api/feeds.ts`), `pushI18nToast(key, opts)` (déjà dans le store).
- Produit : `markReadRelative(article: Article, direction: 'above' | 'below'): Promise<void>`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/stores/feedStore.markRange.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    itemIdsNewerThan: vi.fn().mockResolvedValue([]),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
  };
});

import { markAllAsRead, markAsRead, itemIdsNewerThan } from '../api/feeds';
import { useFeedStore } from './feedStore';
import type { Article } from '../types';

const article = (id: string, publishedMs: number): Article => ({
  id, title: id, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: publishedMs, read: false, starred: false,
  labels: [], tags: [],
});

const vieux = article('vieux', 1_000);
const pivot = article('pivot', 2_000);
const neuf = article('neuf', 3_000);

beforeEach(() => {
  vi.clearAllMocks();
  useFeedStore.setState({
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'all',
    articles: [neuf, pivot, vieux],
  } as never);
});

describe('markReadRelative — en dessous', () => {
  it('marque en un seul appel, borné juste avant l’article cliqué', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(markAllAsRead).toHaveBeenCalledWith('feed/1', '1999999');
    expect(itemIdsNewerThan).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus anciennes, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      ['neuf', false], ['pivot', false], ['vieux', true],
    ]);
  });
});

describe('markReadRelative — au-dessus', () => {
  it('relève les identifiants plus récents puis les marque par lots de 100', async () => {
    vi.mocked(itemIdsNewerThan).mockResolvedValue(Array.from({ length: 150 }, (_, i) => `id${i}`));

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(itemIdsNewerThan).toHaveBeenCalledWith('feed/1', 3);
    expect(markAsRead).toHaveBeenCalledTimes(2);
    expect((vi.mocked(markAsRead).mock.calls[0][0] as string[]).length).toBe(100);
    expect((vi.mocked(markAsRead).mock.calls[1][0] as string[]).length).toBe(50);
    expect(markAllAsRead).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus récentes, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      ['neuf', true], ['pivot', false], ['vieux', false],
    ]);
  });

  it('n’appelle rien quand il n’y a rien de plus récent', async () => {
    vi.mocked(itemIdsNewerThan).mockResolvedValue([]);

    await useFeedStore.getState().markReadRelative(neuf, 'above');

    expect(markAsRead).not.toHaveBeenCalled();
  });
});

describe('markReadRelative — la vue et les pannes', () => {
  it('suit la vue courante : sans flux sélectionné, c’est toute la liste de lecture', async () => {
    useFeedStore.setState({ selectedFeed: null } as never);

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(markAllAsRead).toHaveBeenCalledWith('user/-/state/com.google/reading-list', '1999999');
  });

  it('rend les lignes à leur état quand le serveur refuse', async () => {
    vi.mocked(markAllAsRead).mockRejectedValueOnce(new Error('refus'));

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([false, false, false]);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Run: `npx vitest run src/stores/feedStore.markRange.test.ts`
Expected: ÉCHEC — `markReadRelative is not a function`.

- [ ] **Étape 3 : écrire l'action**

Imports à ajouter en tête de `src/stores/feedStore.ts` :

```ts
import { itemIdsNewerThan } from '../api/feeds';
import { exclusiveNewerThanSec, exclusiveOlderThanUsec } from '../lib/relativeRead';
import { patchCorpusByDate } from '../lib/searchCorpus';
```

Helper de module, à côté de `patchSearchCorpus` :

```ts
/** Répercute un marquage de plage sur le corpus gardé, s'il y en a un. */
function patchSearchCorpusByDate(
  bound: { direction: 'above' | 'below'; publishedMs: number },
  patch: Partial<Article>,
): void {
  if (searchCorpus) searchCorpus = patchCorpusByDate(searchCorpus, bound, patch);
}
```

Déclaration dans l'interface d'état, près de `markAllAsRead` :

```ts
  markReadRelative: (article: Article, direction: 'above' | 'below') => Promise<void>;
```

L'action, juste après `markAllAsRead` :

```ts
  /** Issue #15 : marquer lus tous les articles plus anciens (ou plus récents). */
  markReadRelative: async (article: Article, direction: 'above' | 'below') => {
    const { selectedFeed, articles } = get();
    const streamId = selectedFeed ? selectedFeed.id : 'user/-/state/com.google/reading-list';
    const bound = { direction, publishedMs: article.published };
    const touche = (a: Article) => (direction === 'below'
      ? a.published < article.published
      : a.published > article.published);
    // L'état d'avant, gardé tel quel : en cas de refus du serveur, la liste
    // revient exactement où elle était. Un article coché qui reste coché après
    // un échec est le mensonge que 1.4.7 avait déjà coûté.
    const avant = articles;

    set((s) => ({ articles: s.articles.map((a) => (touche(a) ? { ...a, read: true } : a)) }));
    bumpCountsEpoch(); // écriture locale — voir la garde en tête de fichier
    // Le critère est une date, donc le corpus de recherche reste JUSTE : pas
    // besoin de le jeter comme le fait « tout marquer comme lu », ce qui
    // refermerait la recherche en cours de l'utilisateur.
    patchSearchCorpusByDate(bound, { read: true });

    try {
      if (direction === 'below') {
        await markAllAsRead(streamId, exclusiveOlderThanUsec(article.published));
      } else {
        const ids = await itemIdsNewerThan(streamId, exclusiveNewerThanSec(article.published));
        // Par lots : `editTag` accepte un tableau, mais un millier de `i=` dans
        // une URL ne passerait pas.
        for (let i = 0; i < ids.length; i += 100) {
          await markAsRead(ids.slice(i, i + 100));
        }
      }
      // Combien d'articles le serveur a-t-il touché au-delà de ce qui est
      // chargé ? Nous n'en savons rien, et nous ne le devinons pas : le relevé
      // suivant rapporte le vrai compte. Une baisse n'est pas une arrivée, la
      // pastille n'y verra donc rien.
      await get().syncCounts();
    } catch {
      set({ articles: avant });
      bumpCountsEpoch();
      patchSearchCorpusByDate(bound, { read: false });
      void pushI18nToast('toast.markRangeFailed', { tone: 'error' });
    }
  },
```

- [ ] **Étape 4 : ajouter la clé de toast dans les dix locales**

```json
"markRangeFailed": "Le serveur a refusé de marquer ces articles"
```
```json
"markRangeFailed": "The server refused to mark those articles"
```
(et les huit autres, dans la famille `toast`).

- [ ] **Étape 5 : voir les tests passer**

Run: `npx vitest run src/stores/feedStore.markRange.test.ts`
Expected: SUCCÈS, 7 tests.

- [ ] **Étape 6 : prouver que le retour en arrière mord**

Retirer `set({ articles: avant });` du `catch`, relancer : le test « rend les
lignes à leur état quand le serveur refuse » doit ROUGIR. Le remettre, il
reverdit. Rapporter les deux sorties.

- [ ] **Étape 7 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/stores/feedStore.ts src/stores/feedStore.markRange.test.ts src/locales
git commit -m "feat(read): mark everything above or below an article as read"
```

---

### Task 6 : le câblage du menu

**Files:**
- Modify: `src/components/ArticleList/ArticleContextMenu.tsx`
- Modify: `src/components/ArticleList/ArticleContextMenu.test.tsx`
- Modify: `src/components/ArticleList/ArticleList.tsx`

**Interfaces:**
- Consomme : `markReadRelative` (Task 5), les kinds `markBelowRead` /
  `markAboveRead` (Task 1).
- Produit : deux props de plus sur `ArticleContextMenu` —
  `onMarkBelowRead: () => void` et `onMarkAboveRead: () => void`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Dans `src/components/ArticleList/ArticleContextMenu.test.tsx`, ajouter les deux
props aux objets de props de base (`onMarkBelowRead: vi.fn(), onMarkAboveRead:
vi.fn()`), corriger la liste attendue des libellés pour inclure
`articleRow.markBelowRead` et `articleRow.markAboveRead` après
`articleRow.markRead`, et ajouter :

```tsx
  it('appelle la bonne direction depuis chaque entrée de plage', () => {
    const onMarkBelowRead = vi.fn();
    const onMarkAboveRead = vi.fn();
    render(<ArticleContextMenu {...props({ onMarkBelowRead, onMarkAboveRead })} />);

    fireEvent.click(screen.getByText('articleRow.markBelowRead'));
    expect(onMarkBelowRead).toHaveBeenCalledTimes(1);
    expect(onMarkAboveRead).not.toHaveBeenCalled();
  });
```

(`props(...)` est la fabrique déjà utilisée par le fichier ; si elle n'accepte
pas d'écrasement, étendre l'objet littéral comme les cas voisins le font.)

- [ ] **Étape 2 : voir les tests échouer**

Run: `npx vitest run src/components/ArticleList/ArticleContextMenu.test.tsx`
Expected: ÉCHEC — les deux entrées ne sont pas rendues.

- [ ] **Étape 3 : écrire le code**

Dans `ArticleContextMenu.tsx`, deux props de plus dans l'interface :

```tsx
  onMarkBelowRead: () => void;
  onMarkAboveRead: () => void;
```

à déstructurer avec les autres, et deux entrées dans le dictionnaire d'actions :

```tsx
    markBelowRead: onMarkBelowRead,
    markAboveRead: onMarkAboveRead,
```

Dans `ArticleList.tsx`, sur le `<ArticleContextMenu … />` (vers la ligne 632) :

```tsx
          onMarkBelowRead={() => { void markReadRelative(menuArticle, 'below'); }}
          onMarkAboveRead={() => { void markReadRelative(menuArticle, 'above'); }}
```

et `markReadRelative` s'ajoute à la déstructuration de `useFeedStore()` en tête
du composant, à côté de `markAllAsRead`.

- [ ] **Étape 4 : voir les tests passer**

Run: `npx vitest run src/components/ArticleList/`
Expected: SUCCÈS, aucun test de ce dossier en échec.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/ArticleList/ArticleContextMenu.tsx src/components/ArticleList/ArticleContextMenu.test.tsx src/components/ArticleList/ArticleList.tsx
git commit -m "feat(menu): wire the two range actions to the store"
```

---

### Task 7 : documentation

**Files:**
- Modify: `docs/FEATURES.md` (section du menu contextuel d'article)
- Modify: `docs/RELEASE-NEXT.md`

- [ ] **Étape 1 : compléter `docs/FEATURES.md`**

Dans la section qui décrit le menu contextuel (chercher
`2026-09-13-article-context-menu-design.md`), ajouter les deux entrées à la
liste et écrire ce qui ne se devine pas :

- la portée est **la vue courante** (flux, catégorie ou tous les flux), comme
  « Tout lu » ;
- « en dessous » veut dire **plus ancien**, et atteint aussi ce qui n'est pas
  chargé ;
- **aucune annulation** : pour « en dessous », le serveur reçoit un horodatage,
  pas une liste, donc rien ne permet de revenir en arrière ni de compter ce qui
  a changé ;
- les trois unités de temps (`published` en ms, `ts` en µs, `ot` en s) et le
  décalage d'une unité qui exclut l'article cliqué —
  **piège** : les articles publiés dans la même seconde que lui ne sont pas
  marqués par « au-dessus » ;
- le corpus de recherche est **corrigé** par la date, pas jeté (contrairement à
  « tout marquer comme lu »).

- [ ] **Étape 2 : ajouter l'entrée de `docs/RELEASE-NEXT.md`**

Sous « Fonctionnalités » :

```markdown
- **Marquer lu tout ce qui précède (ou suit) un article.** Le menu d'un article
  propose « Tout lu en dessous » et « Tout lu au-dessus » : tous les articles
  plus anciens — ou plus récents — de la vue courante passent lus, y compris
  ceux que la liste n'a pas encore chargés. Sans confirmation et sans
  annulation, comme « Tout lu ». Demandé dans l'issue #15.
```

- [ ] **Étape 3 : vérifier le garde-fou d'inventaire**

Run: `npx vitest run src/lib/featuresDoc.test.ts`
Expected: SUCCÈS.

- [ ] **Étape 4 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add docs/FEATURES.md docs/RELEASE-NEXT.md
git commit -m "docs: mark above and below, and what cannot be undone"
```

---

### Task 8 : vérification réelle (aucun code)

**Files:** aucun.

- [ ] **Étape 1 : attendre le redéploiement de l'instance de dev par le propriétaire.**

- [ ] **Étape 2 : parcours dans le navigateur**

1. Dans un flux, clic droit sur un article du milieu → « Tout lu en dessous » :
   les lignes plus anciennes passent lues, l'article cliqué **reste** dans son
   état, et le compteur du flux baisse du bon nombre (le comparer à un décompte
   fait soi-même par l'API avant le geste).
2. Même flux, « Tout lu au-dessus » sur un article ancien : les plus récents
   passent lus, **l'article cliqué reste inchangé**.
3. Depuis « Tous les flux » : la portée est bien toute la liste de lecture, pas
   le flux de l'article cliqué.
4. Depuis une catégorie : la portée est la catégorie.
5. Pendant une recherche : les entrées agissent sur le flux de la vue, la
   recherche **ne se referme pas**, et relancer la même requête ne ressort pas
   d'anciens états.
6. Sur téléphone (feuille du bas) : les deux entrées sont présentes et
   atteignables au pouce.
7. Vérifier qu'un article publié la même seconde que celui cliqué n'est pas
   marqué par « au-dessus » — le piège documenté.

- [ ] **Étape 3 : rendre compte au propriétaire** : parcours, décomptes comparés,
  et ce qui reste ouvert.

---

## Auto-revue du plan

- **Couverture de la spec** : entrées de menu et libellés (T1) ; bornes
  temporelles et exclusion (T2) ; identifiants plus récents (T3) ; corpus (T4) ;
  portée de vue, mise à jour optimiste, compteurs resynchronisés, échec rendu
  visible (T5) ; câblage et feuille mobile (T6) ; documentation (T7) ;
  vérification réelle (T8).
- **Écart assumé avec la spec** : la spec disait « corpus vidé » ; le plan le
  **corrige par la date** (T4). C'est strictement mieux — le critère est connu,
  et vider le corpus obligerait à refermer la recherche en cours, comme
  `markAllAsRead` doit le faire. À signaler au propriétaire.
- **Écart assumé avec la spec** : pas de flèche dans les libellés. Ce menu n'a
  pas d'icônes, et « ↓ » se lit « flèche vers le bas » au lecteur d'écran pour
  une information que les mots portent déjà.
- **Cohérence des noms** : `markBelowRead` / `markAboveRead` (kinds et clés
  i18n), `exclusiveOlderThanUsec` / `exclusiveNewerThanSec`, `itemIdsNewerThan`,
  `patchCorpusByDate`, `patchSearchCorpusByDate`, `markReadRelative`,
  `onMarkBelowRead` / `onMarkAboveRead`, `toast.markRangeFailed` — identiques de
  la tâche 1 à la tâche 7.
