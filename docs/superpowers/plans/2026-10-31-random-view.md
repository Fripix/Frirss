# Affichage aléatoire — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un bouton « Aléatoire » dans la barre de la liste, qui tire au hasard des articles de la vue selon deux paramètres libres des Préférences.

**Architecture:** un état transitoire `randomView` du `feedStore`, jamais persisté. La logique pure vit dans `src/lib/randomDraw.ts`. Aucun ordre enregistré : `ArticleOrder`, `effectiveOrder` et les clés de vue ne changent pas.

**Tech Stack:** TypeScript, React 19, Zustand, vitest, axios.

**Spec:** `docs/superpowers/specs/2026-10-31-random-order-design.md`

## Global Constraints

- Branche `feat/random-view`, **jamais de push sur `dev`** tant que le propriétaire n'a pas dit de fusionner.
- Commits sans trailer ni mention d'IA ; garde-fou d'infra et gates chaînés avant chacun.
- Nombre d'articles : 1 à 500, défaut 20. Ancienneté : entier ≥ 1 en heures ou jours, 0 = tous, 10 000 identifiants au plus, relevés par pages de 1 000.
- Contenus par lots de 100 `i=`.
- 10 locales, desktop, tablette, 320 px. `docs/FEATURES.md` et `docs/RELEASE-NEXT.md` dans le commit qui change le comportement.
- `frontend-design` invoqué avant le JSX et le CSS.

## Review Focus

- Un geste (lu, favori) en mode aléatoire n'écrit aucune liste sous la clé de la vue, ni en mémoire ni sur disque.
- Un tirage en vol au moment d'un changement de vue, de compte ou d'un nouveau tirage est jeté.
- Quitter le mode rend exactement la liste normale de la vue, avec ses lignes et sa pagination.
- Un retour au premier plan ne change pas la liste en cours de lecture.
- Une valeur de préférence illisible, négative ou décimale, reçue d'un autre appareil, ne casse pas le tirage.

---

### Task 1 : logique pure

**Files:** Create `src/lib/randomDraw.ts`, `src/lib/randomDraw.test.ts`

**Interfaces — Produces:**
- `export const RANDOM_MAX_IDS = 10000`, `RANDOM_DEFAULT_COUNT = 20`, `RANDOM_MAX_COUNT = 500`
- `export type RandomWindowUnit = 'hours' | 'days'`
- `normalizeRandomCount(v: unknown): number`, `normalizeRandomAmount(v: unknown): number`, `normalizeRandomUnit(v: unknown): RandomWindowUnit`
- `randomCutoffUsec(amount: number, unit: RandomWindowUnit, nowMs: number): bigint | null` (`null` si amount = 0)
- `drawIds(ids: readonly string[], count: number, rng?: () => number): string[]`
- `inDrawOrder<T extends { id: string }>(items: T[], drawn: readonly string[]): T[]`

- [ ] Tests : `normalizeRandomCount` rend 20 pour `undefined`, `'x'`, `0`, `-3`, `1.5`, `501`, et garde `1` et `500` ; `normalizeRandomAmount` rend 0 pour le même illisible et garde `48` ; `drawIds` rend `count` identifiants distincts tirés de `ids`, tous mélangés si `count` dépasse la liste, le résultat suit le générateur injecté ; `inDrawOrder` suit le tirage quand les articles arrivent triés et que leur `id` est sous forme `tag:…/hex` alors que le tirage est décimal, et ignore un identifiant sans article ; `randomCutoffUsec(24, 'hours', t)` et `randomCutoffUsec(1, 'days', t)` sont égaux.
- [ ] Vérifier le rouge : `npx vitest run src/lib/randomDraw.test.ts`
- [ ] Implémenter : Fisher-Yates partiel ; comparer les identifiants par `entryIdUsec` (`src/lib/entryId.ts`), le seul endroit qui connaît leurs deux formes.
- [ ] Vérifier le vert, puis commit `feat(random): draw logic and setting bounds`.

### Task 2 : API

**Files:** Modify `src/api/feeds.ts`, `src/api/feeds.subscriptions.test.ts`

**Interfaces — Produces:**
- `getStreamIdsSince(streamId: string, opts: { excludeRead: boolean; cutoffUsec: bigint | null; max: number }): Promise<string[]>`
- `getItemsByIds(ids: readonly string[]): Promise<GReaderItem[]>`

- [ ] Tests : les pages s'enchaînent par `continuation` ; `xt` n'est envoyé que sous `excludeRead` ; aucun `ot` ; le relevé s'arrête au premier identifiant plus ancien que le seuil et à `max` ; 250 identifiants font 3 POST de 100 au plus sur `/stream/items/contents`, corps `i=…&i=…` ; une réponse HTML rejette (`expectJson`).
- [ ] Vérifier le rouge, implémenter, vérifier le vert. Corps en `URLSearchParams`, comme `editTag` ; aucun `T=`.
- [ ] Commit `feat(random): item ids since a cutoff and contents by id`.

### Task 3 : préférences

**Files:** Modify `src/stores/uiStore.ts`, `src/components/Preferences/GeneralTab.tsx`, `src/locales/*.json`, baseline des réglages si le garde-fou le demande (une question, voir `CLAUDE.md`).

**Interfaces — Produces:** `uiStore.randomCount`, `randomWindowAmount`, `randomWindowUnit`, `setRandomCount(n)`, `setRandomWindow(amount, unit)`.

- [ ] Invoquer `frontend-design`.
- [ ] Tests : valeur illisible reçue par synchro ramenée au défaut ; clés dans les listes de synchro de `uiStore` (lignes voisines d'`articleOrder`) ; vider le champ d'ancienneté donne 0 et l'unité reste.
- [ ] Implémenter sous « Ordre des articles ». Parité des locales vérifiée.
- [ ] Commit `feat(random): settings under article order`.

### Task 4 : le mode dans le store

**Files:** Modify `src/stores/feedStore.ts` ; Create `src/stores/feedStore.randomView.test.ts`

**Interfaces — Produces:** `randomView: boolean`, `setRandomView(on: boolean): void`, `redrawRandom(): Promise<void>`. L'échec réutilise `listFailed`.

- [ ] Tests, tous sur le store avec `offlineStore` et `api/feeds` bouchonnés :
  - activer tire `randomCount` articles, sans `continuation`, dans l'ordre du tirage ;
  - aucun `listPut`, et la mémoire de la vue reste celle d'avant, après tirage, après `toggleRead`, `toggleStar`, marquage implicite et rollback ;
  - désactiver rend la liste normale et sa `continuation` ;
  - le mode survit à `setFilter('unread')` et refait un tirage ; il prend fin à `selectView` d'un autre flux, à `setFilter('starred')`, à `search`, au changement de portée ;
  - une réponse de tirage périmé est jetée, en vue, en portée et en numéro de tirage ;
  - `silentRefresh` ne change pas `articles` et `syncCounts` laisse `newInView` à 0 ;
  - `refresh` fait un seul tirage, à la fin ;
  - échec réseau : `listFailed` vrai, mode conservé.
- [ ] Vérifier le rouge.
- [ ] Implémenter : branche en tête de `loadArticles` ; `persistCurrentView` et tout `memSet`/`listPut` sous `viewKey` gardés ; `warmExtracts` non appelé. Passer en revue chaque appel de `persistCurrentView`, `memSet`, `listPut`.
- [ ] Vérifier le vert, suite `src/stores` complète, commit `feat(random): transient view in the store`.

### Task 5 : la liste

**Files:** Modify `src/components/ArticleList/ArticleList.tsx`, `src/locales/*.json`, `docs/FEATURES.md`, `docs/RELEASE-NEXT.md` ; tests dans `src/components/ArticleList/`.

- [ ] Invoquer `frontend-design`.
- [ ] Tests : bouton présent sous Tous et Non lus, absent sous Favoris, À lire plus tard, en recherche ; désactivé hors ligne ; « Tout lu » et `canMarkRange` absents en mode ; pas de séparateurs de date en liste ni en grille ; « Nouveau tirage » en fin de liste appelle `redrawRandom` et remonte ; tirer-pour-rafraîchir refait un tirage ; état vide `articleList.randomEmpty`.
- [ ] Implémenter dans les trois barres.
- [ ] Mesurer à 320 px sur la feuille construite, les 10 langues. S'il ne tient pas : s'arrêter, revenir au propriétaire.
- [ ] `docs/FEATURES.md` (entrée « Affichage aléatoire », et prose de « Ordre des articles » relue), `docs/RELEASE-NEXT.md`.
- [ ] Commit `feat(random): list button, new draw, documentation`.

### Task 6 : relecture et remise

- [ ] Relecture à l'œil neuf de toute la branche, chaque constat avec son test rouge d'abord, correctifs relus.
- [ ] Gates complets sur la branche, pas de push sur `dev`.
- [ ] Rendre compte : le test en direct de `POST stream/items/contents` reste à faire après fusion.
