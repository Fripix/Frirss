# Recherche côté client — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Les étapes sont
> des cases à cocher (`- [ ]`).

**But :** filtrer les articles dans FriRSS, côté client, dans le périmètre de la
vue courante et sans limite fixe, puisque l'API greader de FreshRSS n'a jamais eu
de paramètre de recherche.

**Architecture :** trois modules purs et testés (correspondance, corpus,
classification d'erreur), une fonction d'API qui rend une page de flux, une
boucle de balayage dans `feedStore` qui suit la continuation et filtre au
passage, et une barre d'état dans `ArticleList`. Le corpus balayé est gardé cinq
minutes par périmètre : affiner une requête ne repaye pas le réseau.

**Spec :** `docs/superpowers/specs/2026-09-23-client-side-search-design.md`

**Stack :** TypeScript strict, React 18, Zustand, vitest, i18next v26.

## Contraintes globales

- **Gates avant CHAQUE commit** : `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **Garde-fou fuite d'infra avant CHAQUE commit** (sortie vide attendue) :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- **Messages de commit** : neutres, conventionnels, en anglais. **Jamais** de
  trailer `Co-Authored-By`, jamais de mention d'IA ni de la conversation.
- **Pas de push.** Le contrôleur pousse ; un agent d'exécution ne pousse jamais.
- **TDD** : le test d'abord, vu ROUGE, puis le code minimal, puis VERT.
- **i18n** : toute chaîne d'interface existe dans **les dix** locales
  (`fr, en, de, es, it, nl, pl, pt, uk, zh`), pluriels `_one`/`_other`, plus
  `_few`/`_many` pour `pl` et `uk`.
- **Branche** : `dev`.
- Le code de production est en français pour les commentaires, comme le reste du
  dépôt.

---

### Task 1 : règles de correspondance (module pur)

**Files:**
- Create: `src/lib/searchMatch.ts`
- Test: `src/lib/searchMatch.test.ts`

**Interfaces:**
- Consomme : `Article` depuis `src/types`.
- Produit : `normalizeForSearch(text: string): string`,
  `stripHtml(html: string): string`, `parseQuery(query: string): string[]`,
  `articleHaystack(article: Article): string`,
  `matchesTerms(haystack: string, terms: readonly string[]): boolean`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/lib/searchMatch.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeForSearch,
  stripHtml,
  parseQuery,
  articleHaystack,
  matchesTerms,
} from './searchMatch';
import type { Article } from '../types';

const article = (over: Partial<Article> = {}): Article => ({
  id: 'a1',
  title: 'Titre',
  summary: '',
  content: '',
  author: '',
  url: 'https://example.com/a1',
  source: 'Flux',
  sourceId: 'feed/1',
  published: 0,
  read: false,
  starred: false,
  labels: [],
  tags: [],
  ...over,
});

describe('normalizeForSearch', () => {
  it('replie la casse et les accents', () => {
    expect(normalizeForSearch('Élection')).toBe('election');
    expect(normalizeForSearch('ÉTÉ')).toBe('ete');
  });
});

describe('stripHtml', () => {
  it('retire les balises sans coller les mots', () => {
    expect(stripHtml('<p>Bonjour <b>le</b> monde</p>')).toBe('Bonjour le monde');
  });

  it('décode les entités', () => {
    expect(stripHtml('l&#39;été &amp; la pluie')).toBe("l'été & la pluie");
  });
});

describe('parseQuery', () => {
  it('rend les mots normalisés, sans doublon ni vide', () => {
    expect(parseQuery('  Moteur   RECHERCHE moteur ')).toEqual(['moteur', 'recherche']);
  });

  it('rend un tableau vide pour une requête blanche', () => {
    expect(parseQuery('   ')).toEqual([]);
  });
});

describe('matchesTerms', () => {
  it('trouve les mots dans le désordre', () => {
    const hay = articleHaystack(article({ title: 'Le moteur de recherche' }));
    expect(matchesTerms(hay, parseQuery('recherche moteur'))).toBe(true);
  });

  it('exige TOUS les mots', () => {
    const hay = articleHaystack(article({ title: 'Le moteur de recherche' }));
    expect(matchesTerms(hay, parseQuery('moteur diesel'))).toBe(false);
  });

  it('cherche aussi dans le texte, accents pliés dans les deux sens', () => {
    const hay = articleHaystack(article({ title: 'Brève', content: '<p>Une élection serrée</p>' }));
    expect(matchesTerms(hay, parseQuery('election'))).toBe(true);
    expect(matchesTerms(hay, parseQuery('élection'))).toBe(true);
  });

  it('ne matche pas le balisage', () => {
    const hay = articleHaystack(article({ content: '<a href="https://example.com/x">lien</a>' }));
    expect(matchesTerms(hay, parseQuery('href'))).toBe(false);
    expect(matchesTerms(hay, parseQuery('lien'))).toBe(true);
  });

  it('retombe sur le résumé quand le contenu est vide', () => {
    const hay = articleHaystack(article({ content: '', summary: '<p>Résumé parlant</p>' }));
    expect(matchesTerms(hay, parseQuery('parlant'))).toBe(true);
  });

  it('ne matche rien sans terme', () => {
    expect(matchesTerms(articleHaystack(article()), [])).toBe(false);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Commande : `npx vitest run src/lib/searchMatch.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./searchMatch"`.

- [ ] **Étape 3 : écrire le module**

```ts
// src/lib/searchMatch.ts
import type { Article } from '../types';

/**
 * Règles de correspondance de la recherche côté client.
 *
 * L'API greader de FreshRSS n'a pas de paramètre de recherche (vérifié de la
 * 1.20.2 à la 1.27.0 : `streamContents` ne lit que `xt`, `it`, `n`, `r`, `ot`,
 * `nt`, `c`, `s`, `output`). Le filtrage vit donc ici.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 */

/** Minuscules et diacritiques dépliés : « Élection » et « election » se rejoignent. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/**
 * Texte lisible d'un fragment HTML.
 *
 * Les balises deviennent des espaces plutôt que rien : sans ça
 * `<b>moteur</b><i>recherche</i>` donnerait « moteurrecherche » et un mot
 * cherché à cheval sur deux balises matcherait par accident. Les entités sont
 * décodées, sinon « été » ne trouverait pas `l&#39;été`.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (whole: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Les mots de la requête, normalisés, sans doublon ni vide. */
export function parseQuery(query: string): string[] {
  return [...new Set(normalizeForSearch(query).split(/\s+/).filter(Boolean))];
}

/**
 * Le texte cherchable d'un article, calculé UNE SEULE FOIS au balayage — jamais
 * à chaque frappe : refiltrer 10 000 articles doit rester instantané.
 */
export function articleHaystack(article: Article): string {
  const body = article.content || article.summary || '';
  return normalizeForSearch(`${stripHtml(article.title)} ${stripHtml(body)}`);
}

/** Tous les mots présents. Sans terme, rien ne correspond. */
export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  return terms.every((term) => haystack.includes(term));
}
```

- [ ] **Étape 4 : voir les tests passer**

Commande : `npx vitest run src/lib/searchMatch.test.ts`
Attendu : SUCCÈS, 8 tests.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/lib/searchMatch.ts src/lib/searchMatch.test.ts
git commit -m "feat(search): matching rules for client-side search"
```

---

### Task 2 : le corpus balayé (module pur)

**Files:**
- Create: `src/lib/searchCorpus.ts`
- Test: `src/lib/searchCorpus.test.ts`

**Interfaces:**
- Consomme : `matchesTerms` (Task 1), `Article`.
- Produit : `CORPUS_TTL_MS`, `CorpusEntry`, `Corpus`,
  `createCorpus(streamId, serverId, now): Corpus`,
  `addPage(corpus, entries, continuation, now): Corpus`,
  `corpusIsUsable(corpus, streamId, serverId, now): boolean`,
  `corpusMatches(corpus, terms): Article[]`,
  `patchCorpusArticle(corpus, id, patch): Corpus`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/lib/searchCorpus.test.ts
import { describe, it, expect } from 'vitest';
import {
  CORPUS_TTL_MS,
  createCorpus,
  addPage,
  corpusIsUsable,
  corpusMatches,
  patchCorpusArticle,
  type CorpusEntry,
} from './searchCorpus';
import type { Article } from '../types';

const art = (id: string, title: string, over: Partial<Article> = {}): Article => ({
  id, title, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: 0, read: false, starred: false,
  labels: [], tags: [], ...over,
});

const entry = (id: string, title: string, over: Partial<Article> = {}): CorpusEntry => ({
  article: art(id, title, over),
  haystack: title.toLowerCase(),
});

describe('corpus', () => {
  it('accumule les pages et retient la continuation', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], 'CONT1', 1_100);
    expect(c.entries).toHaveLength(1);
    expect(c.continuation).toBe('CONT1');
    expect(c.complete).toBe(false);
  });

  it('se déclare complet quand la continuation tombe', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], null, 1_100);
    expect(c.complete).toBe(true);
  });

  it('déduplique par identifiant — un flux qui bouge livre deux fois le même article', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], 'CONT1', 1_100);
    c = addPage(c, [entry('a', 'alpha'), entry('b', 'beta')], null, 1_200);
    expect(c.entries.map((e) => e.article.id)).toEqual(['a', 'b']);
  });
});

describe('corpusIsUsable', () => {
  const complete = () => addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha')], null, 1_000);

  it('accepte un corpus complet, frais, du bon périmètre et du bon serveur', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS - 1)).toBe(true);
  });

  it('refuse un corpus périmé', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS + 1)).toBe(false);
  });

  it('refuse un autre périmètre', () => {
    expect(corpusIsUsable(complete(), 'feed/2', '7', 1_000)).toBe(false);
  });

  it('refuse un autre serveur — ses articles décrivent un autre monde', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '8', 1_000)).toBe(false);
  });

  it('refuse un corpus incomplet : il ne prouve pas une absence', () => {
    const partial = addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha')], 'CONT1', 1_000);
    expect(corpusIsUsable(partial, 'feed/1', '7', 1_000)).toBe(false);
  });

  it('refuse un corpus absent', () => {
    expect(corpusIsUsable(null, 'feed/1', '7', 0)).toBe(false);
  });
});

describe('corpusMatches', () => {
  it('rend les articles correspondants dans l’ordre du corpus', () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha moteur'), entry('b', 'beta'), entry('c', 'gamma moteur')], null, 0);
    expect(corpusMatches(c, ['moteur']).map((a) => a.id)).toEqual(['a', 'c']);
  });
});

describe('patchCorpusArticle', () => {
  it('met à jour l’article gardé — sinon la recherche suivante ressortirait l’ancien état', () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha')], null, 0);
    c = patchCorpusArticle(c, 'a', { read: true });
    expect(c.entries[0].article.read).toBe(true);
  });

  it('ignore un identifiant inconnu', () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha')], null, 0);
    expect(patchCorpusArticle(c, 'zzz', { read: true }).entries[0].article.read).toBe(false);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Commande : `npx vitest run src/lib/searchCorpus.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "./searchCorpus"`.

- [ ] **Étape 3 : écrire le module**

```ts
// src/lib/searchCorpus.ts
import type { Article } from '../types';
import { matchesTerms } from './searchMatch';

/**
 * Le corpus d'un balayage : les articles d'un périmètre et leur texte
 * cherchable, gardés quelques minutes pour qu'affiner une requête ne repaye pas
 * le réseau.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 */

export interface CorpusEntry {
  article: Article;
  /** `articleHaystack(article)`, calculé au balayage. */
  haystack: string;
}

export interface Corpus {
  /** Périmètre balayé — sortie de `resolveSearchStreamId`. */
  streamId: string;
  /** Serveur FreshRSS actif pendant le balayage. */
  serverId: string;
  entries: CorpusEntry[];
  /** Où reprendre ; `null` quand le flux est épuisé. */
  continuation: string | null;
  /** Le flux est allé jusqu'au bout. */
  complete: boolean;
  /** Dernière écriture, pour la péremption. */
  at: number;
}

export const CORPUS_TTL_MS = 5 * 60 * 1000;

export function createCorpus(streamId: string, serverId: string, now: number): Corpus {
  return { streamId, serverId, entries: [], continuation: null, complete: false, at: now };
}

/** Ajoute une page, en écartant les articles déjà vus (un flux bouge pendant le balayage). */
export function addPage(
  corpus: Corpus,
  entries: readonly CorpusEntry[],
  continuation: string | null,
  now: number,
): Corpus {
  const seen = new Set(corpus.entries.map((e) => e.article.id));
  const fresh = entries.filter((e) => !seen.has(e.article.id));
  return {
    ...corpus,
    entries: [...corpus.entries, ...fresh],
    continuation,
    complete: continuation === null,
    at: now,
  };
}

/**
 * Peut-on répondre sans toucher au réseau ?
 *
 * Un corpus INCOMPLET ne sert jamais : il ne prouve aucune absence, et une
 * recherche qui annonce « aucun résultat » sur un corpus partiel ment.
 */
export function corpusIsUsable(
  corpus: Corpus | null,
  streamId: string,
  serverId: string,
  now: number,
): boolean {
  if (!corpus) return false;
  if (corpus.streamId !== streamId) return false;
  if (corpus.serverId !== serverId) return false;
  if (!corpus.complete) return false;
  return now - corpus.at <= CORPUS_TTL_MS;
}

/** Les articles correspondants, dans l'ordre du flux (date décroissante). */
export function corpusMatches(corpus: Corpus, terms: readonly string[]): Article[] {
  return corpus.entries.filter((e) => matchesTerms(e.haystack, terms)).map((e) => e.article);
}

/**
 * Répercute une écriture locale (lu, favori, à lire plus tard) sur l'article
 * gardé. Sans ça, la recherche suivante ressortirait l'ancien état depuis la
 * mémoire : un article coché qui redevient non lu.
 */
export function patchCorpusArticle(corpus: Corpus, id: string, patch: Partial<Article>): Corpus {
  let touched = false;
  const entries = corpus.entries.map((e) => {
    if (e.article.id !== id) return e;
    touched = true;
    return { ...e, article: { ...e.article, ...patch } };
  });
  return touched ? { ...corpus, entries } : corpus;
}
```

- [ ] **Étape 4 : voir les tests passer**

Commande : `npx vitest run src/lib/searchCorpus.test.ts`
Attendu : SUCCÈS, 12 tests.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/lib/searchCorpus.ts src/lib/searchCorpus.test.ts
git commit -m "feat(search): scanned corpus with scope, freshness and dedup"
```

---

### Task 3 : une page de flux, et la nature d'un échec

**Files:**
- Modify: `src/api/feeds.ts` (ajouter `fetchStreamPage` à côté de `searchItems`, qui part en Task 4)
- Create: `src/lib/scanError.ts`
- Test: `src/api/feeds.streamPage.test.ts`, `src/lib/scanError.test.ts`

**Interfaces:**
- Produit : `fetchStreamPage(streamId: string, count: number, continuation?: string | null): Promise<GReaderStream>`
  et `scanErrorKind(err: unknown): 'rate-limit' | 'network'`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/api/feeds.streamPage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { fetchStreamPage } from './feeds';

const get = vi.mocked(client.get);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { items: [{ id: 'a' }], continuation: 'CONT1' } } as never);
});

describe('fetchStreamPage', () => {
  it('demande la taille de page et le périmètre voulus', async () => {
    await fetchStreamPage('feed/21', 1000, null);
    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain('/stream/contents/');
    expect(config.params.n).toBe(1000);
    expect(config.params.output).toBe('json');
  });

  it("n'envoie PAS de q : l'API greader n'en a pas, c'est ce paramètre qui a fait croire à une recherche", async () => {
    await fetchStreamPage('feed/21', 1000, null);
    const [, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params).not.toHaveProperty('q');
  });

  it('transmet la continuation quand il y en a une, et rien sinon', async () => {
    await fetchStreamPage('feed/21', 1000, 'CONT1');
    const [, withCont] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(withCont.params.c).toBe('CONT1');

    get.mockClear();
    await fetchStreamPage('feed/21', 1000, null);
    const [, without] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(without.params).not.toHaveProperty('c');
  });

  it('rend une page vide plutôt que des trous quand la réponse est muette', async () => {
    get.mockResolvedValue({ data: {} } as never);
    await expect(fetchStreamPage('feed/21', 1000, null)).resolves.toEqual({ items: [], continuation: null });
  });
});
```

```ts
// src/lib/scanError.test.ts
import { describe, it, expect } from 'vitest';
import { scanErrorKind } from './scanError';

describe('scanErrorKind', () => {
  it('reconnaît le plafond de requêtes', () => {
    expect(scanErrorKind({ response: { status: 429 } })).toBe('rate-limit');
  });

  it('range tout le reste dans le réseau', () => {
    expect(scanErrorKind({ response: { status: 500 } })).toBe('network');
    expect(scanErrorKind(new Error('Network Error'))).toBe('network');
    expect(scanErrorKind(undefined)).toBe('network');
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Commande : `npx vitest run src/api/feeds.streamPage.test.ts src/lib/scanError.test.ts`
Attendu : ÉCHEC — `fetchStreamPage is not a function` et import `./scanError` introuvable.

- [ ] **Étape 3 : écrire le code**

```ts
// src/lib/scanError.ts
/**
 * De quoi est mort un balayage de recherche ?
 *
 * Le plafond du proxy (`FRIRSS_PROXY_RATE_LIMIT`, 600/min par utilisateur)
 * mérite son propre message : « réessayez dans une minute » est actionnable,
 * « erreur réseau » ne l'est pas. Tout le reste est du réseau — une erreur ne
 * doit jamais deviner sa cause.
 */
export type ScanErrorKind = 'rate-limit' | 'network';

export function scanErrorKind(err: unknown): ScanErrorKind {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 429 ? 'rate-limit' : 'network';
}
```

Dans `src/api/feeds.ts`, juste au-dessus de `searchItems` :

```ts
/**
 * Une page brute d'un flux greader, suivie par continuation.
 *
 * Pas de `q` : l'API greader de FreshRSS n'a pas de paramètre de recherche
 * (`streamContents` ne lit que `xt`, `it`, `n`, `r`, `ot`, `nt`, `c`, `s`,
 * `output`). Le filtrage se fait côté client, voir `src/lib/searchMatch.ts`.
 */
export async function fetchStreamPage(
  streamId: string,
  count: number,
  continuation: string | null = null,
): Promise<GReaderStream> {
  const params: Record<string, string | number> = { output: 'json', n: count };
  if (continuation) params.c = continuation;
  const { data } = await client.get<{ items?: GReaderItem[]; continuation?: string | null }>(
    `${BASE}/stream/contents/${buildStreamPath(streamId)}`,
    { params },
  );
  return { items: data.items || [], continuation: data.continuation || null };
}
```

- [ ] **Étape 4 : voir les tests passer**

Commande : `npx vitest run src/api/feeds.streamPage.test.ts src/lib/scanError.test.ts`
Attendu : SUCCÈS, 6 tests.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/api/feeds.ts src/api/feeds.streamPage.test.ts src/lib/scanError.ts src/lib/scanError.test.ts
git commit -m "feat(search): fetch a raw stream page, and name what a scan failure is"
```

---

### Task 4 : la boucle de balayage dans le store

**Files:**
- Modify: `src/stores/feedStore.ts`
- Modify: `src/api/feeds.ts` (suppression de `searchItems`)
- Test: `src/stores/feedStore.search.test.ts`

**Interfaces:**
- Consomme : `fetchStreamPage`, `scanErrorKind` (Task 3), `articleHaystack`,
  `parseQuery` (Task 1), tout `searchCorpus` (Task 2), `resolveSearchStreamId`
  et `normalizeArticle` (déjà dans `feedStore.ts`).
- Produit, sur l'état du store :
  `searchResults: Article[]`, `searchVisible: number`,
  `searchScan: { running: boolean; scanned: number; done: boolean; stopped: boolean; error: 'network' | 'rate-limit' | 'offline' | null }`,
  et les actions `search(query: string): Promise<void>`, `stopSearch(): void`,
  `retrySearch(): Promise<void>`, `showMoreSearchResults(): void`,
  plus `__resetSearchStateForTests(): void`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/stores/feedStore.search.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return { ...actual, fetchStreamPage: vi.fn() };
});

import { fetchStreamPage } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';
import { useAuthStore } from './authStore';

const page = vi.mocked(fetchStreamPage);

const item = (id: string, title: string) => ({
  id,
  title,
  origin: { streamId: 'feed/1', title: 'Flux' },
  published: 0,
  categories: [],
  summary: { content: '' },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  useAuthStore.setState({ activeServerId: 7 } as never);
  useFeedStore.setState({
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'unread',
    articles: [],
    searchQuery: '',
    searchResults: [],
  } as never);
});

describe('search — balayage', () => {
  it('suit la continuation jusqu’au bout et ne garde que les correspondances', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur'), item('b', 'beta')], continuation: 'C1' })
      .mockResolvedValueOnce({ items: [item('c', 'gamma moteur')], continuation: null });

    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(2);
    expect(page.mock.calls[1][2]).toBe('C1');
    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a', 'c']);
    expect(s.articles.map((a) => a.id)).toEqual(['a', 'c']);
    expect(s.searchScan).toMatchObject({ running: false, done: true, scanned: 3, error: null });
  });

  it('réutilise le corpus : une seconde requête dans le même périmètre ne touche pas au réseau', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur'), item('b', 'beta diesel')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockClear();

    await useFeedStore.getState().search('diesel');

    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().searchResults.map((a) => a.id)).toEqual(['b']);
  });

  it('rebalaye quand le périmètre change', async () => {
    page.mockResolvedValue({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockClear();

    useFeedStore.setState({ selectedFeed: { id: 'feed/2', title: 'Autre' } } as never);
    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(1);
  });

  it('garde ce qui est trouvé et nomme la panne quand une page échoue', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: 'C1' })
      .mockRejectedValueOnce({ response: { status: 429 } });

    await useFeedStore.getState().search('moteur');

    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a']);
    expect(s.searchScan).toMatchObject({ running: false, done: false, error: 'rate-limit' });
  });

  it('reprend à la continuation en cours, sans refaire la première page', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: 'C1' })
      .mockRejectedValueOnce(new Error('offline'));
    await useFeedStore.getState().search('moteur');
    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('c', 'gamma moteur')], continuation: null });

    await useFeedStore.getState().retrySearch();

    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0][2]).toBe('C1');
    expect(useFeedStore.getState().searchResults.map((a) => a.id)).toEqual(['a', 'c']);
  });

  it('arrête le balayage sans perdre les résultats', async () => {
    page.mockImplementationOnce(async () => {
      useFeedStore.getState().stopSearch();
      return { items: [item('a', 'alpha moteur')], continuation: 'C1' };
    });

    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().searchScan).toMatchObject({ running: false, stopped: true, done: false });
  });

  it('déduplique un article livré deux fois', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: 'C1' })
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().search('moteur');

    expect(useFeedStore.getState().searchResults.map((a) => a.id)).toEqual(['a']);
  });

  it('pagine localement, par tranches, sans réseau', async () => {
    const many = Array.from({ length: 120 }, (_, i) => item(`a${i}`, 'alpha moteur'));
    page.mockResolvedValueOnce({ items: many, continuation: null });
    await useFeedStore.getState().search('moteur');
    expect(useFeedStore.getState().articles).toHaveLength(50);
    page.mockClear();

    useFeedStore.getState().showMoreSearchResults();

    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().articles).toHaveLength(100);
  });

  it('une requête blanche referme la recherche', async () => {
    const loadArticles = vi.fn().mockResolvedValue(undefined);
    useFeedStore.setState({ searchQuery: 'moteur', loadArticles } as never);

    await useFeedStore.getState().search('   ');

    expect(useFeedStore.getState().searchQuery).toBe('');
    expect(loadArticles).toHaveBeenCalled();
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Commande : `npx vitest run src/stores/feedStore.search.test.ts`
Attendu : ÉCHEC — `__resetSearchStateForTests` n'existe pas, `fetchStreamPage` jamais appelé.

- [ ] **Étape 3 : écrire le code du store**

Ajouts en tête de `src/stores/feedStore.ts` (à côté des autres états de module) :

```ts
import { fetchStreamPage } from '../api/feeds';
import { articleHaystack, parseQuery } from '../lib/searchMatch';
import { scanErrorKind } from '../lib/scanError';
import {
  createCorpus, addPage, corpusIsUsable, corpusMatches, patchCorpusArticle,
  type Corpus,
} from '../lib/searchCorpus';

/** Taille d'une tranche de balayage. Mesuré : 1 000 articles en ~830 ms, ~2 Mo. */
const SCAN_PAGE = 1000;
/** Résultats rendus d'un coup ; la suite arrive au défilement, sans réseau. */
const SEARCH_PAGE = 50;

/** Le seul corpus gardé — celui du dernier périmètre balayé. */
let searchCorpus: Corpus | null = null;
/**
 * Jeton du balayage courant. Toute nouvelle recherche, tout arrêt, tout
 * changement de serveur l'incrémente : la boucle en vol se voit périmée et rend
 * la main sans rien écrire. Même garde que `countsEpoch` pour les compteurs.
 */
let scanToken = 0;
/** Les mots du balayage en cours, pour que `retrySearch` reprenne les mêmes. */
let scanTerms: string[] = [];

export function __resetSearchStateForTests(): void {
  searchCorpus = null;
  scanToken = 0;
  scanTerms = [];
}

/** Le corpus n'appartient qu'au serveur qui l'a produit. */
export function dropSearchCorpus(): void {
  searchCorpus = null;
  scanToken++;
}

/** Répercute une écriture locale sur le corpus gardé. */
function patchSearchCorpus(id: string, patch: Partial<Article>): void {
  if (searchCorpus) searchCorpus = patchCorpusArticle(searchCorpus, id, patch);
}
```

La boucle, en bas du fichier, à côté de `normalizeArticle` :

```ts
/**
 * Balaye le périmètre page par page et filtre au passage.
 *
 * Séquentiel par nature : chaque page porte la continuation de la suivante. Les
 * résultats sont poussés à chaque tranche — une recherche qui n'a rien trouvé et
 * une recherche qui n'a pas fini se ressemblent trop pour attendre la fin.
 */
async function runScan(token: number, streamId: string): Promise<void> {
  try {
    for (;;) {
      if (token !== scanToken || !searchCorpus) return;
      const result = await fetchStreamPage(streamId, SCAN_PAGE, searchCorpus.continuation);
      if (token !== scanToken || !searchCorpus) return;
      const entries = result.items.map((item) => {
        const article = normalizeArticle(item);
        return { article, haystack: articleHaystack(article) };
      });
      searchCorpus = addPage(searchCorpus, entries, result.continuation, Date.now());
      const hits = corpusMatches(searchCorpus, scanTerms);
      const complete = searchCorpus.complete;
      const scanned = searchCorpus.entries.length;
      useFeedStore.setState((s) => ({
        searchResults: hits,
        articles: hits.slice(0, s.searchVisible),
        searchScan: { running: !complete, scanned, done: complete, stopped: false, error: null },
      }));
      if (complete) return;
    }
  } catch (err) {
    if (token !== scanToken) return;
    useFeedStore.setState({
      searchScan: {
        running: false,
        scanned: searchCorpus?.entries.length ?? 0,
        done: false,
        stopped: false,
        error: scanErrorKind(err),
      },
    });
  }
}
```

Les actions, en remplacement de l'actuel `search` :

```ts
  search: async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      scanToken++;
      set({ searchQuery: '', searchResults: [], searchVisible: SEARCH_PAGE, searchScan: IDLE_SCAN });
      return get().loadArticles();
    }
    const { selectedFeed, filter } = get();
    const streamId = resolveSearchStreamId(selectedFeed, filter);
    const serverId = String(useAuthStore.getState().activeServerId ?? '');
    scanTerms = parseQuery(trimmed);
    const token = ++scanToken;

    // Une recherche repart d'une liste neuve : la pastille de la vue qu'elle
    // recouvre ne doit pas flotter au-dessus des résultats.
    set({ searchQuery: trimmed, newInView: 0, searchVisible: SEARCH_PAGE, loading: false });

    if (corpusIsUsable(searchCorpus, streamId, serverId, Date.now())) {
      const hits = corpusMatches(searchCorpus as Corpus, scanTerms);
      set({
        searchResults: hits,
        articles: hits.slice(0, SEARCH_PAGE),
        searchScan: { running: false, scanned: (searchCorpus as Corpus).entries.length, done: true, stopped: false, error: null },
      });
      return;
    }

    searchCorpus = createCorpus(streamId, serverId, Date.now());
    set({
      searchResults: [],
      articles: [],
      searchScan: { running: true, scanned: 0, done: false, stopped: false, error: null },
    });
    await runScan(token, streamId);
  },

  stopSearch: () => {
    scanToken++;
    set((s) => ({ searchScan: { ...s.searchScan, running: false, stopped: true } }));
  },

  retrySearch: async () => {
    const { selectedFeed, filter } = get();
    const streamId = resolveSearchStreamId(selectedFeed, filter);
    if (!searchCorpus) return get().search(get().searchQuery);
    const token = ++scanToken;
    set((s) => ({ searchScan: { ...s.searchScan, running: true, stopped: false, error: null } }));
    await runScan(token, streamId);
  },

  showMoreSearchResults: () => set((s) => {
    const visible = Math.min(s.searchVisible + SEARCH_PAGE, s.searchResults.length);
    return { searchVisible: visible, articles: s.searchResults.slice(0, visible) };
  }),
```

avec, près des valeurs initiales du store :

```ts
const IDLE_SCAN = { running: false, scanned: 0, done: false, stopped: false, error: null } as const;
// …
  searchResults: [],
  searchVisible: SEARCH_PAGE,
  searchScan: { ...IDLE_SCAN },
```

Dans `loadMore`, la branche recherche ne va plus au réseau :

```ts
    // Une recherche est déjà entièrement en mémoire : paginer, c'est montrer
    // la tranche suivante. Plus aucun appel réseau — c'est ce chemin qui
    // appendait autrefois le flux nu sous une boîte de recherche remplie.
    if (get().searchQuery) { get().showMoreSearchResults(); return; }
```

Enfin, `searchItems` est **supprimée** de `src/api/feeds.ts` (plus aucun appelant)
et son import retiré de `feedStore.ts`.

- [ ] **Étape 4 : voir les tests passer**

Commande : `npx vitest run src/stores/feedStore.search.test.ts`
Attendu : SUCCÈS, 9 tests.

- [ ] **Étape 5 : prouver que le garde d'annulation mord**

Retirer temporairement `if (token !== scanToken || !searchCorpus) return;` après
l'`await` dans `runScan`, lancer le test « arrête le balayage sans perdre les
résultats » : il doit ROUGIR. Remettre la garde, il doit reverdir.

Commande : `npx vitest run src/stores/feedStore.search.test.ts -t "arrête le balayage"`

- [ ] **Étape 6 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/stores/feedStore.ts src/stores/feedStore.search.test.ts src/api/feeds.ts
git commit -m "feat(search): scan the current scope and filter client-side"
```

---

### Task 5 : la barre d'état, l'état vide honnête et les dix locales

**Files:**
- Create: `src/components/ArticleList/SearchScanBar.tsx`
- Test: `src/components/ArticleList/SearchScanBar.test.tsx`
- Modify: `src/lib/listPagination.ts` (+ `src/lib/listPagination.test.ts`)
- Modify: `src/components/ArticleList/ArticleList.tsx`
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json`

**Interfaces:**
- Consomme : `searchScan`, `stopSearch`, `retrySearch` (Task 4).
- Produit : `<SearchScanBar scan={…} onStop={…} onRetry={…} />` et
  `listBodyState({ …, scanning })`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
// src/components/ArticleList/SearchScanBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchScanBar from './SearchScanBar';

const scan = (over = {}) => ({ running: false, scanned: 0, done: false, stopped: false, error: null, ...over });

describe('SearchScanBar', () => {
  it('compte ce qui est parcouru et ce qui est trouvé pendant le balayage', () => {
    render(<SearchScanBar scan={scan({ running: true, scanned: 3000 })} results={7} onStop={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/3000/)).toBeInTheDocument();
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it('disparaît quand le balayage est allé au bout', () => {
    const { container } = render(<SearchScanBar scan={scan({ done: true, scanned: 10 })} results={2} onStop={vi.fn()} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offre Arrêter pendant, et Réessayer après une panne', async () => {
    const onStop = vi.fn();
    const { rerender } = render(<SearchScanBar scan={scan({ running: true, scanned: 10 })} results={0} onStop={onStop} onRetry={vi.fn()} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onStop).toHaveBeenCalled();

    const onRetry = vi.fn();
    rerender(<SearchScanBar scan={scan({ error: 'network', scanned: 10 })} results={0} onStop={vi.fn()} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

```ts
// à ajouter dans src/lib/listPagination.test.ts
  it('ne déclare pas une liste vide tant qu’un balayage de recherche tourne', () => {
    expect(listBodyState({ loading: false, articleCount: 0, hasContinuation: false, searching: true, scanning: true }))
      .toBe('skeleton');
    expect(listBodyState({ loading: false, articleCount: 0, hasContinuation: false, searching: true, scanning: false }))
      .toBe('empty');
  });
```

- [ ] **Étape 2 : voir les tests échouer**

Commande : `npx vitest run src/components/ArticleList/SearchScanBar.test.tsx src/lib/listPagination.test.ts`
Attendu : ÉCHEC — import `./SearchScanBar` introuvable, et `scanning` inconnu de `listBodyState`.

- [ ] **Étape 3 : écrire le composant, la règle et les traductions**

```tsx
// src/components/ArticleList/SearchScanBar.tsx
import { useTranslation } from 'react-i18next';
import type { SearchScan } from '../../stores/feedStore';

interface Props {
  scan: SearchScan;
  results: number;
  onStop: () => void;
  onRetry: () => void;
}

/**
 * L'état d'un balayage de recherche.
 *
 * Elle existe parce qu'« aucun résultat » et « pas encore fini » se ressemblent
 * à l'écran : sans ce compteur, un balayage en cours passerait pour une réponse.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 */
export default function SearchScanBar({ scan, results, onStop, onRetry }: Props) {
  const { t } = useTranslation();
  if (scan.done && !scan.error) return null;
  if (!scan.running && !scan.stopped && !scan.error) return null;

  const status = scan.error === 'offline'
    ? t('articleList.scanOffline')
    : scan.error === 'rate-limit'
      ? t('articleList.scanRateLimited')
      : scan.error === 'network'
        ? t('articleList.scanNetworkError')
        : scan.stopped
          ? t('articleList.scanStopped')
          : `${t('articleList.scanScanned', { count: scan.scanned })} · ${t('articleList.scanResults', { count: results })}`;

  return (
    <div className="search-scan-bar" role="status" aria-live="polite">
      <span>{status}</span>
      {scan.running ? (
        <button type="button" onClick={onStop}>{t('articleList.scanStop')}</button>
      ) : (scan.error || scan.stopped) ? (
        <button type="button" onClick={onRetry}>{t('articleList.scanRetry')}</button>
      ) : null}
    </div>
  );
}
```

Dans `src/lib/listPagination.ts`, `listBodyState` reçoit `scanning?: boolean` et,
quand la liste est vide et qu'un balayage tourne, rend `'skeleton'` :

```ts
  // Un balayage de recherche en cours n'a encore rien prouvé : afficher
  // « aucun résultat » pendant qu'il tourne serait le même mensonge que le
  // « tout est lu » d'une liste qui attendait sa page suivante.
  if (opts.searching && opts.scanning && opts.articleCount === 0) return 'skeleton';
```

Dans `ArticleList.tsx` : monter `<SearchScanBar>` juste sous l'en-tête de liste,
passer `scanning: searchScan.running` à `listBodyState`, et brancher `loadMore`
sur `showMoreSearchResults` via le store (déjà fait en Task 4).

Styles, dans `src/styles/index.css`, à côté de `.new-articles-slot` : barre
pleine largeur, `font-size: 12px`, couleurs `var(--list-summary)` /
`var(--panel-border)`, bouton à 44 px de hauteur tactile sous
`@media (pointer: coarse)`.

Clés à ajouter dans **les dix** locales, sous `articleList` (valeurs françaises ;
traduire les neuf autres) :

```json
"scanScanned_one": "{{count}} article parcouru",
"scanScanned_other": "{{count}} articles parcourus",
"scanResults_one": "{{count}} résultat",
"scanResults_other": "{{count}} résultats",
"scanStop": "Arrêter",
"scanRetry": "Réessayer",
"scanStopped": "Balayage interrompu",
"scanOffline": "Hors ligne — résultats parmi les articles disponibles",
"scanNetworkError": "Connexion perdue pendant le balayage",
"scanRateLimited": "Trop de requêtes — réessayez dans une minute"
```

Deux compteurs séparés plutôt qu'une phrase unique : i18next ne décline qu'un
`count` par clé, et le polonais comme l'ukrainien ont besoin de `_few`/`_many`
sur **chacun** des deux nombres.

- [ ] **Étape 4 : voir les tests passer, puis la parité**

```bash
npx vitest run src/components/ArticleList/SearchScanBar.test.tsx src/lib/listPagination.test.ts
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk","zh"].filter(l=>fs.existsSync(`src/locales/${l}.json`));const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":`parité ok (${L.length} locales : ${L.join(", ")})`)'
```

Attendu : tests VERTS et `parité ok (10 locales : …)`.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/ArticleList/SearchScanBar.tsx src/components/ArticleList/SearchScanBar.test.tsx src/components/ArticleList/ArticleList.tsx src/lib/listPagination.ts src/lib/listPagination.test.ts src/styles/index.css src/locales
git commit -m "feat(search): show scan progress, and never claim empty too early"
```

---

### Task 6 : hors ligne

**Files:**
- Modify: `src/stores/feedStore.ts`
- Test: `src/stores/feedStore.searchOffline.test.ts`

**Interfaces:**
- Consomme : `listGet` de `src/lib/offlineStore`, `viewKey` (déjà dans le store).
- Produit : la branche hors ligne de `search`, qui pose `searchScan.error = 'offline'`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/stores/feedStore.searchOffline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return { ...actual, fetchStreamPage: vi.fn() };
});
vi.mock('../lib/offlineStore', () => ({ listGet: vi.fn(), listPut: vi.fn(), subsGet: vi.fn(), subsPut: vi.fn(), queueGet: vi.fn(), queuePut: vi.fn(), listEvictOlderThan: vi.fn() }));

import { fetchStreamPage } from '../api/feeds';
import { listGet } from '../lib/offlineStore';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';

const page = vi.mocked(fetchStreamPage);
const cached = vi.mocked(listGet);

const article = (id: string, title: string) => ({
  id, title, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: 0, read: false, starred: false, labels: [], tags: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  useFeedStore.setState({ selectedFeed: { id: 'feed/1', title: 'Flux' }, filter: 'unread', articles: [], searchResults: [] } as never);
});

describe('search hors ligne', () => {
  it('ne balaye pas, filtre ce qui est disponible, et le dit', async () => {
    cached.mockResolvedValue({ key: 'k', articles: [article('a', 'alpha moteur'), article('b', 'beta')], continuation: null, cachedAt: 0 } as never);

    await useFeedStore.getState().search('moteur');

    expect(page).not.toHaveBeenCalled();
    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a']);
    expect(s.searchScan).toMatchObject({ running: false, error: 'offline', done: true });
  });
});
```

- [ ] **Étape 2 : voir le test échouer**

Commande : `npx vitest run src/stores/feedStore.searchOffline.test.ts`
Attendu : ÉCHEC — `fetchStreamPage` appelé, `error` à `null`.

- [ ] **Étape 3 : écrire la branche**

Dans `search`, juste avant `corpusIsUsable` :

```ts
    // Hors ligne : aucun balayage possible. On filtre ce qu'on détient — la
    // liste en mémoire et la liste rangée pour cette vue — et la barre d'état
    // dit ce qui a été fouillé. Prétendre avoir tout vu serait pire que ne rien
    // chercher.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const record = await listGet(viewKey(selectedFeed, filter)).catch(() => undefined);
      const pool = [...get().articles, ...(record?.articles ?? [])];
      const seen = new Set<string>();
      const hits = pool.filter((a) => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return matchesTerms(articleHaystack(a), scanTerms);
      });
      set({
        searchResults: hits,
        articles: hits.slice(0, SEARCH_PAGE),
        searchScan: { running: false, scanned: pool.length, done: true, stopped: false, error: 'offline' },
      });
      return;
    }
```

(`matchesTerms` s'ajoute à l'import de `../lib/searchMatch`.)

- [ ] **Étape 4 : voir le test passer**

Commande : `npx vitest run src/stores/feedStore.searchOffline.test.ts`
Attendu : SUCCÈS.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/stores/feedStore.ts src/stores/feedStore.searchOffline.test.ts
git commit -m "feat(search): offline search says what it actually looked at"
```

---

### Task 7 : cohérence du corpus avec les écritures

**Files:**
- Modify: `src/stores/feedStore.ts`
- Test: `src/stores/feedStore.searchCoherence.test.ts`

**Interfaces:**
- Consomme : `patchSearchCorpus`, `dropSearchCorpus` (Task 4).
- Produit : un corpus qui ne ressort jamais un état périmé.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/stores/feedStore.searchCoherence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    fetchStreamPage: vi.fn(),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
  };
});

import { fetchStreamPage } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';
import { useAuthStore } from './authStore';

const page = vi.mocked(fetchStreamPage);
const item = (id: string, title: string) => ({
  id, title, origin: { streamId: 'feed/1', title: 'Flux' }, published: 0, categories: [], summary: { content: '' },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useAuthStore.setState({ activeServerId: 7 } as never);
  useFeedStore.setState({ selectedFeed: { id: 'feed/1', title: 'Flux' }, filter: 'all', articles: [], searchResults: [] } as never);
});

describe('corpus et écritures', () => {
  it('un article coché lu pendant une recherche ne redevient pas non lu à la recherche suivante', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');

    await useFeedStore.getState().toggleArticleRead(useFeedStore.getState().searchResults[0]);
    page.mockClear();

    await useFeedStore.getState().search('moteur');

    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().searchResults[0].read).toBe(true);
  });

  it('« tout marquer comme lu » jette le corpus au lieu de le laisser mentir', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().markAllAsRead();
    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(1);
  });

  it('changer de serveur jette le corpus', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    useAuthStore.setState({ activeServerId: 8 } as never);
    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Commande : `npx vitest run src/stores/feedStore.searchCoherence.test.ts`
Attendu : ÉCHEC — l'article ressort `read: false`, et le corpus est réutilisé
après « tout lu ».

- [ ] **Étape 3 : brancher le corpus sur les écritures**

Dans `toggleArticleRead`, `selectArticle` (marquage à l'ouverture),
`toggleStar` et `toggleReadLater`, après la mise à jour optimiste de
`articles`, ajouter l'appel correspondant — par exemple :

```ts
    patchSearchCorpus(article.id, { read: newRead });
```

et sur le rollback, l'appel inverse avec l'ancienne valeur.

Dans `markAllAsRead`, après l'écriture optimiste :

```ts
    // Un « tout lu » touche trop d'articles pour être répercuté un par un ; le
    // corpus gardé deviendrait faux en bloc.
    dropSearchCorpus();
```

Dans `resetAndReload` (changement de serveur), ajouter `dropSearchCorpus();`
à côté des autres remises à zéro.

- [ ] **Étape 4 : voir les tests passer**

Commande : `npx vitest run src/stores/feedStore.searchCoherence.test.ts`
Attendu : SUCCÈS, 3 tests.

- [ ] **Étape 5 : prouver que la garde mord**

Retirer `patchSearchCorpus(...)` de `toggleArticleRead` : le premier test doit
ROUGIR. Le remettre, il reverdit.

- [ ] **Étape 6 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/stores/feedStore.ts src/stores/feedStore.searchCoherence.test.ts
git commit -m "fix(search): keep the kept corpus honest about read and starred state"
```

---

### Task 8 : documentation

**Files:**
- Modify: `docs/FEATURES.md` (section « Recherche », lignes ~989-1012)
- Modify: `README.md` (la puce « Search and infinite scroll », ligne ~78)
- Modify: `docs/RELEASE-NEXT.md`

- [ ] **Étape 1 : réécrire la section Recherche de `docs/FEATURES.md`**

Elle doit dire, dans cet ordre : que l'API greader de FreshRSS **n'a pas** de
paramètre de recherche (versions vérifiées, pour que personne ne « rétablisse »
le `q`) ; que le filtrage est client, dans le périmètre de
`resolveSearchStreamId` ; le balayage par tranches de 1 000 avec continuation ;
le corpus gardé cinq minutes par périmètre et ce qui l'invalide (péremption,
périmètre, serveur, « tout lu ») ; les règles de correspondance (tous les mots,
sans casse ni accents, HTML retiré, entités décodées) ; le comportement hors
ligne ; la barre d'état et pourquoi « aucun résultat » attend la fin du
balayage ; le coût mesuré (≈2 Mo par tranche de 1 000) et le risque mémoire.
Garder les pièges toujours vrais de l'ancienne section (pas de cache pour les
résultats, `activeServerId` string/number) et **retirer** ce qui devient faux
(pagination réseau des résultats).

- [ ] **Étape 2 : corriger le README**

Remplacer la puce actuelle par une formulation vraie, en anglais : recherche
côté client, périmètre de la vue, articles lus compris, progression affichée.

- [ ] **Étape 3 : ajouter l'entrée de `docs/RELEASE-NEXT.md`**

Sous « Corrections et améliorations », une entrée franche : la recherche
renvoyait la liste entière sans filtrer, parce que l'API greader de FreshRSS n'a
pas de paramètre de recherche ; elle filtre désormais côté client, dans le
périmètre de la vue, articles lus compris.

- [ ] **Étape 4 : vérifier le garde-fou d'inventaire**

Commande : `npx vitest run src/lib/featuresDoc.test.ts`
Attendu : SUCCÈS.

- [ ] **Étape 5 : gates + garde-fou + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add docs/FEATURES.md README.md docs/RELEASE-NEXT.md
git commit -m "docs: describe the search that actually exists"
```

---

### Task 9 : vérification réelle (aucun code)

**Files:** aucun.

- [ ] **Étape 1 : attendre le redéploiement de l'instance de dev par le propriétaire.**

- [ ] **Étape 2 : parcours dans le navigateur, sur l'instance de dev**

1. Chercher un terme rare dans un flux : résultats filtrés, barre d'état, fin nette.
2. Chercher le même terme dans « Tous les flux » : progression visible, résultats au fil de l'eau, ~10 s.
3. Chercher un terme absent : « Aucun résultat » **seulement après** la fin du balayage.
4. Affiner la requête juste après : aucun appel réseau (onglet réseau vide).
5. Arrêter un balayage en cours : résultats conservés, Réessayer reprend.
6. Cocher lu un résultat, relancer la même requête : l'article reste lu.
7. Descendre dans une longue liste de résultats : tranches de 50, aucun appel réseau.
8. Quitter la recherche : la vue revient comme avant.

- [ ] **Étape 3 : mesurer la mémoire sur le téléphone du propriétaire**

Après un balayage complet de « Tous les flux » sur iPhone, relever la mémoire de
l'onglet et vérifier que l'app reste vive après un aller-retour vers une autre
application. C'est le risque assumé de la spec ; si l'onglet est déchargé, ouvrir
une tâche de suite : ne garder que le texte normalisé et les articles
correspondants.

- [ ] **Étape 4 : rendre compte au propriétaire** — parcours, mesures, et ce qui reste ouvert.

---

## Auto-revue du plan

- **Couverture de la spec** : corpus lus compris (T4, périmètre `reading-list`
  et flux — le filtre de vue n'entre pas dans le balayage) ; corpus gardé cinq
  minutes (T2/T4) ; correspondance tous mots/accents/HTML (T1) ; affichage au fil
  de l'eau et barre d'état (T5) ; tranches de 50 (T4/T5) ; hors ligne (T6) ;
  coupure, 429, reprise à la continuation (T3/T4/T5) ; changement de serveur et
  écritures locales (T7) ; documentation et traductions (T5/T8) ; risque mémoire
  (T9).
- **Cohérence des noms** : `searchScan`, `searchResults`, `searchVisible`,
  `stopSearch`, `retrySearch`, `showMoreSearchResults`, `patchSearchCorpus`,
  `dropSearchCorpus`, `__resetSearchStateForTests` — mêmes noms de la Task 4 à la
  Task 7. `SearchScan` doit être exporté depuis `feedStore.ts` pour que
  `SearchScanBar` le type (Task 4).
- **Pas de reste** : `searchItems` disparaît en Task 4 ; aucun appelant ne
  subsiste (`search`, `loadMore`).
