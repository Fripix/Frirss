# Traductions par IA — plan 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traduire le résumé et l'article entier vers une langue cible, à la
demande ou automatiquement par flux ou catégorie, avec forçage ponctuel de la
langue et du fournisseur, le même repli et le même plafond que les résumés ;
et donner au résumé automatique le même réglage par flux ou catégorie.

**Architecture:** Le serveur gagne une opération `translate` à côté de
`summarize` : même résolution de fournisseur (un étage `translation` en plus),
même repli, même plafond par appel, même cache ; **un lot = une requête HTTP =
un appel fournisseur**, le client découpe l'article avec le DOM et réinjecte
les segments traduits après le sanitiseur. Les réglages sont des préférences
synchronisées de `uiStore` (à plat, comme celles du plan 2). Les écrans
réutilisent `ProviderOptions`, `ToggleSwitch`, `ConfirmDialog`, `BottomSheet`
et le popover du panneau.

**Tech Stack:** TypeScript strict, React 18, zustand, Express 5,
better-sqlite3, vitest + Testing Library (jsdom pour le DOM), i18next (10
locales), `Intl.DisplayNames`.

**Spec:** `docs/superpowers/specs/2026-10-15-ai-summaries-design.md` — **§17**
(révision traduction, remplace §7, le volet traduction de §8, le bloc
« Traduction » de §10 et la note de §11) ; §4 (consigne de traduction), §6
(résolution, repli), §9 (plafond, cache), §12–§14. Plans précédents :
`2026-10-15-ai-summaries-core.md`, `2026-10-20-ai-summaries-user.md`.

## Global Constraints

- Branche `ai-summaries` ; jamais `dev` ni `main` sans le propriétaire.
- Gates avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build` ; `npx eslint .` sans avertissement.
- Garde-fou de fuite avant chaque commit, sortie vide : `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'` ; valeurs de test fictives (`example.com`, `10.0.0.1`).
- Messages de commit conventionnels, **sans** trailer `Co-Authored-By` ni mention d'assistant.
- Toute chaîne visible dans les **10 locales** (fr, en, de, es, it, nl, pl, pt, uk, zh) ; pluriels `_one`/`_other` + `_few`/`_many` (pl, uk) ; zh dit « 服务商 » pour fournisseur ; pt européen. **Aucune clé i18n pour les noms de langues** (`Intl.DisplayNames`).
- `docs/FEATURES.md` à jour **dans le même commit** (famille renommée « Résumés et traductions par IA » à la tâche 10 ; routes nouvelles dans le tableau ; `featuresDoc.test.ts`).
- Une clé n'est jamais renvoyée, journalisée ni mise dans une URL ; préférences en clair, jamais une clé.
- Aucune dépendance nouvelle. Pas de flux de texte. Pas de pastille ni d'entrée de menu contextuel de liste pour la traduction.
- Repli : règle de §6, **y compris sur un forçage** (« Traduire avec X » replie et dit « X indisponible »).
- Cibles tactiles 44 pt, libellés liés, surfaces flottantes par portail, tenue à **320 px**.
- Liste des langues, figée : `fr en de es it nl pl pt uk zh-Hans zh-Hant sv da nb fi cs ro hu el ca ja ko ar tr hi id vi th` (28, ni `ru` ni `he`).
- Lots d'environ **1 200 mots** ; `maxTokens: 8192` pour Anthropic en traduction ; échéance **50 s par requête HTTP** (`SUMMARY_DEADLINE_MS` existant) ; borne **200 000 octets** de segments par requête ; 512 caractères d'`articleId`.
- Texte de la confirmation « Traduire » (spec §17.2), mot pour mot : « Traduire un article entier coûte cinq à quinze fois un résumé, et chaque article de ce flux sera traduit à l'ouverture. Selon le fournisseur et votre abonnement, cela peut vous être facturé. Un modèle local comme Ollama ne coûte rien. »

## Décisions prises en écrivant ce plan

- **Un seul moteur serveur** : `server/ai/translate.ts` reprend la boucle de candidats de `summarize.ts` (cache → échéance → réservation → appel → remboursement → repli). Le code commun est extrait dans `server/ai/attempt.ts` (`runWithFallback`) à la tâche 1, et `summarize.ts` l'utilise ensuite — la seule refonte de ce plan, justifiée : deux copies de cette boucle divergeraient (plafond, journal des bascules).
- **Le client découpe et regroupe** (`src/lib/articleSegments.ts`) : le serveur ne voit que `segments: string[]` d'un lot et ne connaît ni le DOM ni les lots voisins.
- **La traduction du résumé** passe par la même route avec `scope: 'summary'` et un seul segment (le texte du résumé) ; `same` possible.
- **Clé de cache** : `op: 'translate'`, `lang: targetLang`, `contentHash` = hash de `scope + segments du lot`. Un lot = une entrée.
- **Priorité auto** (résumé comme traduction) : valeur propre du flux (`true`/`false`) > une catégorie allumée > (résumé seulement) l'interrupteur global. Fonction pure `src/lib/aiAuto.ts`.
- **Tactile** : le bouton « Traduire l'article » de la barre fait l'action ; un appui long ouvre le même menu que le chevron ; les entrées « Traduire en… » / « Traduire avec… » figurent aussi dans la feuille « … » du volet (`readSettingsOpen`, `BottomSheet` existant).
- **Notice de l'article** : un `<div role="status">` (ou `role="alert"` pour une erreur) au-dessus du corps, même gabarit que l'avis d'extraction (`ReadingPane.tsx:1401`), monté sur les trois formats.
- **Le résumé automatique par flux** réutilise le déclencheur existant (`AUTO_SUMMARY_DELAY_MS`, `autoSummarisedId`) : seule la condition `aiAutoSummary` devient `autoSummaryFor(article)` (tâche 9).

## Review Focus

- **Un modèle renvoie les segments dans le désordre ou en fusionne deux** : le lot est rejoué une fois, puis l'erreur « segments » s'affiche ; jamais une traduction mal alignée. → tâche 1.
- **Un article dont tous les blocs sont vides ou sans lettres (galerie d'images)** : aucune requête, bouton « Traduire l'article » désactivé avec son aide. → tâche 3.
- **Un flux marqué « Traduire » dont l'article est déjà dans la langue cible** : une seule requête (entrée seule), rien ne change à l'écran, pas de notice d'erreur. → tâches 1 et 9.
- **L'article extrait arrive après une traduction manuelle de l'extrait** : retour au texte source, aucune retraduction sans clic. → tâche 8.
- **Un code de langue inconnu venu d'une synchronisation** (`aiTranslationLanguage: 'ru'`) : revient à `'ui'`, et le serveur refuse `targetLang` hors liste (400 `invalid_lang`). → tâches 1 et 4.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/ai/attempt.ts` (nouveau) | `runWithFallback` : boucle candidats commune |
| `server/ai/summarize.ts` | n'utilise plus que `runWithFallback` |
| `server/ai/translate.ts` (nouveau) | `translate()` : lot, format strict, rejeu, `same` |
| `server/ai/prompts.ts` | `translateSystem`, `translateUserMessage`, parseurs |
| `server/ai/resolve.ts` | étage `translation` |
| `server/ai/languages.ts` (nouveau) | la liste des 28 codes côté serveur |
| `server/routes/ai.ts` | `POST /api/ai/translate` |
| `src/lib/aiLanguages.ts` (nouveau) | liste, `sameLanguage`, `targetLanguage(ui)`, `languageName` |
| `src/lib/articleSegments.ts` (nouveau) | découpage DOM, lots, réinjection |
| `src/lib/aiAuto.ts` (nouveau) | priorité auto flux > catégorie > global |
| `src/stores/uiStore.ts` | préférences nouvelles |
| `src/stores/aiStore.ts` | `aiAutoTranslateConfirmed` remis à faux à la déconnexion |
| `src/api/backend.ts` | `requestAiTranslation`, types |
| `src/lib/aiRouting.ts` | `translationProvider` |
| `src/lib/aiErrorKey.ts` | `invalid_lang`, `segments` |
| `src/components/Preferences/ai/TranslationBlock.tsx` (nouveau) | langue cible, fournisseur |
| `src/components/Preferences/ai/RoutingBlock.tsx` | interrupteurs « Résumer » / « Traduire » |
| `src/components/Preferences/AiTab.tsx` | ordre des blocs |
| `src/components/ReadingPane/TranslateMenu.tsx` (nouveau) | menu langues / fournisseurs, popover ou feuille |
| `src/components/ReadingPane/AiSummary.tsx` | « Traduire » / « Texte source » du résumé |
| `src/components/ReadingPane/useArticleTranslation.ts` (nouveau) | état et lots de la traduction de l'article |
| `src/components/ReadingPane/ReadingPane.tsx` | bouton, notice, corps traduit, déclencheurs auto |
| `src/locales/*.json` | chaînes |
| `docs/FEATURES.md`, `SECURITY.md`, `docs/RELEASE-NEXT.md` | inventaire, sécurité, journal |

---

### Task 1: Moteur de traduction côté serveur

**Files:**
- Create: `server/ai/attempt.ts`, `server/ai/translate.ts`, `server/ai/languages.ts`
- Modify: `server/ai/summarize.ts`, `server/ai/prompts.ts`, `server/ai/resolve.ts`, `server/routes/ai.ts`
- Test: `server/ai/attempt.test.ts`, `server/ai/translate.test.ts`, `server/ai/prompts.test.ts`, `server/ai/resolve.test.ts`, `server/test/ai.test.ts` ; les tests existants de `summarize.test.ts` restent verts sans modification
- Docs: `docs/FEATURES.md` (puce « Traduction — serveur », tableau des routes), `SECURITY.md` (une phrase : la traduction suit les mêmes règles de clés et de repli)

**Interfaces:**
- Produces `server/ai/languages.ts` : `export const AI_LANGUAGES = ['fr','en','de','es','it','nl','pl','pt','uk','zh-Hans','zh-Hant','sv','da','nb','fi','cs','ro','hu','el','ca','ja','ko','ar','tr','hi','id','vi','th'] as const` ; `export type AiLanguage = typeof AI_LANGUAGES[number]` ; `export function isAiLanguage(v: unknown): v is AiLanguage`.
- Produces `server/ai/attempt.ts` : `export interface Attempt<T> { userId: number; resolution: ResolutionInput; available: Availability[]; fallback: boolean; deadline: number; now: () => number; cacheKeyFor: (cand: Availability) => string; call: (cand: Availability, timeoutMs: number) => Promise<T>; onSuccess?: (cand: Availability, result: T) => Promise<AiCacheValue | null> }` et `export async function runWithFallback<T>(a: Attempt<T>): Promise<{ result: T | AiCacheValue; cand: Availability; fromCache: boolean; fellBackFrom?: string }>` — même sémantique que la boucle actuelle de `summarize.ts` (cache avant plafond, réservation `bumpUsage` et remboursement `refundUsage` quand `cand.paidByAdmin`, `AI fallback:` au journal, `deadline`, `ownKey`).
- Produces `server/ai/resolve.ts` : `resolveProvider` accepte `translation?: number | null`, étage inséré **après `force`** et avant `feed`.
- Produces `server/ai/prompts.ts` : `export function translateSystem(targetLang: string): string` (consigne §4 : fidèle, sans résumé ni commentaire, structure et balises en ligne conservées ; répondre d'abord `lang: <code>` ; si la source est déjà `targetLang`, répondre `lang: <code>` puis la seule ligne `same` ; sinon chaque segment dans `<s n="N">…</s>` dans le même ordre, sans en fusionner ni en ajouter) ; `export function translateUserMessage(segments: string[]): string` (segments numérotés à partir de 0 dans `<s n="N">…</s>`) ; `export function parseTranslation(text: string, count: number): { lang: string | null; same: boolean; segments: string[] | null }` (`segments` est `null` si un numéro manque, est en double ou dépasse `count`).
- Produces `server/ai/translate.ts` : `export interface TranslateRequest { userId: number; articleId: string; scope: 'summary' | 'article'; targetLang: AiLanguage; segments: string[]; resolution: ResolutionInput & { translation?: number | null }; available: Availability[]; fallback: boolean }` ; `export interface TranslateResponse { segments: string[]; lang: string | null; same: boolean; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string }` ; `export async function translate(req, deps?)`. Un lot = un appel ; `maxTokens: 8192` pour `anthropic` ; `parseTranslation` nul → **un** rejeu dans la même requête si `deadline - now() >= MIN_CALL_MS`, sinon `AiError('technical','segments')` ; `same` → réponse `{ segments: [], same: true }` mise en cache comme telle.
- Produces route `POST /api/ai/translate` : corps `{ articleId, scope, targetLang, segments, provider?, translationProvider?, feedProvider?, categoryProvider?, preferredProvider?, fallback? }` ; 404 `ai_disabled` ; 400 `invalid_body` (articleId > 512, `segments` non tableau de chaînes, vide, ou > 200 000 octets au total, `scope` inconnu) ; 400 `invalid_lang` (`!isAiLanguage`) ; erreurs comme `/summary` (`ai_daily_cap` 429 avec `cap`/`resetAt`, `no_provider` 409, `ai_refused` 422, `ai_failed` 502 avec `kind`, `ownKey`, et `detail: 'segments'` quand `err.message === 'segments'`).
- Produces `server/ai/resolve.ts` : `export type ResolutionInput = Parameters<typeof resolveProvider>[0]` (le premier paramètre, avec `translation?`).

- [ ] **Step 1: Write the failing tests**

`server/ai/prompts.test.ts` :
```ts
it('parseTranslation reads lang, then numbered segments in order', () => {
  expect(parseTranslation('lang: en\n<s n="0">Hi</s>\n<s n="1">There</s>', 2)).toEqual({ lang: 'en', same: false, segments: ['Hi', 'There'] });
});
it('parseTranslation reports same and tolerates a missing lang line', () => {
  expect(parseTranslation('lang: fr\nsame', 3)).toEqual({ lang: 'fr', same: true, segments: null });
  expect(parseTranslation('<s n="0">x</s>', 1)).toEqual({ lang: null, same: false, segments: ['x'] });
});
it('parseTranslation returns null segments on a missing, duplicate or extra number', () => {
  expect(parseTranslation('<s n="0">a</s><s n="0">b</s>', 2).segments).toBeNull();
  expect(parseTranslation('<s n="0">a</s><s n="2">c</s>', 2).segments).toBeNull();
  expect(parseTranslation('<s n="0">a</s>', 2).segments).toBeNull();
});
it('translateSystem names the target and forbids merging; translateUserMessage numbers from 0', () => {
  expect(translateSystem('de')).toMatch(/\bde\b/); expect(translateSystem('de')).toMatch(/same/);
  expect(translateUserMessage(['a', 'b'])).toBe('<s n="0">a</s>\n<s n="1">b</s>');
});
```
`server/ai/resolve.test.ts` : `resolveProvider({ force: null, translation: 2, feed: 1 }, …)` rend le 2 ; `translation` indisponible est sauté ; `force` prime sur `translation`.
`server/ai/attempt.test.ts` : avec un `call` qui échoue puis réussit, `runWithFallback` rend `fellBackFrom` ; un `paidByAdmin` au plafond est sauté et remboursé ; un cache hit ne réserve rien ; `fallback: false` jette la première erreur.
`server/ai/translate.test.ts` (même harnais que `summarize.test.ts`) :
```ts
it('translates one batch with the strict format and a translate cache key', async () => { /* call rend 'lang: en\n<s n="0">Bonjour</s>' ; r.segments ['Bonjour'], r.lang 'en', clé contient ':translate:' et ':fr:' */ });
it('replays once a malformed answer, then fails with segments', async () => { /* 1er appel désordre → 2e appel ok ; puis 2 mauvais → AiError technical 'segments' */ });
it('answers same without text and caches it', async () => { /* 'lang: fr\nsame' → { same: true, segments: [] } ; 2e appel fromCache */ });
it('passes maxTokens 8192 to an anthropic provider only', async () => {});
it('charges one cap unit per batch and refunds a failed one', async () => {});
```
`server/test/ai.test.ts` : `describe('ai translate route')` — 400 pour `targetLang: 'ru'` (`invalid_lang`), pour `segments: []`, pour 200 001 octets ; 200 avec `fetch` stubé rendant le format strict ; 429 `ai_daily_cap` pour un utilisateur non-admin plafonné.

- [ ] **Step 2: Run them to verify they fail** — `npx vitest run server/ai server/test/ai.test.ts` : FAIL (modules et route absents).
- [ ] **Step 3: Implement** — `attempt.ts` d'abord (extrait de `summarize.ts` sans changer son comportement : les tests de `summarize.test.ts` restent verts tels quels), puis `languages.ts`, `prompts.ts`, `resolve.ts`, `translate.ts`, la route.
- [ ] **Step 4: Run to verify pass** — `npx vitest run server/` puis les gates.
- [ ] **Step 5: Docs, guard, commit** — `feat(ai): translation engine and route`.

---

### Task 2: Langues côté client

**Files:**
- Create: `src/lib/aiLanguages.ts`, `src/lib/aiLanguages.test.ts`

**Interfaces:**
- Produces: `export const AI_LANGUAGES` (même liste que le serveur, même ordre) ; `export type AiLanguage` ; `export function isAiLanguage(v: unknown): v is AiLanguage` ; `export function targetLanguage(uiLang: string): AiLanguage` (`'zh'`/`'zh-CN'` → `'zh-Hans'`, `'zh-TW'`/`'zh-HK'` → `'zh-Hant'`, `'pt-BR'` → `'pt'`, sinon la sous-étiquette principale si elle est dans la liste, sinon `'en'`) ; `export function sameLanguage(a: string | null | undefined, b: string): boolean` (sous-étiquette principale égale, sauf `zh-Hant` ≠ `zh-Hans` quand les deux sont explicites ; `null` → `false`) ; `export function languageName(code: AiLanguage, uiLang: string): string` (`Intl.DisplayNames([uiLang], { type: 'language' })`, repli sur le code si indisponible).

- [ ] **Step 1: Write the failing tests**
```ts
it('has exactly the 28 fixed codes, Chinese twice, no Russian or Hebrew', () => {
  expect(AI_LANGUAGES).toHaveLength(28); expect(AI_LANGUAGES).not.toContain('ru'); expect(AI_LANGUAGES).not.toContain('he');
  expect(AI_LANGUAGES.filter((c) => c.startsWith('zh'))).toEqual(['zh-Hans', 'zh-Hant']);
});
it('maps the UI language to a target', () => {
  expect(targetLanguage('fr')).toBe('fr'); expect(targetLanguage('zh')).toBe('zh-Hans'); expect(targetLanguage('zh-TW')).toBe('zh-Hant'); expect(targetLanguage('pt-BR')).toBe('pt'); expect(targetLanguage('xx')).toBe('en');
});
it('compares languages by primary subtag, scripts apart', () => {
  expect(sameLanguage('en-US', 'en')).toBe(true); expect(sameLanguage('zh-CN', 'zh-Hans')).toBe(true); expect(sameLanguage('zh-Hant', 'zh-Hans')).toBe(false); expect(sameLanguage(null, 'fr')).toBe(false);
});
it('names a language in the UI language, falling back to the code', () => {
  expect(languageName('de', 'fr')).toBe('allemand'); expect(languageName('de', 'en')).toBe('German');
});
```
- [ ] **Step 2–4:** échec, implémentation, succès.
- [ ] **Step 5: Commit** — `feat(ai): client language list and helpers`.

---

### Task 3: Découpage de l'article en segments et en lots

**Files:**
- Create: `src/lib/articleSegments.ts`, `src/lib/articleSegments.test.ts` (`// @vitest-environment jsdom`)

**Interfaces:**
- Produces: `export const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, th, dt, dd'` (un `blockquote` ou `li` contenant un autre bloc de la liste n'est pas un segment lui-même : seuls les blocs **feuilles** le sont ; `pre` et ses descendants exclus) ; `export interface Segmented { segments: string[]; apply: (translated: string[], sanitize: (html: string) => string) => string }` ; `export function segmentArticle(title: string, html: string): Segmented` (segment 0 = titre ; un bloc dont le texte n'a aucune lettre (`\p{L}`) n'est pas envoyé ; `apply` réinjecte dans les mêmes éléments et rend le HTML du corps traduit, titre à part via `translated[0]`) ; `export function batchSegments(segments: string[], maxWords = 1200, maxBytes = 200_000): number[][]` (listes d'indices ; un segment seul plus lourd que `maxBytes` est laissé hors lot : « traduit en partie ») ; `export function wordCount(html: string): number`.

- [ ] **Step 1: Write the failing tests**
```ts
it('segments leaf blocks, keeps inline markup, skips blocks without letters and pre', () => {
  const s = segmentArticle('Titre', '<p>Un <a href="/x">lien</a></p><ul><li>a</li><li>123</li></ul><pre>code</pre><blockquote><p>q</p></blockquote>');
  expect(s.segments).toEqual(['Titre', 'Un <a href="/x">lien</a>', 'a', 'q']);
});
it('apply puts translations back in place, through the sanitiser, images untouched', () => {
  const s = segmentArticle('T', '<p>Hello</p><img src="/i.png"><p>World</p>');
  const out = s.apply(['T2', 'Bonjour', 'Monde <script>x</script>'], (h) => h.replace(/<script>.*?<\/script>/g, ''));
  expect(out).toBe('<p>Bonjour</p><img src="/i.png"><p>Monde </p>');
});
it('batches by words and bytes, leaving an oversized segment out', () => {
  const segs = ['w '.repeat(700), 'w '.repeat(700), 'x'.repeat(300_000)];
  expect(batchSegments(segs, 1200, 200_000)).toEqual([[0], [1]]);
});
```
- [ ] **Step 2–4:** échec, implémentation (`DOMParser`, `innerHTML` par bloc), succès.
- [ ] **Step 5: Commit** — `feat(ai): split an article into translatable segments`.

---

### Task 4: Préférences synchronisées et priorité automatique

**Files:**
- Create: `src/lib/aiAuto.ts`, `src/lib/aiAuto.test.ts`
- Modify: `src/stores/uiStore.ts`, `src/stores/aiStore.ts`
- Test: `src/stores/uiStore.test.ts`, `src/stores/aiStore.test.ts`

**Interfaces:**
- Produces (`useUiStore`) : `aiTranslationLanguage: 'ui' | AiLanguage` (défaut `'ui'`, normalisé par `isAiLanguage` sinon `'ui'`) / `setAiTranslationLanguage(v)` ; `aiTranslationProvider: number | null` / `setAiTranslationProvider(id)` (normalisé par `normalizeAiProviderId`, `null` traverse `applyServerPrefs` comme `aiPreferredProvider`) ; `aiCategoryAutoTranslate: Record<string, true>` / `setAiCategoryAutoTranslate(name, on: boolean)` ; `aiCategoryAutoSummary: Record<string, true>` / `setAiCategoryAutoSummary(name, on)` ; `aiAutoTranslateConfirmed: boolean` / `setAiAutoTranslateConfirmed(v)` et `aiAutoSummaryConfirmed: boolean` / `setAiAutoSummaryConfirmed(v)` (tous deux faux si absents des préférences serveur non vides, comme `aiAutoSummary`) ; `FeedSetting.aiAutoTranslate?: boolean`, `FeedSetting.aiAutoSummary?: boolean` / `setFeedAiAutoTranslate(feedId, v: boolean | '')`, `setFeedAiAutoSummary(feedId, v: boolean | '')` (par `withFeedOverride`, `''` retire). Tous dans `jsonKeys` et `UI_SYNC_KEYS` ; `normalizeAiCategoryFlags(v: unknown): Record<string, true>` exporté.
- Produces `src/lib/aiAuto.ts` : `export function autoFor(kind: 'summary' | 'translate', sourceId: string | undefined, subscriptions: Subscription[], prefs: { feedSettings; aiCategoryAutoSummary; aiCategoryAutoTranslate; aiAutoSummary }): boolean` — valeur propre du flux si booléenne, sinon vrai si une catégorie du flux est allumée (`Object.hasOwn`), sinon (`summary` seulement) `prefs.aiAutoSummary` ; `translate` sans réglage → `false`.
- `aiStore.ts` : la souscription de déconnexion appelle aussi `setAiAutoTranslateConfirmed(false)` et `setAiAutoSummaryConfirmed(false)`.

- [ ] **Step 1: Write the failing tests** (`uiStore.test.ts`, même style que les préférences du plan 2) : défauts ; persistance ; `UI_SYNC_KEYS` ; `applyServerPrefs({ aiTranslationLanguage: 'ru' })` → `'ui'` ; `{ aiCategoryAutoTranslate: { A: true, B: 'x' } }` → `{ A: true }` ; un objet serveur non vide sans `aiAutoTranslateConfirmed` → `false` ; `setFeedAiAutoTranslate('feed/1', false)` garde `false`, `''` retire. `aiAuto.test.ts` : flux `false` sous catégorie allumée → `false` ; flux sans valeur, une des deux catégories allumée → `true` ; `summary` sans rien → `aiAutoSummary` ; `translate` sans rien → `false` ; catégorie nommée `constructor` → `false`. `aiStore.test.ts` : déconnexion → les deux `…Confirmed` faux.
- [ ] **Step 2–4:** échec, implémentation, succès.
- [ ] **Step 5: Commit** — `feat(ai): translation and per-feed automatic preferences`.

---

### Task 5: Client API, routage et erreurs

**Files:**
- Modify: `src/api/backend.ts`, `src/lib/aiRouting.ts`, `src/lib/aiErrorKey.ts`, `src/locales/*.json`
- Test: `src/lib/aiRouting.test.ts`, `src/lib/aiErrorKey.test.ts`

**Interfaces:**
- Produces `backend.ts` : `export interface AiTranslationResult { segments: string[]; lang: string | null; same: boolean; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string }` ; `export async function requestAiTranslation(body: { articleId: string; scope: 'summary' | 'article'; targetLang: AiLanguage; segments: string[]; provider?: number; translationProvider?: number; feedProvider?: number; categoryProvider?: number; preferredProvider?: number; fallback?: boolean }): Promise<AiTranslationResult>`.
- Produces `aiRouting.ts` : `AiRoutingPrefs` gagne `aiTranslationProvider: number | null` ; `aiRouting(..., { op?: 'summary' | 'translate' })` ajoute `translationProvider` (normalisé) **seulement** pour `op: 'translate'`.
- Produces `aiErrorKey.ts` : `error: 'invalid_lang'` → `'ai.errors.invalidLang'` ; `error: 'ai_failed'` avec `detail: 'segments'` (tâche 1) → `'ai.errors.segments'` ; le type du paramètre `data` gagne `detail?: string`.
- Chaînes (fr) : `ai.errors.invalidLang` « Langue non proposée. » ; `ai.errors.segments` « Le fournisseur n'a pas rendu une traduction exploitable. Réessayez. »

- [ ] **Step 1: Write the failing tests** — `aiRouting`: `op: 'translate'` envoie `translationProvider: 3` quand `aiTranslationProvider: 3`, rien pour `summary`, rien pour `'3'` ; `aiErrorKey`: les deux clés.
- [ ] **Step 2–4:** échec, implémentation (10 locales), succès, parité.
- [ ] **Step 5: Commit** — `feat(ai): translation request, routing stage and error keys`.

---

### Task 6: Préférences — bloc « Traduction » et interrupteurs par flux et catégorie

**Files:**
- Create: `src/components/Preferences/ai/TranslationBlock.tsx`
- Modify: `src/components/Preferences/ai/RoutingBlock.tsx`, `src/components/Preferences/AiTab.tsx`, `src/components/Preferences/ai/SummariesBlock.tsx` (le texte d'aide du global dit « partout, sauf réglage par flux ou catégorie »), `src/locales/*.json`
- Test: `src/components/Preferences/AiTab.test.tsx`
- Docs: `docs/FEATURES.md` (« Interface — Préférences », « Par flux et catégorie »)

**Interfaces:**
- Consumes: tâche 2 (`AI_LANGUAGES`, `languageName`, `targetLanguage`), tâche 4 (préférences), `ProviderOptions`, `ToggleSwitch` (`describedBy`), `ConfirmDialog`.
- Produces `TranslationBlock()` (défaut, sans props), inséré **entre** `SummariesBlock` et `RoutingBlock` : `<select>` « Langue cible » (option `'ui'` « Langue de l'interface ({{name}}) », puis les 28 nommées par `languageName`, triées par nom) ; `<select>` « Fournisseur » (option `''` « Même que le résumé », puis `ProviderOptions`).
- `RoutingBlock` : chaque ligne (catégorie et flux) reçoit après le sélecteur deux `ToggleSwitch` « Résumer » et « Traduire » (libellés accessibles `ai.routing.autoSummaryFor` « Résumer automatiquement les articles de {{name}} », `ai.routing.autoTranslateFor` « Traduire automatiquement les articles de {{name}} ») ; la valeur affichée d'un flux est `autoFor(kind, …)` ; toucher écrit `true`/`false` pour un flux, `on` pour une catégorie ; « N flux réglés » compte fournisseur ou valeur propre ; à 320 px, les deux interrupteurs passent sous le sélecteur. Allumer « Traduire » quand `!aiAutoTranslateConfirmed` ouvre `ConfirmDialog` (titre `ai.routing.translateConfirmTitle` « Traduire automatiquement ? », message = texte des Global Constraints, bouton `ai.user.autoConfirm` « Activer ») ; confirmer écrit la valeur **et** `setAiAutoTranslateConfirmed(true)` ; annuler ne change rien. Allumer « Résumer » quand `!aiAutoSummary` et jamais confirmé (`aiAutoSummaryConfirmed`, tâche 4 ; la confirmation du global de `SummariesBlock` la pose aussi à vrai) ouvre la boîte existante de `SummariesBlock` (message `ai.user.autoConfirmMessage`).
- Chaînes (fr) : `ai.translation.title` « Traduction » ; `ai.translation.language` « Langue cible » ; `ai.translation.uiLanguage` « Langue de l'interface ({{name}}) » ; `ai.translation.provider` « Fournisseur » ; `ai.translation.sameAsSummary` « Même que le résumé » ; `ai.routing.autoSummary` « Résumer » ; `ai.routing.autoTranslate` « Traduire » ; `ai.routing.autoHint` « Résumer ou traduire à l'ouverture les articles de cette ligne. Un flux prime sur sa catégorie. » ; `ai.user.autoHint` devient « Chaque article ouvert est résumé sans clic, sauf réglage contraire par flux ou catégorie. »

- [ ] **Step 1: Write the failing tests**
```ts
it('the translation block offers the UI language first, then the 28 languages named in the UI language', ...);
it('a category translate switch asks for confirmation once, then not again', ...); // 1er : dialog, Activer → aiCategoryAutoTranslate {Tech:true}, confirmed true ; 2e catégorie : pas de dialog
it('cancelling leaves the switch off', ...);
it('a feed switch shows the inherited value and writes an explicit false when turned off', ...); // catégorie on → flux affiché on ; clic → feedSettings['feed/1'].aiAutoTranslate === false, affiché off
it('a feed summary switch opens the global confirmation when never confirmed', ...);
```
- [ ] **Step 2–4:** échec, implémentation, succès, parité, `npx eslint src/components/Preferences/ai/` muet.
- [ ] **Step 5: Commit** — `feat(ai): translation settings and per-feed automatic switches`.

---

### Task 7: Menu de traduction et traduction du résumé

**Files:**
- Create: `src/components/ReadingPane/TranslateMenu.tsx`, `src/components/ReadingPane/TranslateMenu.test.tsx`, `src/components/ReadingPane/Popover.tsx` (le `Popover` actuel de `AiSummary.tsx`, déplacé tel quel)
- Modify: `src/components/ReadingPane/AiSummary.tsx`, `src/components/ReadingPane/ReadingPane.tsx`, `src/locales/*.json`
- Test: `src/components/ReadingPane/AiSummary.test.tsx`, `src/components/ReadingPane/ReadingPane.ai.test.tsx`
- Docs: `docs/FEATURES.md` (« Interface — panneau »)

**Interfaces:**
- Produces `TranslateMenu({ open, anchor, touch, title, languages, providers, current, onPick, onClose }: { open: boolean; anchor: HTMLElement | null; touch: boolean; title: string; languages: AiLanguage[]; providers: AiProviderView[]; current: { lang: AiLanguage; providerId: number | null }; onPick: (choice: { lang?: AiLanguage; providerId?: number }) => void; onClose: () => void })` — deux sections « Traduire en… » (langue cible en tête, puis les autres par nom ; champ de filtre au-delà de 12, comme `ModelList`) et « Traduire avec… » (fournisseurs `available`) ; popover en portail (`Popover` de `AiSummary.tsx`, extrait dans `src/components/ReadingPane/Popover.tsx` pour être partagé) sur bureau, `BottomSheet` sur tactile ; `role="menu"` / `menuitem`, 44 pt.
- `AiSummaryProps` gagne : `translation: { status: 'idle' | 'loading' | 'done' | 'error'; text: string | null; lang: AiLanguage | null; providerName?: string; fellBackFrom?: string; error: string | null }`, `onTranslate: (choice?: { lang?: AiLanguage; providerId?: number }) => void`, `onShowSource: () => void`, `targetLang: AiLanguage`. L'action « Traduire » (bouton scindé : principal + chevron `aria-haspopup="menu"`) n'apparaît que si `done && !sameLanguage(result.lang, targetLang)` ; pendant `loading` elle est désactivée avec « Traduction… » ; `done` → le corps montre `translation.text`, le statut ajoute « traduit en {{lang}} par {{name}} » (+ « X indisponible »), l'action devient « Texte source ». Replié : rien ne se déplie.
- `ReadingPane` : état `aiTranslation`, remis à zéro au changement d'article ; `handleTranslateSummary(choice)` → `requestAiTranslation({ articleId, scope: 'summary', targetLang: choice?.lang ?? target, segments: [aiResult.text], provider: choice?.providerId, ...aiRouting(…, { op: 'translate' }) })` ; `same: true` → statut `idle` et une notice brève `ai.translation.alreadyTarget` « Déjà en {{lang}}. » ; erreurs par `aiErrorMessage` ; `target = aiTranslationLanguage === 'ui' ? targetLanguage(i18n.language) : aiTranslationLanguage`.
- Chaînes (fr) : `ai.translate` « Traduire » ; `ai.translating` « Traduction… » ; `ai.showSource` « Texte source » ; `ai.translatedBy` « traduit en {{lang}} par {{name}} » ; `ai.translateTo` « Traduire en… » ; `ai.translateWith` « Traduire avec… » ; `ai.translateMenu` « Options de traduction » (libellé du chevron) ; `ai.translation.alreadyTarget` « Déjà en {{lang}}. » ; `ai.translation.filter` « Filtrer les langues ».

- [ ] **Step 1: Write the failing tests** — `TranslateMenu.test.tsx` : la cible est première, les 27 autres suivent par nom, filtre présent, un clic rend `{ lang }`, un fournisseur `{ providerId }`, Escape ferme. `AiSummary.test.tsx` : « Traduire » absent si `result.lang` = cible ; présent sinon ; `loading` désactive ; `done` montre le texte traduit et « Texte source » ; replié reste replié. `ReadingPane.ai.test.tsx` : un clic « Traduire » envoie `scope: 'summary'`, `targetLang: 'fr'`, `segments: [texte]` ; `same` → notice, texte inchangé ; « Traduire en… » → `targetLang: 'de'` ; « Traduire avec… » → `provider: 2` et `fallback` du réglage.
- [ ] **Step 2–4:** échec, implémentation, succès, parité, eslint `react-refresh` muet (composants seuls dans les `.tsx`).
- [ ] **Step 5: Commit** — `feat(ai): translate the summary`.

---

### Task 8: Traduction de l'article

**Files:**
- Create: `src/components/ReadingPane/useArticleTranslation.ts`, `src/components/ReadingPane/useArticleTranslation.test.tsx`
- Modify: `src/components/ReadingPane/ReadingPane.tsx`, `src/locales/*.json`
- Test: `src/components/ReadingPane/ReadingPane.ai.test.tsx`
- Docs: `docs/FEATURES.md` (nouvelle puce « Traduction de l'article »), `SECURITY.md` (le texte de l'article part par lots ; même règle « quitte l'instance »)

**Interfaces:**
- Consumes: tâches 3, 5, 7 ; `sanitizeHtml` (`src/utils/sanitizeHtml`) ; `buildArticleBody` / `displayedHtml`.
- Produces `useArticleTranslation({ articleId, title, bodyHtml, targetLang, routing, enabled }): { state: 'idle' | 'loading' | 'done' | 'error' | 'same'; html: string | null; title: string | null; progress: { done: number; total: number } | null; partial: boolean; providerName?: string; fellBackFrom?: string; error: string | null; translate: (choice?: { lang?: AiLanguage; providerId?: number }) => void; showSource: () => void; showTranslation: () => void; showing: 'source' | 'translation' }` — `segmentArticle` + `batchSegments` ; lots **en série** depuis le client (le numéro de lot ne part pas au serveur : `progress` sert l'affichage) ; une erreur à un lot → `error`, rien de remplacé ; `same` sur le premier lot → `state: 'same'` ; la traduction est liée au hash de `bodyHtml` : quand il change, `state` revient à `idle` et `showing` à `'source'` ; les lots en vol sont ignorés (`stillCurrent`) ; aucun segment → `translate` désactivée (`canTranslate: false`, aide `ai.translation.nothing` « Rien à traduire dans cet article. »).
- `ReadingPane` : le corps affiché devient `showing === 'translation' ? translatedBody : body` (même `useMemo` d'identité stable, titre traduit affiché) ; dans la barre d'outils, après « Article complet », `BarBtn` « Traduire l'article » (`ai.translateArticle`) / « Texte source » (`ai.showSource`, actif accent) ; sur bureau un chevron accolé ouvre `TranslateMenu` ; sur tactile un appui long l'ouvre (`useLongPress` de `src/hooks/useLongPress.ts`, déjà utilisé par les menus de liste), et la feuille « … » (`readSettingsOpen`) gagne deux rangées « Traduire en… » et « Traduire avec… » qui ouvrent le même menu ; la **notice** au-dessus du corps (gabarit de l'avis d'extraction, `role="status"` ou `alert`) : « Lot {{n}} sur {{m}}… », « Traduit en {{lang}} par {{name}} », « , {{x}} indisponible », « Traduit en partie ({{n}} lots sur {{m}}) » pour la coupe à 200 Ko, « Déjà en {{lang}}. », erreurs. Hors ligne : bouton désactivé, traduction affichée conservée.
- Chaînes (fr) : `ai.translateArticle` « Traduire l'article » ; `ai.translation.batch` « Lot {{n}} sur {{m}}… » ; `ai.translation.done` « Traduit en {{lang}} par {{name}} » ; `ai.translation.partial` « Traduit en partie ({{n}} lots sur {{m}}) » ; `ai.translation.nothing` « Rien à traduire dans cet article. » ; `ai.translation.fellBack` « {{name}} indisponible » (réutiliser `ai.fellBack`).

- [ ] **Step 1: Write the failing tests** — `useArticleTranslation.test.tsx` (renderHook) : deux lots → deux requêtes en série avec `batch` 1 puis 2, `progress` suit, `html` rendu seulement après le dernier ; échec au lot 2 → `error`, `html` null ; `same` au lot 1 → `same` sans 2e requête ; changement de `bodyHtml` → `idle`, `showing: 'source'` ; aucun segment → `canTranslate false`. `ReadingPane.ai.test.tsx` : clic « Traduire l'article » → corps traduit affiché, bouton « Texte source », notice ; « Texte source » rebascule sans requête ; arrivée de l'extraction après traduction manuelle → source ; hors ligne → désactivé ; feuille « … » tactile montre « Traduire en… ».
- [ ] **Step 2–4:** échec, implémentation, succès, parité, eslint.
- [ ] **Step 5: Commit** — `feat(ai): translate the whole article`.

---

### Task 9: Déclencheurs automatiques par flux et catégorie

**Files:**
- Modify: `src/components/ReadingPane/ReadingPane.tsx`
- Test: `src/components/ReadingPane/ReadingPane.ai.test.tsx`
- Docs: `docs/FEATURES.md` (« Résumé automatique » relu ; nouvelle puce « Traduction automatique »)

**Interfaces:**
- Consumes: `autoFor` (tâche 4), `useArticleTranslation` (tâche 8), le déclencheur existant (`AUTO_SUMMARY_DELAY_MS`, `autoSummarisedId`, `settled`).
- Le déclencheur du résumé remplace la condition `aiAutoSummary` par `autoFor('summary', art.sourceId, subscriptions, prefs)`. Un second déclencheur, même forme (délai, `autoTranslatedId`, `settled`, en ligne, IA utilisable, une fois par visite), appelle `translation.translate()` quand `autoFor('translate', …)` ; `same` reste silencieux ; une erreur s'affiche dans la notice (une bascule payante doit se voir) sauf quand il n'y a aucun segment : rien ne part et rien ne s'affiche.

- [ ] **Step 1: Write the failing tests** (fake timers) — flux `aiAutoTranslate: true` → une requête `scope: 'article'` après 1 s, après l'extraction quand elle s'applique ; flux `false` sous catégorie allumée → aucune ; changement d'article avant 1 s → aucune pour le premier ; `same` → aucune notice d'erreur ; flux `aiAutoSummary: true` avec global off → résumé automatique ; flux `false` avec global on → aucun.
- [ ] **Step 2–4:** échec, implémentation, succès.
- [ ] **Step 5: Commit** — `feat(ai): automatic summary and translation per feed or category`.

---

### Task 10: Inventaire, sécurité, journal, raccourci

**Files:**
- Modify: `docs/FEATURES.md` (famille renommée **« Résumés et traductions par IA »**, relue en entier : chaque phrase devenue fausse corrigée ; routes ; variables d'environnement inchangées), `SECURITY.md`, `docs/RELEASE-NEXT.md` (entrée « Résumés par IA » devient « Résumés et traductions par IA »), `src/components/CommandPalette.tsx` (entrée « Traduire l'article (IA) » sous les mêmes conditions que le résumé), `src/stores/uiStore.ts` (raccourci `translate`, défaut `t`, dans `shortcutActions` et `shortcutGroups.reading`, masqué comme `summarize` quand l'IA est inutilisable), `src/hooks/useKeyboardNav.ts` (même garde que `summarize`), `src/locales/*.json` (`preferences.shortcuts.translate` « Traduire l'article (IA) »)
- Test: `src/stores/uiStore.test.ts`, `src/hooks/useKeyboardNav.summarize.test.tsx` (étendu), `src/lib/featuresDoc.test.ts` vert

- [ ] **Step 1: Write the failing tests** — `t` ignoré avec Meta/Ctrl/Alt/repeat et derrière un dialogue ; `frirss:ai-translate` dispatché sinon ; un `shortcuts` synchronisé sans `translate` garde `t` ; la palette propose l'entrée avec un article et l'IA utilisable.
- [ ] **Step 2–4:** échec, implémentation, succès, parité, `featuresDoc.test.ts`.
- [ ] **Step 5: Commit** — `feat(ai): translate shortcut, palette entry and inventory`.

---

### Task 11: Vérification de bout en bout (contrôleur)

- [ ] **Step 1:** gates, garde-fou, parité, balayage des attributs visibles (`title`, `aria-label`, `placeholder`, texte JSX) dans les fichiers touchés.
- [ ] **Step 2:** image de branche (`gh workflow run publish.yml --ref ai-summaries`), tirée sur le serveur de test ; redéploiement par le propriétaire.
- [ ] **Step 3:** sur l'instance de test, Oya au bureau et émulateur à **320 px** : traduction d'un résumé et d'un article anglais avec Ollama (vérifier images et liens intacts, « Texte source »), « Traduire en… » et « Traduire avec… », un flux marqué « Traduire » (notice, `same` sur un flux français), un forçage vers un fournisseur en panne qui replie avec la mention, les interrupteurs « Résumer » / « Traduire » dans « Par flux et catégorie » et leurs confirmations, le raccourci `t`. Ollama seulement : rien de payant sans accord.
- [ ] **Step 4:** revue de toute la branche par un relecteur neuf sur le modèle le plus capable ; une vague de corrections ; relecture ciblée.
- [ ] **Step 5:** **test complet de la fonction résumé** (demande du propriétaire) : rejouer la campagne du 2026-10-20 (`ai-test-campaign.md` du scratchpad : routage, repli, cache, raccourcis, auto, préférences, 320 px) sur l'image finale.
