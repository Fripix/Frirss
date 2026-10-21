# Retours IA, second tour (2026-10-22) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** répondre au second tour de retours du propriétaire (2026-10-22) : un bloc « Par flux et catégorie » vraiment lisible, un panneau « Résumé IA » qu'on peut cacher globalement et par flux ou catégorie, une mention de traduction discrète, et un repli à valider depuis l'article quand il n'a pas joué tout seul.

**Architecture :** quatre retouches du client (préférences, panneau, volet de lecture) et une petite extension du serveur (l'erreur nomme le fournisseur qui a échoué). La visibilité du panneau réutilise la résolution « flux > catégories > global » de `src/lib/aiAuto.ts`. Le repli manuel est un bouton dans l'alerte d'erreur qui relance la même demande en forçant le fournisseur suivant.

**Tech Stack :** TypeScript strict, React 18, zustand (préférences synchronisées), Tailwind utilitaires + variables CSS, vitest ; Express côté serveur.

**Spec :** `docs/superpowers/specs/2026-10-15-ai-summaries-design.md` (§6 repli, §10 Préférences, §11 panneau, §17 traduction) ; les décisions ci-dessous priment sur la spec là où elles la révisent.

## Décisions du propriétaire (2026-10-22)

1. **« Par flux et catégorie »** : une catégorie = une ligne pleine largeur, avec ses pastilles « Résumer » et « Traduire » ; la ligne se déplie sur ses flux, chacun avec ses pastilles et son fournisseur. Un nom trop long est coupé par « … », **jamais sur deux lignes**. Les pastilles sont expliquées, avec une mise en forme soignée.
2. Le bouton de la barre d'outils dit « Traduire » — **livré** (d6772d4).
3. Largeur du panneau des préférences : inchangée (`min(92vw, 680px)`) — répondu, rien à faire.
4. **Panneau « Résumé IA » désactivable** dans les préférences, avec activation par catégorie ou flux. Décision de ce plan : un interrupteur **« Panneau Résumé IA toujours visible »**, **allumé par défaut** (le panneau est le seul point d'entrée visible vers le résumé pour qui ne connaît pas la touche `s` ; le propriétaire avait accepté « seulement avec un résumé » par défaut — écart assumé, à retourner en un mot) ; éteint, le panneau n'apparaît **qu'avec un résumé, une demande ou une erreur** (touche `s`, palette, icône de barre) ; surcharge par catégorie puis par flux via une troisième pastille « Panneau ».
7. **« Traduit en français par X »** : plus de bandeau une fois la traduction affichée ; la mention descend dans la ligne de métadonnées de l'article, en petit. Le bandeau reste pour l'attente (« Lot 2 sur 3… »), « Déjà en {langue} », la traduction partielle et les erreurs.
8. **Repli à valider depuis l'article** : le repli automatique reste ce qu'il est (vraies pannes, réglage « Repli automatique ») ; **quand il n'a pas joué** — réponse inexploitable, refus du modèle, ou réglage éteint — l'alerte d'erreur propose **« Réessayer avec {fournisseur suivant} »**, pour le résumé comme pour la traduction (du résumé et de l'article). L'aide du réglage, dans les préférences, dit que ce cas se valide depuis l'article et n'est pas automatique.

## Global Constraints

- Chaînes d'interface dans **les 10 locales** (script Node, `JSON.stringify(obj, null, 2) + "\n"`), parité vérifiée (commande du `CLAUDE.md`).
- Trois formats, **320 px** de référence ; rien qui n'existe qu'au survol ; cibles tactiles 44 px.
- Réglages synchronisés : toute nouvelle clé passe par `jsonKeys` de `applyServerPrefs` (normalisée), par `forgetAiAccountChoices` si elle est un choix de compte (catégories, flux), et par `src/components/Preferences/settings-baseline.json` si elle est un réglage visible (lire le garde-fou `settingsCoverage.test.ts` avant d'y toucher : il ne doit **jamais** être réajusté pour cacher une disparition).
- Jamais d'appel IA payé sans clic, hormis les automatismes opt-in. « Réessayer avec X » est un clic.
- `docs/FEATURES.md` : prose des sections touchées **relue et corrigée** dans le même commit ; `docs/RELEASE-NEXT.md` : la fonctionnalité IA n'est pas publiée, décrire **l'état final**, jamais « avant / après ».
- Gates : `npm run typecheck && npm run lint && npx vitest run && npm run build`, garde-fou de fuite d'infra (sortie vide). Commits conventionnels, **sans** trailer `Co-Authored-By` ni mention d'assistant. Flakes connus sous charge : `server/test/api.test.ts`, `server/test/ai.test.ts` « ownKey » → relancer seuls.

## Review Focus

1. **Repli manuel sans fournisseur suivant disponible** (un seul fournisseur, ou tous ont déjà échoué) : pas de bouton, l'alerte reste telle quelle (tâche 2).
2. **Panneau caché + touche `s`** : le panneau apparaît avec la demande (`loading`) et reste visible tant qu'il y a un résumé ou une erreur ; changer d'article le fait disparaître à nouveau (tâche 3).
3. **Catégories mêlées** (un flux dans une catégorie « Panneau » allumée et une éteinte) : règle explicite, testée (tâche 3).
4. **Nom de flux très long à 320 px** : une ligne, « … », les pastilles restent alignées à droite (tâche 4, mesure au rendu).
5. **Traduction partielle ou avec repli** : la mention de métadonnées nomme le fournisseur ; le bandeau partiel reste (tâche 5).

---

### Task 1 : serveur — l'erreur nomme le fournisseur qui a échoué

**Files:**
- Modify: `server/ai/errors.ts` (`AiError.provider?: { id: number; name: string }`), `server/ai/attempt.ts` (`runWithFallback` pose `e.provider` sur le candidat fautif, avant chaque `throw` — y compris l'erreur finale `lastError`), `server/routes/ai.ts` (`sendAiError` : `provider` dans le corps des 502 et 422)
- Modify: `src/api/backend.ts` (type de l'erreur), `docs/FEATURES.md` (« Erreurs » de la section IA : le corps d'erreur)
- Test: `server/ai/attempt.test.ts`, `server/test/ai.test.ts`

**Interfaces:**
- Produces: corps d'erreur `{ error: 'ai_failed', kind, provider: { id, name }, … }` (502) et `{ error: 'ai_refused', provider }` (422). Jamais de clé ni de détail d'URL dedans. Absent quand aucun candidat n'a été appelé (`no_provider`, `ai_daily_cap`, `not_cached`).

- [ ] **Step 1 : tests rouges** — `attempt.test.ts` : « l'erreur finale porte le dernier fournisseur essayé » (deux candidats, les deux échouent → `provider.id` = le second) ; « sans repli, l'erreur porte le premier ». `server/test/ai.test.ts` : « 502 ai_failed porte provider { id, name } » ; « 422 ai_refused aussi ».
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vert** — `npx vitest run server`.
- [ ] **Step 5 : docs + commit** — `feat(ai): name the failing provider in error responses`.

---

### Task 2 : « Réessayer avec X » dans les alertes, et l'aide du repli

**Files:**
- Create: `src/lib/aiRetry.ts`, `src/lib/aiRetry.test.ts`
- Modify: `src/lib/aiErrorKey.ts` (`aiErrorMessage` rend aussi `providerId?: number` lu dans `data.provider.id`), `src/components/ReadingPane/AiSummary.tsx` (bouton dans l'alerte), `src/components/ReadingPane/ReadingPane.tsx` (`aiErrorProvider`, alerte de traduction d'article), `src/components/ReadingPane/useArticleTranslation.ts` (`errorProvider?: number` dans le snapshot et le retour), `src/locales/*.json` (`ai.retryWith`, `ai.user.fallbackHint`, `ai.user.fallbackManualHint`), `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`
- Test: `src/components/ReadingPane/AiSummary.test.tsx`, `ReadingPane.ai.test.tsx`, `useArticleTranslation.test.tsx`

**Interfaces:**
- Produces: `export function nextProvider(providers: AiProviderView[], failedId: number | undefined): AiProviderView | null` — le premier fournisseur `available` qui suit `failedId` dans l'ordre de la liste (l'ordre de l'admin), sinon le premier `available` différent de `failedId`, sinon `null` ; `failedId` inconnu → le premier `available`.
- `AiSummaryProps` gagne `errorProviderId?: number` (résumé) et `translation.errorProviderId?: number` ; l'alerte affiche, sous le message, un bouton discret (`quietBtn`-like, bordure `--danger`, 44 px au doigt) « Réessayer avec {{name}} » quand `nextProvider(providers, errorProviderId)` existe ; clic → `onSummarize(id)` pour une erreur de résumé, `onTranslate({ providerId: id })` pour une erreur de traduction du résumé. Dans le volet : l'alerte de traduction d'article gagne le même bouton → `tr.translate({ providerId: id })`.
- Chaînes (fr) : `ai.retryWith` = « Réessayer avec {{name}} » ; `ai.user.fallbackHint` = « Si votre fournisseur est en panne (injoignable, clé refusée, quota, délai), le suivant de la liste prend le relais et l'en-tête le dit. » ; `ai.user.fallbackManualHint` = « Une réponse inexploitable ou un refus ne bascule jamais tout seul : l'article propose alors « Réessayer avec… », à valider là. Réglage éteint, c'est aussi le cas pour toute panne. » — affichée sous le réglage, toujours.

- [ ] **Step 1 : tests rouges** — `aiRetry.test.ts` (ordre, indisponibles sautés, un seul fournisseur → `null`, `failedId` inconnu) ; `AiSummary.test.tsx` : « une erreur de résumé propose Réessayer avec Claude » (providers [Ollama id 1, Claude id 2 available], `errorProviderId: 1`) et « sans fournisseur suivant, pas de bouton » ; `ReadingPane.ai.test.tsx` : « le bouton relance /ai/summary avec provider 2 » ; `useArticleTranslation.test.tsx` : « une erreur garde le fournisseur fautif » (502 avec `provider.id`).
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** ; `SummariesBlock.tsx` affiche `fallbackManualHint` sous `fallbackHint`.
- [ ] **Step 4 : vert** — `npx vitest run src/lib src/components/ReadingPane src/components/Preferences` ; parité.
- [ ] **Step 5 : docs** — FEATURES : « Repli » (le bouton, ses cas, le fournisseur suivant = ordre de l'admin), le paragraphe des alertes du panneau et de la traduction d'article, l'aide du réglage ; RELEASE-NEXT : une clause dans l'entrée IA. Commit : `feat(ai): offer "Retry with <next provider>" when the fallback did not run`.

---

### Task 3 : panneau « Résumé IA » : visible toujours, ou seulement avec un résumé

**Files:**
- Modify: `src/stores/uiStore.ts` (`aiPanelAlways: boolean` défaut `true`, `setAiPanelAlways` ; `aiCategoryPanel: Record<string, boolean>` + `setAiCategoryPanel(name, v: boolean | null)` ; `FeedSetting.aiPanel?: boolean` + `setFeedAiPanel(feedId, v: boolean | '')` via `withFeedOverride` et `AI_FEED_KEYS` ; `jsonKeys` + normalisation ; `forgetAiAccountChoices` efface `aiCategoryPanel` et les `aiPanel` de flux ; `applyServerPrefs` force `aiPanelAlways` à `true` quand le serveur ne l'a pas, comme `aiAutoSummary` est forcé à `false`)
- Modify: `src/lib/aiAuto.ts` (`panelFor`), `src/components/ReadingPane/ReadingPane.tsx`, `src/components/Preferences/ai/SummariesBlock.tsx`, `src/components/Preferences/settings-baseline.json` (ajout des nouvelles clés i18n du réglage), `src/locales/*.json`, `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`
- Test: `src/lib/aiAuto.test.ts`, `src/stores/uiStore.test.ts` (ou le test de sync existant), `ReadingPane.ai.test.tsx`, `Preferences.ai.test.tsx`

**Interfaces:**
- Produces: `export function panelFor(sourceId: string | undefined, subscriptions: Subscription[], prefs: AiAutoPrefs & { aiCategoryPanel: Record<string, boolean>; aiPanelAlways: boolean }): boolean` — flux (booléen explicite) > catégories (**vrai dès qu'une catégorie du flux est explicitement vraie ; sinon faux dès qu'une est explicitement fausse**) > `aiPanelAlways`.
- `ReadingPane` : `const showAiPanel = aiUsable && (panelFor(…) || aiStatus !== 'idle' || aiResult !== null)` ; le composant `AiSummary` n'est rendu que si `showAiPanel`. Les gardes du raccourci `s`, de la palette et de l'icône de barre **ne dépendent pas** du panneau.
- Chaînes (fr) : `ai.user.panel` = « Panneau Résumé IA toujours visible » ; `ai.user.panelHint` = « Éteint, le panneau n'apparaît qu'avec un résumé : touche s, palette ou icône de la barre. Réglable par flux et catégorie plus bas. » ; `ai.routing.panel` = « Panneau » ; `ai.routing.panelFor` = « Panneau Résumé IA toujours visible pour {{name}} ».

- [ ] **Step 1 : tests rouges** — `aiAuto.test.ts` : flux explicite faux sous catégorie vraie → faux ; deux catégories vraie/fausse → vrai ; aucune valeur → `aiPanelAlways`. `ReadingPane.ai.test.tsx` : « panneau caché par réglage, `s` le fait apparaître avec la demande » ; « il disparaît sur l'article suivant ». `Preferences.ai.test.tsx` : l'interrupteur et son aide.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** (le bloc « Par flux et catégorie » ne rend pas encore la pastille : tâche 4).
- [ ] **Step 4 : vert** — `npx vitest run src` ; parité ; `settingsCoverage` vert sans retrait.
- [ ] **Step 5 : docs** — FEATURES : « Interface — panneau » (visibilité, résolution, ce qui le fait apparaître), « Réglages synchronisés » (les trois clés, l'oubli à la déconnexion), « Résumés » (le réglage) ; RELEASE-NEXT : état final. Commit : `feat(ai): show the summary panel always, or only with a summary, per feed and category`.

---

### Task 4 : « Par flux et catégorie » en accordéon à pastilles

**Files:**
- Modify: `src/components/Preferences/ai/RoutingBlock.tsx` (réécriture), `src/components/Preferences/ai/shared.tsx` si une pastille partagée y trouve sa place, `src/locales/*.json` (`ai.routing.legend` …), `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`
- Test: `src/components/Preferences/AiTab.test.tsx`

**Interfaces:**
- Consumes: `setAiCategoryPanel`, `setFeedAiPanel`, `panelFor`-like valeur effective (tâche 3) ; `autoFor`, `ProviderOptions`, `ToggleSwitch`, `AutoSummaryConfirm`, `ConfirmDialog` — inchangés.
- Produces: rien pour les autres tâches.

**Design (tranché ici) :**

```
Résumer et Traduire lancent l'action à l'ouverture de chaque article de la ligne ;
Panneau garde le panneau Résumé IA visible même sans résumé. Un flux prime sur sa catégorie.

▸ Dev & Open Source ············································ [Résumer ●] [Traduire ○] [Panneau ●]
▾ Sécurité ····················································· [Résumer ○] [Traduire ●] [Panneau ●]
      Fournisseur de la catégorie                                 [Par défaut              ▾]
      BleepingComputer                        [Par défaut ▾]      [Résumer ○] [Traduire ●] [Panneau ●]
      CERT-FR — Avis de sécurité du gouver…   [Ollama     ▾]      [Résumer ●] [Traduire ●] [Panneau ○]
```

- **Ligne de catégorie** : un bouton de dépli (chevron + nom en `font-semibold`, `truncate` sur une ligne, `title` = nom complet) qui prend toute la place libre (`flex-1 min-w-0`), puis le groupe de pastilles à droite (`flex-shrink-0`). « N flux réglés » reste, en petit sous le nom (dans le bouton, deux lignes internes, le nom tronqué).
- **Dépliée** : d'abord une ligne « Fournisseur de la catégorie » avec son `<select>` (pas pour « Sans catégorie »), puis ses flux, indentés (`pl-6`), chacun : nom (`truncate`, `title`), `<select>` fournisseur compact (`min-w-[7rem] max-w-[11rem]`), pastilles.
- **Pastille** (`Pill`, dans `shared.tsx`) : un `<label>` à contour 1 px `--panel-border`, rayon plein, 44 px de haut au doigt (`prefs-tap-btn`), 32 px à la souris, contenant le mot (`text-xs`) et le `ToggleSwitch` ; allumée, contour et mot en `--accent`. Nom accessible inchangé (« Résumer automatiquement les articles de X », …, « Panneau Résumé IA toujours visible pour X »), `describedBy` l'aide du bloc.
- **Légende** en tête du bloc (`ai.routing.legend`, remplace `ai.routing.autoHint`) : le texte du cadre ci-dessus, en `--list-summary`, `max-w-prose`.
- **Étroit (< 640 px)** : la ligne de catégorie garde nom + pastilles sur une ligne si trois pastilles tiennent (à 320 px : 3 × ~84 px = 252 px → non) ; donc en étroit les pastilles passent **sous** le nom, alignées à droite, et le nom garde sa ligne entière tronquée. Pour un flux : nom sur sa ligne, puis sélecteur + pastilles dessous, `flex-wrap`, pastilles à droite. Jamais de débordement horizontal.
- Les confirmations de coût (résumé, traduction) restent telles quelles ; « Panneau » n'en a pas.

- [ ] **Step 1 : tests rouges** (`AiTab.test.tsx`) — « chaque catégorie porte trois pastilles nommées » (`getByRole('switch', { name: 'Panneau Résumé IA toujours visible pour Actualités' })`) ; « le nom est tronqué sur une ligne » (`truncate` + `title`) ; « déplier montre le fournisseur de la catégorie puis les flux » ; « la pastille Panneau d'un flux écrit `feedSettings[id].aiPanel` » ; l'ancien test « un toucher sur la cellule bascule l'interrupteur une fois » adapté à la pastille.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vert** ; parité (clé `ai.routing.autoHint` retirée des 10 locales si plus utilisée) ; `npm run build`.
- [ ] **Step 5 : docs** — FEATURES « Interface — Par flux et catégorie » réécrite (accordéon, pastilles, légende, étroit) ; RELEASE-NEXT état final. Commit : `feat(ai): per-feed AI routing as an accordion with labelled pills`.

---

### Task 5 : la mention de traduction descend dans les métadonnées

**Files:**
- Modify: `src/components/ReadingPane/ReadingPane.tsx` (`trNotice` ; ligne de métadonnées), `src/locales/*.json` (`ai.translation.by` = « Traduit par {{name}} »), `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`
- Test: `src/components/ReadingPane/ReadingPane.ai.test.tsx`

**Interfaces:**
- Produces: `trNotice` ne vaut plus rien pour `state === 'done'` **sauf** si `tr.partialOf` (le bandeau partiel reste, avec « Traduit en {langue} par Y » dedans) ou `tr.fellBackFrom` (le bandeau « X indisponible » reste : une bascule doit se voir — décision du 2026-10-20). Sinon, la ligne de métadonnées (à côté du temps de lecture, même gabarit de puce que lui mais en `--reading-meta` sur `--list-active`, icône `TranslateIcon` 12 px) montre « Traduit par {{name}} » tant que `showTranslatedBody`. Sur les deux variantes de la ligne (bureau et compacte), et uniquement quand la traduction est affichée.

- [ ] **Step 1 : tests rouges** — « une traduction affichée met « Traduit par Ollama » dans les métadonnées et aucun bandeau » ; « une traduction partielle garde le bandeau » ; « une bascule garde le bandeau » ; « Texte source retire la mention ».
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vert** ; parité.
- [ ] **Step 5 : docs** — FEATURES « Notice » de la traduction d'article réécrite ; RELEASE-NEXT. Commit : `feat(ai): a discreet "Translated by" in the article metadata`.

---

## Auto-revue

- Couverture : 1 → tâche 4 ; 4 → tâches 3 et 4 ; 7 → tâche 5 ; 8 → tâches 1 et 2 ; 2, 3, 5, 6 → rien (livré ou répondu).
- Noms : `provider: { id, name }` (corps d'erreur) ; `errorProviderId` (props) ; `nextProvider` ; `aiPanelAlways`, `aiCategoryPanel`, `FeedSetting.aiPanel`, `panelFor` ; `ai.retryWith`, `ai.user.fallbackManualHint`, `ai.user.panel`, `ai.user.panelHint`, `ai.routing.panel`, `ai.routing.panelFor`, `ai.routing.legend`, `ai.translation.by`.
- Ordre : 1 → 2 (le corps d'erreur), 3 → 4 (les setters et `panelFor`), 5 indépendante. Fichiers partagés : `ReadingPane.tsx` (2, 3, 5), `AiSummary.tsx` (2), `FEATURES.md` (toutes) — séquentiel.
