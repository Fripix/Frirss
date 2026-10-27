# Cycle de dette technique — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** solder huit familles de défauts connus (synchro des préférences, 401, délais, recherche, marquages de plage, bandeau, gestes/clavier, ménage) sans régression, un morceau déployé et vérifié à la fois.

**Architecture :** logique pure extraite dans `src/lib/*.ts` testée d'abord (vitest), câblée ensuite dans les stores / hooks / composants existants. Côté serveur, une seule évolution : une échéance totale sur la route `/api/proxy`.

**Tech Stack :** TypeScript strict, React 18, Zustand, axios, Express 5, vitest + Testing Library (jsdom).

**Spec :** `docs/superpowers/specs/2026-10-28-tech-debt-cycle-design.md` — à lire avant chaque tâche ; ses « Choix (mien) » sont des exigences.

## Global Constraints

- Gates avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- Garde-fou avant chaque commit : `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'` → sortie vide.
- Commits : style conventionnel, en anglais, **aucun trailer `Co-Authored-By`**, aucune mention d'IA.
- Toute chaîne d'interface dans les 10 locales `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json` (édition par script Node, `JSON.stringify(obj,null,2)+"\n"`), pluriels `_one`/`_other` (+ `_few`/`_many` pl, uk).
- `docs/FEATURES.md` et `docs/RELEASE-NEXT.md` mis à jour **dans le commit** de chaque tâche ; une « limite documentée » qui disparaît voit sa prose réécrite, pas complétée.
- Aucune dépendance nouvelle ; aucun réglage nouveau dans le panneau des préférences (`settingsCoverage.test.ts` inchangé).
- Un garde-fou rouge (`featuresDoc`, `loginErrors` l.151-160, `i18nCoverage`, tests figeant `UI_SYNC_KEYS`, `extractContent`, `aiErrorKey`, `CORPUS_TTL_MS`, constantes de geste) est une question à poser, pas une baseline à réajuster.
- Toute surface flottante se rend par portail sous `<body>`.
- Après chaque tâche : push `dev`, `CI` **et** `Publish image` verts sur le SHA, `docker pull` de `:dev` sur le NAS, redéploiement de la stack `frirss-test` par l'API Dockhand, `/api/health` avec un `uptime` faible, puis la vérification réelle décrite dans la tâche (Oya = desktop, émulateur Android = tactile, 320 px pour les mises en page). Rédiger pour le propriétaire 2 à 4 tests ciblés desktop / iPhone.

## Review Focus

1. **Deux appareils ouverts en même temps** : une préférence changée sur A doit survivre à n'importe quelle action sur B resté ouvert, puis apparaître sur B à son retour au premier plan — test dans la tâche 1.
2. **Modification faite hors ligne puis app fermée** (PWA iOS tuée) : la valeur locale repart au démarrage suivant au lieu d'être écrasée par le serveur — test dans la tâche 1.
3. **Opération légitimement longue** (traduction d'un long article ~110 s, restauration d'une sauvegarde) : aucun délai client ne la coupe avant la réponse du serveur — test dans la tâche 3.
4. **Appui long avec le doigt qui tremble de quelques pixels** sur iOS : le menu s'ouvre quand même ; un vrai défilement l'annule — test dans la tâche 8.
5. **Entité HTML hors plage dans un article** (`&#99999999;`) : la recherche ne s'effondre pas — test dans la tâche 4.

---

### Task 1 : Synchronisation des préférences par clés modifiées + relecture au premier plan

**Files :**
- Create : `src/lib/prefsDiff.ts`, `src/lib/prefsDiff.test.ts`
- Modify : `src/lib/prefsSync.ts`, `src/App.tsx:247-266` et `:332-341`, `src/stores/uiStore.ts` (`applyServerPrefs`, l.1059-1207), `src/stores/themeStore.ts` (`applyServerPrefs`, l.1189-1240), `server/routes/preferences.ts` (refus par clé)
- Test : `src/lib/prefsSync.test.ts`, `src/stores/uiStore.test.ts`, `server/test/api.test.ts` (bloc « preferences — bornes »)

**Interfaces :**
- Produces (`src/lib/prefsDiff.ts`) :
  - `type PrefsSnapshot = Record<string, unknown>`
  - `function changedKeys(local: PrefsSnapshot, known: PrefsSnapshot): string[]` — clés dont la valeur diffère (comparaison par sérialisation JSON stable).
  - `function pickKeys(snapshot: PrefsSnapshot, keys: readonly string[]): PrefsSnapshot`
  - `function mergeForRelecture(server: PrefsSnapshot, dirty: ReadonlySet<string>): PrefsSnapshot` — ne garde que les clés présentes côté serveur et **non** sales.
- Produces (`src/lib/prefsSync.ts`) : `export async function refreshPrefs(): Promise<void>` (relecture au premier plan) ; `hydratePrefs()` et `stopSync()` gardent leur signature.
- Persistance : `localStorage['frirss_prefsKnown']` (dernière valeur connue du serveur, `PrefsSnapshot`) et `localStorage['frirss_prefsDirty']` (`string[]`). Effacés par `stopSync()` (déconnexion).
- `applyServerPrefs(prefs, opts?: { onlyPresent?: boolean })` dans les deux stores : avec `onlyPresent: true`, aucune valeur par défaut n'est forcée pour une clé absente (`uiStore.ts:1074-1134` ne s'applique qu'au démarrage).

- Produces (serveur) : un refus propre à une clé (`key_too_long`, `unserializable_value`, `value_too_large`) répond `400 { error, code, key }` — champ `key` ajouté, rien d'autre ne change.

- [ ] **Step 0 : test serveur** — `PUT /api/preferences` avec une valeur de plus de `MAX_VALUE_BYTES` sur `appLogo` → 400 avec `key: 'appLogo'` ; FAIL, puis ajouter `key` dans `server/routes/preferences.ts` (`serializeEntry` renvoie la clé fautive), PASS.
- [ ] **Step 1 : tests purs de `prefsDiff`** — `changedKeys({a:1,b:{x:1}},{a:1,b:{x:2}})` → `['b']` ; ordre des clés d'objet sans effet (`{x:1,y:2}` vs `{y:2,x:1}` → `[]`) ; clé absente de `known` → sale. `mergeForRelecture({a:1,b:2},new Set(['b']))` → `{a:1}`.
- [ ] **Step 2 : lancer** `npx vitest run src/lib/prefsDiff.test.ts` → FAIL (module absent).
- [ ] **Step 3 : implémenter `prefsDiff.ts`.**
- [ ] **Step 4 : tests de `prefsSync`** (faux minuteurs, `getPreferences`/`savePreferences` moqués) :
  - `only changed keys are pushed` : après hydratation, changer `aiPanelCollapsed` → `savePreferences` reçoit exactement `{ aiPanelCollapsed: true }`.
  - `a stale device never overwrites another device's key` : hydraté avec `aiPanelCollapsed:false`, le serveur passe à `true` ailleurs, ce client change `collapsedCategories` → l'envoi ne contient pas `aiPanelCollapsed`.
  - `refreshPrefs applies server changes but never a dirty key` : clé `viewMode` sale localement, serveur différent sur `viewMode` et `showFavicons` → seul `showFavicons` change.
  - `refreshPrefs flushes a pending push first` : changement local puis `refreshPrefs()` avant 800 ms → l'envoi part avant la lecture, la valeur locale survit.
  - `dirty keys survive a reload` : envoi en échec (réseau), nouveau `hydratePrefs()` (simuler un rechargement : réinitialiser le module) → la valeur locale l'emporte et repart.
  - `a refused key leaves the batch` : `savePreferences` rejette en 400 `value_too_large` pour `appLogo` → `appLogo` reprend la valeur connue, les autres clés sales repartent et réussissent.
  - `retries on online and visibility` : envoi en échec, événement `online` → nouvel envoi.
  - `articleOrder changed by refreshPrefs reloads the list` : `loadArticles` appelé une fois.
- [ ] **Step 5 : lancer** `npx vitest run src/lib/prefsSync.test.ts` → FAIL sur ces cas.
- [ ] **Step 6 : implémenter** dans `prefsSync.ts` : suivi `known`/`dirty` persistés ; `schedulePush` n'envoie que `pickKeys(collectPrefs(), changedKeys(...))` ; un 400 dont le corps porte `key` (Step 0) la retire et restaure `known[k]` dans le store ; sinon les clés restent sales, nouvel essai sur `online`, au premier plan et par attente croissante (5 s → 60 s, comme la lecture). Au démarrage, `hydratePrefs` applique `server` puis réapplique les clés sales locales et les renvoie. `refreshPrefs` : vider l'envoi en attente, `getPreferences()`, `applyServerPrefs(mergeForRelecture(server, dirty), { onlyPresent: true })` sous la garde `hydrating`, mettre à jour `known`, recharger la liste si `articleOrder` ou `feedSettings[*].order` a changé ; `aiStore.load()` seulement si une clé `ai*` a changé.
- [ ] **Step 7 : câbler** `refreshPrefs()` dans le gestionnaire `visibilitychange` existant d'`App.tsx:332-341` (état `visible`, session présente).
- [ ] **Step 8 : lancer** `npx vitest run src/lib src/stores` → PASS (dont les tests figeant `UI_SYNC_KEYS`, inchangés).
- [ ] **Step 9 : docs** — réécrire `FEATURES.md:1288-1300` et `:5006-5021` (la « limite du modèle instantané complet » disparaît ; décrire clés modifiées, persistance, relecture, clé refusée) ; entrée dans `RELEASE-NEXT.md` (Corrections).
- [ ] **Step 10 : gates, garde-fou, commit** `fix(prefs): sync only changed keys and re-read the server on return to foreground`.
- [ ] **Step 11 : déployer et vérifier** — rejouer le scénario du 2026-10-27 : Android replie le panneau IA ; Oya, resté ouvert, replie une catégorie ; lire la base (`aiPanelCollapsed` doit rester `true`) ; Oya revient au premier plan → panneau replié sans rechargement. Remettre le compte de test dans son état.

### Task 2 : Déconnexion seulement sur une session FriRSS invalide

**Files :**
- Modify : `src/api/backend.ts:29-37`, `src/App.tsx:177-182`
- Create : `src/api/backend.test.ts`
- Test : `src/lib/loginErrors.test.ts` (inchangé si les messages du middleware ne changent pas)

**Interfaces :**
- Consumes : `isBackendAuthFailure(err: unknown): boolean` (`src/lib/loginErrors.ts`).
- Produces : rien de nouveau ; `getMe()` inchangé.

- [ ] **Step 1 : tests** `backend.test.ts` (adaptateur axios moqué) : un 401 `{error:'Session expired'}` → `logoutBackend` appelé ; un 401 `{error:'Current password is incorrect'}` → pas appelé ; un 401 `{error:'Invalid credentials'}` → pas appelé ; un 500 → pas appelé.
- [ ] **Step 2 : lancer** → FAIL sur les deux cas « pas appelé ».
- [ ] **Step 3 : implémenter** : l'intercepteur de `backend.ts` filtre par `isBackendAuthFailure` (même critère que `client.ts:48-56`), avec le commentaire de `client.ts` en écho.
- [ ] **Step 4 : test du retour OIDC** (extraire la logique de `App.tsx:177-182` dans `src/lib/oidcReturn.ts` : `async function completeOidcReturn(token: string, deps: { getMe, setAuth, logout, wait }): Promise<void>`) : erreur réseau ×2 puis succès → `setAuth(token, user)`, jamais `logout` ; 401 de session → `logout` ; erreurs réseau répétées au-delà de 4 essais (attente 1 s, 2 s, 4 s, 8 s) → `logout` et message d'erreur à l'écran de connexion (clé i18n existante `login.errorUnavailable`).
- [ ] **Step 5 : implémenter `oidcReturn.ts`, l'appeler depuis `App.tsx`** ; tests PASS.
- [ ] **Step 6 : docs** (`FEATURES.md:54-59,155-175` : le 401 n'éjecte plus que sur nos messages, des deux clients) ; `RELEASE-NEXT.md` ; gates ; commit `fix(auth): only a FriRSS session failure signs the user out`.
- [ ] **Step 7 : déployer et vérifier** dans Oya : session normale intacte après navigation ; console sans erreur.

### Task 3 : Échéance totale du proxy et délais client

**Files :**
- Create : `src/lib/requestTimeouts.ts`, `src/lib/requestTimeouts.test.ts`
- Modify : `server/routes/proxy.ts` (route `router.all('/')`, l.~560-640, et `finishError`), `src/api/backend.ts:14-17`, `src/api/client.ts:5`, appels IA et sauvegarde dans `src/api/backend.ts:277-320`
- Test : `server/test/proxyLookup.test.ts` ou nouveau `server/test/proxyDeadline.test.ts`, `src/lib/aiErrorKey.test.ts` (doit rester vert)

**Interfaces :**
- Produces (serveur) : `export const PROXY_TOTAL_TIMEOUT_MS = 60_000` dans `proxy.ts` ; la route passe un `AbortSignal` à `fetchUpstream` qui couvre en-têtes, corps, tous les sauts et le repli ; à l'échéance avant les en-têtes → `504 { error: 'Upstream timeout' }` (forme existante de `finishError`).
- Produces (client, `requestTimeouts.ts`) : `export const TIMEOUT_DEFAULT_MS = 75_000`, `TIMEOUT_AI_MS = 150_000`, `TIMEOUT_BACKUP_MS = 150_000`. Règle commentée : chaque valeur dépasse le budget serveur correspondant (proxy 60 s, nginx 120 s).
- Extraction (`src/utils/extractContent.ts`) : inchangée.

- [ ] **Step 1 : test serveur** `proxyDeadline.test.ts` : amont qui envoie les en-têtes puis bloque le corps → la réponse se termine avant `PROXY_TOTAL_TIMEOUT_MS` + 1 s (faux minuteurs ou échéance injectée par option de test) ; amont qui ne répond pas → 504 `Upstream timeout`.
- [ ] **Step 2 : lancer** → FAIL (le corps n'est pas borné).
- [ ] **Step 3 : implémenter** l'échéance dans la route (un `AbortController` par requête, `setTimeout(PROXY_TOTAL_TIMEOUT_MS)`, signal passé à `fetchUpstream`, minuteur nettoyé en fin de flux ou de réponse).
- [ ] **Step 4 : test client** `requestTimeouts.test.ts` : `TIMEOUT_DEFAULT_MS > PROXY_TOTAL_TIMEOUT_MS` (importé via une constante dupliquée documentée, ou lu du fichier serveur comme le fait `loginErrors.test.ts`), `TIMEOUT_AI_MS > 120_000`, `TIMEOUT_BACKUP_MS > 120_000`.
- [ ] **Step 5 : appliquer** `timeout: TIMEOUT_DEFAULT_MS` aux deux instances axios, `TIMEOUT_AI_MS` aux appels `/ai/*` (résumé, traduction, test, modèles), `TIMEOUT_BACKUP_MS` à `createBackup`/`previewRestore`/`applyRestore`.
- [ ] **Step 6 : vérifier** que `src/lib/aiErrorKey.test.ts` et `src/utils/extractContent.test.ts` passent sans modification ; qu'un abandon client (`ECONNABORTED`) n'est jamais lu comme 401 ni ne déconnecte.
- [ ] **Step 7 : docs** (`FEATURES.md` : section proxy et section délais IA `:2088-2100`, nouvelle échéance totale) ; `RELEASE-NEXT.md` ; gates ; commit `fix: bound every request — total proxy deadline, client timeouts above it`.
- [ ] **Step 8 : déployer et vérifier** : Oya, traduction d'un article long (Ars Technica) jusqu'au bout ; liste, lu/favori en 200 ; journaux serveur sans 504 inattendu.

### Task 4 : Recherche

**Files :**
- Modify : `src/lib/searchMatch.ts` (`stripHtml`), `src/lib/searchCorpus.ts` (`addPage`, `corpusMatches`), `src/stores/feedStore.ts` (`patchSearchCorpus` l.109, `showMoreSearchResults` l.1609, `toggleArticleLabel` l.2023-2066, `markAllAsRead` l.1700-1707, `silentRefresh` l.2307, `refresh`/`loadArticles` l.1189-1213, `runScan` l.2693, commentaire l.2569), `src/stores/authStore.ts` (déconnexion)
- Test : `src/lib/searchMatch.test.ts`, `src/lib/searchCorpus.test.ts`, `src/stores/feedStore.search*.test.ts`

**Interfaces :**
- Produces : `function matchPage(page: readonly Article[], terms: readonly string[]): Article[]` dans `searchCorpus.ts` (correspondances d'une seule tranche) ; `addPage` garde sa signature mais tient un index d'identifiants incrémental (pas de `Set` reconstruit) ; `dropSearchCorpus()` exporté pour la déconnexion.
- `patchSearchCorpus(id, patch)` patche **aussi** `searchResults` dans l'état (point unique).

- [ ] **Step 1 : tests `stripHtml`** : `&eacute;`→`é`, `&rsquo;`→`’`, `&hellip;`→`…`, `&#99999999;` ne lève pas (remplacé par U+FFFD ou supprimé), contenu de `<script>`/`<style>` absent du texte. Mesurer sur 10 000 articles synthétiques (test de performance non bloquant, consigné dans le commit) avant de choisir entre table d'entités et `DOMParser`.
- [ ] **Step 2 : tests corpus** : `matchPage` sur une tranche ; `addPage` × 10 tranches ne reconstruit pas l'index (espionner `Set` ou mesurer le nombre d'itérations).
- [ ] **Step 3 : tests store** :
  - `a check in search results survives the next slice` (lu puis `showMoreSearchResults`).
  - `a label toggled during a search is in the corpus`.
  - `mark all read during a search reloads the bare view` (`loadArticles` appelé, `continuation` restaurée).
  - `refresh during a search adds newer matching articles and stops spinning` : le corpus reçoit seulement les entrées plus récentes que la plus récente qu'il contient ; `loading`/`revalidating` retombent à faux.
  - `logout drops the corpus`.
- [ ] **Step 4 : lancer** → FAIL.
- [ ] **Step 5 : implémenter** chaque point ; `runScan` accumule les correspondances par `matchPage`.
- [ ] **Step 6 : PASS** ; `docs/FEATURES.md:1591-1597,1717-1720` (corpus libéré à la déconnexion) ; `RELEASE-NEXT.md` ; gates ; commit `fix(search): live results, labels, entities, refresh and memory`.
- [ ] **Step 7 : déployer et vérifier** dans Oya : recherche (clic sur la loupe, saisie, puis bouton « Rechercher » — Oya ne soumet pas par Entrée), cocher lu dans les résultats puis « Afficher plus », Rafraîchir pendant la recherche, « Tout lu » pendant la recherche.

### Task 5 : Marquages « au-dessus / en dessous »

**Files :**
- Modify : `src/stores/feedStore.ts` (`markReadRelative` l.1759-1908)
- Test : `src/stores/feedStore.markRange.test.ts`

**Interfaces :**
- Consumes : `bulkWork` existant (`{ done: number; total: number | null } | null`), lu par `TopProgressBar`.
- Produces : une file module `let rangeQueue: Promise<void>` ; chaque `markReadRelative` s'y chaîne.

- [ ] **Step 1 : tests** : `a range mark shows progress` (`bulkWork` non nul pendant, nul après, `done` croissant par lot de 100) ; `two overlapping range marks run one after the other` ; `a failed first mark does not revert rows the second marked` ; `the corpus is never left optimistic after two marks`.
- [ ] **Step 2 : FAIL**, **Step 3 : implémenter**, **Step 4 : PASS.**
- [ ] **Step 5 : docs** : réécrire `FEATURES.md:1169-1178` et `:1204-1206` ; `RELEASE-NEXT.md` ; gates ; commit `fix(mark-range): show progress and run overlapping marks in turn`.
- [ ] **Step 6 : déployer et vérifier** sur Android (menu d'article → « Tout lu au-dessus ») : barre de progression visible ; deux marquages enchaînés vite.

### Task 6 : Bandeau des nouveaux articles

**Files :**
- Modify : `src/stores/feedStore.ts` (`loadSubscriptions` l.957-968), `src/lib/refreshDelta.ts`, `src/components/ArticleList/ArticleList.tsx:1081` (séparateur), `src/styles/index.css:2429-2454`
- Test : `src/lib/refreshDelta.test.ts`, `src/stores/feedStore.test.ts`, `src/components/ArticleList/NewArticlesBanner.test.tsx`

**Interfaces :**
- Produces : `computeRefreshDelta(before, after, opts?: { ignoreUnknownFeeds?: boolean })` — avec l'option, un flux absent de `before` ne compte pas.
- Produces : variable CSS `--new-articles-offset` posée sur le conteneur défilant quand le bandeau est affiché (0 sinon) ; le séparateur de date utilise `top: var(--new-articles-offset, 0)`.

- [ ] **Step 1 : tests** : `loadSubscriptions after a rename keeps arrivals of the last minute` ; `adding a feed with 30 unread does not announce 30 new articles` ; `refresh() does not count arrivals twice` ; `the date separator sits below the banner while it shows` (style calculé ou classe).
- [ ] **Step 2 : FAIL**, **Step 3 : implémenter**, **Step 4 : PASS.**
- [ ] **Step 5 : docs** : réécrire `FEATURES.md:1369-1381` ; `RELEASE-NEXT.md` ; gates ; commit `fix(new-articles): keep arrivals across reloads, banner no longer covers the date`.
- [ ] **Step 6 : déployer et vérifier** : séparateurs de date activés le temps du test sur le compte de test (puis remis), bandeau affiché, mesure `getBoundingClientRect()` du séparateur sous le bandeau à 320 px (émulateur) et en desktop (Oya), en liste et en grille.

### Task 7 : Raccourcis coupés sous une surface flottante

**Files :**
- Modify : `src/hooks/useKeyboardNav.ts:26-45`, `src/components/ArticleContextMenu.tsx`, `src/components/Sidebar/Sidebar.tsx` (`FeedContextMenu`, l.819+), `SavedCategoryPicker` (dans `ArticleActions.tsx`), `Popover`
- Test : `src/hooks/useKeyboardNav.test.tsx`

**Interfaces :**
- Produces : attribut `data-floating-surface` sur la racine du portail de chaque surface flottante ; la garde : `if (document.querySelector('[data-floating-surface]')) return;` (Échap reste géré par la surface elle-même).

- [ ] **Step 1 : tests** : pour chacune des quatre surfaces ouverte (sans focus dedans), `j`, `s`, `t` n'agissent pas ; surface fermée → ils agissent.
- [ ] **Step 2 : FAIL**, **Step 3 : implémenter**, **Step 4 : PASS.**
- [ ] **Step 5 : docs**, gates, commit `fix(shortcuts): no shortcut acts behind an open menu`.
- [ ] **Step 6 : déployer et vérifier** dans Oya : clic droit sur un article (menu ouvert), touche `j` → l'article ne change pas.

### Task 8 : Appui long unifié + exclusion appui long / balayage

**Files :**
- Modify : `src/hooks/useLongPress.ts`, `src/hooks/useArticleMenuGestures.ts`, `src/components/ArticleList/ArticleActions.tsx` (`useFileGesture` → supprimé), `src/components/Sidebar/Sidebar.tsx:1093-1140` (`FeedItem`), `src/components/ReadingPane/ReadingPane.tsx:2263-2282` (`ActionBtn`), `src/components/ArticleList/SwipeableArticleRow.tsx:48-101`
- Create : `src/components/ArticleList/SwipeableArticleRow.test.tsx`
- Test : `useLongPress.test.tsx`, `FeedItem.longpress.test.tsx`, `useArticleMenuGestures.test.tsx`, `ArticleRow.menu.test.tsx`, `ArticleCard.menu.test.tsx`, `ReadingPane.ai.test.tsx`

**Interfaces :**
- Produces : `export const LONG_PRESS_MOVE_TOLERANCE_PX = 8` (égal au seuil de décision de direction du balayage, `SwipeableArticleRow.tsx:3`, qui l'importe pour qu'ils ne divergent jamais).
- Produces : `useLongPress(onLongPress: (point: PressPoint) => void, opts?: { mouse?: boolean; enabled?: boolean })` → `{ onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClickCapture, onMouseDown?, onMouseUp?, onMouseLeave?, firedRecently, reset, cancel }`. `onTouchMove` n'annule qu'au-delà de la tolérance ; `mouse` arme le bouton principal seulement ; minuteur nettoyé au démontage ; `firedRecently()` sert aux appelants à absorber le `contextmenu` d'écho (`if (lp.firedRecently()) { e.preventDefault(); return; }`).
- Produces : `SwipeableArticleRow` reçoit `onSwipeDecided?: () => void` (appelé quand la direction est décidée → l'appelant fait `lp.cancel()`) et `swipeBlocked?: () => boolean` (vrai quand `lp.firedRecently()` → aucun déclenchement de balayage).

- [ ] **Step 1 : tests du hook** : tremblement de 5 px → déclenche ; 12 px → annule ; `touchcancel` → annule ; second doigt → annule ; démontage → minuteur nettoyé ; `mouse:true` → bouton principal arme, bouton droit non ; clic d'écho avalé dans la fenêtre, laissé passer après.
- [ ] **Step 2 : tests du balayage** (`SwipeableArticleRow.test.tsx`) : appui long abouti puis glisser horizontal de 100 px → ni `toggleRead` ni `toggleReadLater` ; direction décidée à 9 px avant 500 ms → `onSwipeDecided` appelé, aucun menu.
- [ ] **Step 3 : test `FeedItem`** : `contextmenu` d'écho juste après l'appui long → le menu ne s'ouvre pas une seconde fois ni ne se repositionne.
- [ ] **Step 4 : FAIL.**
- [ ] **Step 5 : implémenter le hook**, puis migrer un appelant à la fois (`useArticleMenuGestures`, `FeedItem`, `useFileGesture` → `useLongPress(..., { mouse: true })`, `ActionBtn` idem), en lançant les tests de l'appelant à chaque migration. Durée inchangée : `LONG_PRESS_MS = 500` ; `FEED_LONG_PRESS_MS` supprimé au profit de `LONG_PRESS_MS` (adapter ses 7 références de test, justifié dans le commit).
- [ ] **Step 6 : PASS sur tous les tests listés.**
- [ ] **Step 7 : docs** (`FEATURES.md` : section gestes ; retirer le commentaire « Les unifier est au backlog ») ; `RELEASE-NEXT.md` ; gates ; commit `refactor(gestures): one long-press implementation with movement tolerance; long press and swipe exclude each other`.
- [ ] **Step 8 : déployer et vérifier sur l'émulateur Android** : appui long sur une ligne (menu), sur un flux (menu), sur l'étoile de la liste (sélecteur de catégorie), sur l'étoile du volet de lecture ; appui long puis glisser (rien) ; défilement de la liste (aucun menu) ; balayage court (action). Rédiger pour le propriétaire les mêmes tests sur iPhone, c'est l'appareil qui compte.

### Task 9 : Clic molette sur le titre

**Files :**
- Modify : `src/components/ArticleList/ArticleList.tsx` (titre d'`ArticleRow`), `src/components/ArticleList/ArticleCard.tsx` (titre), `src/hooks/useArticleMenuGestures.ts:84-94`
- Create : `src/lib/safeHref.ts`, `src/lib/safeHref.test.ts`
- Test : `ArticleRow.menu.test.tsx`, `ArticleCard.test.tsx`

**Interfaces :**
- Produces : `function safeHref(url: string | undefined): string | undefined` — l'URL seulement si son schéma est `http:` ou `https:`.
- Le titre devient `<a href={safeHref(article.link)} target="_blank" rel="noopener noreferrer">` ; son `onClick` (bouton gauche sans modificateur) fait `preventDefault()` et garde la sélection actuelle ; clic molette et ⌘/Ctrl-clic sont natifs (arrière-plan) et conservent le marquage lu d'aujourd'hui (via `onAuxClick` / `onClick` avec modificateur). `useArticleMenuGestures` ne gère plus le clic molette quand il vise le titre (déjà exclu par `fromInteractive` pour un `<a>`).

- [ ] **Step 1 : tests** : `safeHref('javascript:alert(1)')` → `undefined` ; titre = lien avec `href` ; clic gauche → sélection, pas de navigation (`defaultPrevented`) ; `auxclick` bouton 1 sur le titre → pas de `window.open`, article marqué lu ; clic molette ailleurs sur la ligne → comportement d'aujourd'hui.
- [ ] **Step 2 : FAIL**, **Step 3 : implémenter**, **Step 4 : PASS.**
- [ ] **Step 5 : docs** (réécrire `FEATURES.md:1095-1097` et `:989-993`) ; `RELEASE-NEXT.md` ; gates ; commit `fix(list): middle-click on a title opens the article in a background tab`.
- [ ] **Step 6 : vérifier** : style du titre inchangé (couleur, soulignement absent, ellipse) dans Oya, en liste et en grille ; test desktop rendu au propriétaire (clic molette sur un titre dans Chrome et Safari → onglet en arrière-plan).

### Task 10 : Ménage `selectFeed`

**Files :**
- Modify : `src/stores/feedStore.ts:564,819-824` (suppression), commentaires `feedStore.ts:332,706`, `src/lib/rollbackRow.ts:9`, `docs/FEATURES.md:738,1599`
- Test : `src/stores/feedStore.test.ts:1150-1183,1549-1551,1839`, `feedStore.searchClose.test.ts:60-66,115` → migrés vers `selectView`

- [ ] **Step 1 : migrer les tests vers `selectView`** et les lancer → PASS avec `selectFeed` encore présent.
- [ ] **Step 2 : supprimer `selectFeed`**, `npm run typecheck` → aucun appelant restant.
- [ ] **Step 3 : gates** ; commit `chore: drop the unused selectFeed`.

### Clôture du cycle

- [ ] Relectures à l'œil neuf en parallèle (diff du cycle, `server/` depuis `v1.7.0`, côté lecture, `RELEASE-NEXT.md` contre `git log`), chaque constat avec un test qui échoue avant son correctif, correctifs relus.
- [ ] Revenir au propriétaire avec le bilan et ses tests iPhone ; puis l'issue #26 (conception à part).
