# Retours IA du 2026-10-21 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** répondre aux sept retours du propriétaire après ses premiers essais de l'IA sur `frirss-test` (captures du 2026-10-21) : Préférences › IA lisibles, panneau « Résumé IA » discret tant qu'il n'a rien à montrer, « Traduire » toujours à portée dans ce panneau, une traduction d'article qui survit à un aller-retour sur l'article, et un message utile quand un fournisseur rend une traduction inexploitable.

**Architecture :** retouches de composants existants (`Preferences/ai/*`, `ReadingPane/AiSummary.tsx`, `ReadingPane/useArticleTranslation.ts`) ; une seule nouveauté transversale, la **mémoire par appareil** d'une traduction affichée : un module pur `src/lib/aiShownTranslations.ts` (localStorage) et un drapeau `cacheOnly` sur `POST /api/ai/translate` qui ne lit que le cache serveur et ne déclenche **jamais** un appel au fournisseur — la garantie « aucun appel payé sans clic » reste côté serveur.

**Tech Stack :** TypeScript strict, React 18, zustand, Tailwind utilitaires + variables CSS, vitest ; Express côté serveur.

**Spec :** `docs/superpowers/specs/2026-10-15-ai-summaries-design.md` (§10 Préférences, §11 panneau, §17 traduction). Les décisions de ce tour viennent de la conversation du 2026-10-21 (réponses du propriétaire aux sept points) et sont reprises ci-dessous : en cas de conflit avec la spec, **ce plan prime** sur les points qu'il tranche.

## Décisions du propriétaire (2026-10-21)

1. Préférences › IA : **« Fournisseurs » en tête pour l'admin**, le repli « Avancé » disparaît (ses deux réglages deviennent des lignes ordinaires), « Par flux et catégorie » devient une **grille alignée**.
2. Le caractère « � » dans un article Developpez : le flux en ligne est propre, le propriétaire vérifie dans FreshRSS — **rien dans ce plan**.
3. Panneau « Résumé IA » : **affiché mais replié** tant qu'il n'y a pas de résumé — plus de corps « Cliquez sur « Résumer »… ». Pas de bouton de barre d'outils.
4. Traduction avec Ollama : cause racine trouvée et corrigée à part (balises `<s>`/`</s>` = fin de séquence des tokenizers Llama/Qwen ; commit « segment delimiters that no tokenizer treats as end of sequence »). Reste ici : un **message d'erreur qui dit quoi faire**. La vérification par mots-outils et le bouton « Réessayer avec X » proposés avant le diagnostic sont **abandonnés** (règle du plan, pas du propriétaire : ils palliaient un symptôme dont la cause est corrigée ; un verdict `same` deviné à tort serait mis en cache, pire qu'une erreur claire ; « Traduire avec… » est déjà à deux clics).
5. Un bouton **« Traduire » toujours visible** dans le panneau dès qu'un résumé est affiché. Résumé déjà dans la langue cible → toast « Déjà en {langue}. », **sans appel**.
6. **Mémoire par appareil** d'une traduction d'article affichée : revenir sur l'article la remontre, depuis le cache serveur, **jamais** par un appel payé sans clic.
7. Le fournisseur est déjà nommé dans le statut — rien à faire.

## Global Constraints

- Toute chaîne d'interface dans **les 10 locales** (`src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json`), via un petit script Node (`JSON.stringify(obj, null, 2) + "\n"`) ; parité vérifiée par la commande du `CLAUDE.md`. Une chaîne retirée l'est des 10.
- Trois formats : desktop, tablette, smartphone ; **320 px** est la largeur de référence mobile. Rien qui n'existe qu'au survol.
- Toute surface flottante se rend par portail sous `<body>` (inchangé ici).
- `docs/FEATURES.md` : la prose des sections touchées est **relue et corrigée** dans le même commit (pas seulement complétée) ; `docs/RELEASE-NEXT.md` reçoit une ligne par changement visible (la fonctionnalité IA n'est pas publiée : décrire ce qui sort, pas une régression).
- Jamais d'appel au fournisseur IA sans clic, hormis les automatismes déjà opt-in. Le drapeau `cacheOnly` ne réserve aucune unité du plafond.
- Gates avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`, puis le garde-fou de fuite d'infra du `CLAUDE.md` (sortie vide). Messages de commit conventionnels, **sans** trailer `Co-Authored-By` ni mention d'assistant.
- Modèle de design : le panneau des préférences et le panneau IA gardent leur vocabulaire (`BlockTitle`, `inputClass`, `quietBtn`, `prefs-tap-row`, `--ai-bg`/`--ai-border`). Pas de nouvelle couleur, pas de nouvelle police.

## Review Focus

1. **Deux comptes sur le même navigateur** : la mémoire des traductions est rangée par identifiant de compte ; un autre compte ne rejoue jamais les choix du précédent (test dans la tâche 7).
2. **Cache serveur expiré ou vidé** : le rejeu `cacheOnly` reçoit `404 not_cached` et l'article s'affiche en source, sans message ni appel (tâches 6 et 7).
3. **Corps changé entre deux visites** (extraction arrivée, « Article complet ») : le hash ne correspond plus, la mémoire ne s'applique pas et s'efface (tâche 7).
4. **Résumé dans la langue cible, clic sur « Traduire »** : aucun appel réseau, un toast ; le chevron ouvre toujours « Traduire en… » (tâche 4).
5. **Grille à 320 px** : le nom passe sur sa propre ligne, les trois contrôles restent sous leurs en-têtes de colonne ; aucun débordement horizontal (tâche 2, mesure au rendu).

---

### Task 1 : Préférences › IA — ordre des blocs et fin du repli « Avancé »

**Files:**
- Modify: `src/components/Preferences/AiTab.tsx`
- Modify: `src/components/Preferences/ai/AdminProviders.tsx` (lignes ~334-370 : le repli)
- Modify: `src/locales/*.json` (retirer `ai.admin.advanced`)
- Modify: `docs/FEATURES.md` (« Interface — Fournisseurs » : ordre, repli), `docs/RELEASE-NEXT.md`
- Test: `src/components/Preferences/AiTab.test.tsx`, `src/components/Preferences/Preferences.ai.test.tsx`

**Interfaces:**
- Produces: ordre des sections pour l'admin — `Fournisseurs`, `Résumés`, `Traduction`, `Par flux et catégorie`, `Mes clés` ; pour un utilisateur — inchangé (`Résumés`, `Traduction`, `Par flux et catégorie`, `Mes clés`). `SummariesBlock` garde `showIntro={!isAdmin}`.

- [ ] **Step 1 : tests rouges**

Dans `AiTab.test.tsx` (régler un `backendUser` admin dans `useAuthStore` comme les tests voisins) :

```tsx
it('place « Fournisseurs » en tête pour un admin', () => {
  // render AiTab en admin
  const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(titles[0]).toBe('Fournisseurs');
  expect(titles.slice(1)).toEqual(['Résumés', 'Traduction', 'Par flux et catégorie']); // + « Mes clés » si userKeysAllowed
});
it('montre « Les utilisateurs peuvent saisir leur propre clé » et le plafond sans repli', () => {
  expect(screen.queryByRole('button', { name: 'Avancé' })).toBeNull();
  expect(screen.getByRole('switch', { name: 'Les utilisateurs peuvent saisir leur propre clé' })).toBeInTheDocument();
  expect(screen.getByLabelText('Plafond quotidien par utilisateur')).toBeInTheDocument();
});
```

Adapter les tests existants qui cliquent « Avancé » pour atteindre ces deux réglages (ils cliquent directement maintenant).

- [ ] **Step 2 : vérifier l'échec** — `npx vitest run src/components/preferences` : les deux nouveaux tests échouent (ordre, bouton « Avancé » présent).

- [ ] **Step 3 : implémenter**

`AiTab.tsx` : `{isAdmin && <AdminProviders active={active} />}` passe en **premier** enfant du `div`. Mettre à jour le commentaire de tête.

`AdminProviders.tsx` : supprimer l'état `advanced`, le bouton et le conteneur `id={…-advanced}` ; les deux réglages (`userKeysAllowed`, `dailyCap`) restent dans le même ordre, sous « Fournisseur par défaut », au même niveau que lui (même `space-y`), sans bordure gauche.

Locales : retirer `ai.admin.advanced` des 10 fichiers (script Node).

- [ ] **Step 4 : vérifier le vert** — `npx vitest run src/components/preferences` ; parité des locales (commande du `CLAUDE.md`) : « parité ok ».

- [ ] **Step 5 : docs** — `FEATURES.md`, section « Interface — Fournisseurs » (≈ l. 2495-2510) : l'ordre des blocs (« Fournisseurs » en tête pour l'admin), les deux réglages à plat (le mot « Avancé » disparaît de l'inventaire, y compris dans « Interface — Mes clés » ≈ l. 2513). `RELEASE-NEXT.md` : une puce sous « Fonctionnalités » dans l'entrée IA, ou une ligne « Préférences › IA : … ».

- [ ] **Step 6 : gates + commit** — `fix(ai): providers first in the AI preferences, no more "Advanced" fold`.

---

### Task 2 : « Par flux et catégorie » en grille alignée

**Files:**
- Modify: `src/components/Preferences/ai/RoutingBlock.tsx`
- Modify: `docs/FEATURES.md` (« Interface — Par flux et catégorie » ≈ l. 2535-2600)
- Test: `src/components/Preferences/AiTab.test.tsx`

**Interfaces:**
- Consumes: `ProviderOptions`, `ToggleSwitch` (prop `ariaLabel`), `autoFor`, `groupFeedsByCategory` — inchangés.
- Produces: rien de nouveau pour les autres tâches. **Aucune nouvelle chaîne** : les en-têtes de colonne réutilisent `ai.translation.provider` (« Fournisseur »), `ai.routing.autoSummary` (« Résumer »), `ai.routing.autoTranslate` (« Traduire »).

**Design (tranché ici, à suivre tel quel) :**

```
                      Fournisseur     Résumer  Traduire      ← ligne d'en-têtes, texte 11 px, --list-summary
▸ Actualités (2 flux) [Par défaut  ▾]    (o)      ( )        ← catégorie : nom gras + bouton de dépli
    Le Monde          [Ollama     ▾]    (o)      ( )        ← flux déplié : nom indenté (pl-6), poids normal
    Libération        [Par défaut  ▾]    (o)      (o)
▸ Tech                [Par défaut  ▾]    ( )      ( )
  Sans catégorie                                             ← groupe sans sélecteur : cellules vides
    Hacker News       [Claude      ▾]    ( )      ( )
```

- **Une seule grille** pour tout le bloc (en-têtes, catégories, flux) : `display: grid`, colonnes `minmax(0,1fr) minmax(7rem,12rem) max-content max-content`, `gap-x-3 gap-y-1`, `items-center`. Les colonnes s'alignent donc d'une catégorie à l'autre et entre catégories et flux.
- Les **mots « Résumer » / « Traduire » par ligne disparaissent** (ils sont devenus les en-têtes) ; chaque interrupteur garde son nom accessible « Résumer / Traduire automatiquement les articles de X » et `describedBy={autoHintId}`.
- Catégorie : la cellule nom est le bouton de dépli (chevron + nom en `font-semibold` + « N flux réglés » dessous, comme aujourd'hui). Flux : la cellule nom est un `<span>` avec `pl-6`. Groupe « Sans catégorie » : cellule nom seule, les trois autres cellules sont des `<span aria-hidden />` vides pour tenir la grille.
- **Étroit (< 640 px, Tailwind `sm:`)** : colonnes `minmax(7rem,1fr) max-content max-content` ; la cellule nom prend `col-span-3` (ligne à elle), les trois contrôles suivent sur la ligne du dessous, alignés sous les en-têtes ; l'en-tête de la colonne nom n'existe pas (la ligne d'en-têtes commence à « Fournisseur »). Concrètement, la ligne d'en-têtes porte 4 cellules dont la première est `hidden sm:block`, et la cellule nom `col-span-3 sm:col-span-1`.
- `hidden={!expanded}` sur les flux : rendre les flux **dans la même grille** (fragments conditionnels), pas dans un `<ul>` à part ; `aria-controls` du bouton de dépli vise un `id` posé sur la **première cellule** du premier flux (ou, plus simple, on retire `aria-controls` et on garde `aria-expanded` seul — accepté).

- [ ] **Step 1 : tests rouges** (`AiTab.test.tsx`)

```tsx
it('aligne les interrupteurs sous des en-têtes de colonne, sans mot par ligne', () => {
  // render avec deux catégories et un flux sans catégorie
  expect(screen.getByText('Résumer')).toBeInTheDocument();   // une seule fois : l'en-tête
  expect(screen.getAllByText('Résumer')).toHaveLength(1);
  expect(screen.getByRole('switch', { name: 'Résumer automatiquement les articles de Actualités' })).toBeInTheDocument();
});
```

- [ ] **Step 2 : vérifier l'échec** — plusieurs « Résumer » aujourd'hui (un par ligne).

- [ ] **Step 3 : implémenter** `RoutingBlock.tsx` selon le design ; supprimer `AutoSwitches` et `selectClass` si plus utilisés (le sélecteur devient `prefs-tap-row w-full min-w-0 px-2 py-1.5 text-sm rounded-md min-h-[36px]`).

- [ ] **Step 4 : vert** — `npx vitest run src/components/preferences` ; `npm run build`.

- [ ] **Step 5 : mesure à 320 px** — rendre le balisage construit (émulateur Android ou in-app browser à 320 px) : `scrollWidth <= clientWidth` sur le panneau ; capture pour le rapport.

- [ ] **Step 6 : docs** — `FEATURES.md` « Interface — Par flux et catégorie » : la grille, les en-têtes, l'étroit ; retirer la phrase sur `ml-auto` / la paire qui « passe dessous ». Commit : `fix(ai): render the per-feed AI routing as an aligned grid`.

---

### Task 3 : panneau « Résumé IA » replié tant qu'il n'y a rien à montrer

**Files:**
- Modify: `src/components/ReadingPane/AiSummary.tsx`
- Modify: `src/locales/*.json` (retirer `ai.hint`)
- Modify: `docs/FEATURES.md` (« Interface — panneau », corps et mémoire du repli), `docs/RELEASE-NEXT.md`
- Test: `src/components/ReadingPane/AiSummary.test.tsx`

**Interfaces:**
- Consumes: `aiPanelCollapsed` / `setAiPanelCollapsed` (uiStore), `expandOnFirstSummary` — inchangés.
- Produces: règle d'affichage — `empty = !done && !loading && !alertText`. Quand `empty` : **pas de corps**, pas de chevron, l'en-tête n'est pas un bouton (`<div>` avec le même gabarit), le statut dit « Pas encore résumé », l'action « Résumer » reste à droite. Sinon : comportement actuel (mémoire `aiPanelCollapsed`, chevron, corps).

- [ ] **Step 1 : tests rouges** (`AiSummary.test.tsx`)

```tsx
it('sans résumé, ne rend ni corps ni chevron', () => {
  render(<AiSummary status="idle" result={null} … />);
  expect(screen.queryByText(/Cliquez sur/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Résumé IA/ })).toBeNull();   // l'en-tête n'est plus un bouton
  expect(document.querySelector('[data-chevron]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Résumer' })).toBeInTheDocument();
});
it('pendant la première demande, le corps (barres d\'attente) et le chevron reviennent', () => { … status="loading" … expect(document.querySelector('[data-chevron]')).not.toBeNull(); });
it('une erreur sans résumé se lit sous le titre', () => { … status="error" error="x" … expect(screen.getByRole('alert')).toHaveTextContent('x'); });
```

Adapter les tests existants qui attendent la ligne d'aide.

- [ ] **Step 2 : vérifier l'échec.**

- [ ] **Step 3 : implémenter** — dans `AiSummary` : `const empty = !done && !loading && !alertText;` ; l'en-tête gauche devient `empty ? <div className=…> : <button …>` (même classes, même contenu, sans chevron quand `empty`) ; le bloc corps `id={bodyId}` n'est rendu que si `!empty` ; la branche `t('ai.hint')` disparaît. L'erreur sans résumé : l'alerte est rendue sous le titre comme en mode replié (`collapsed || empty`). Mettre à jour le commentaire de tête du composant (« Structure »).

- [ ] **Step 4 : vert** — `npx vitest run src/components/ReadingPane` ; parité des locales.

- [ ] **Step 5 : docs** — `FEATURES.md` « Interface — panneau » : le corps n'existe qu'avec un résumé, une demande ou une erreur ; la ligne d'aide a disparu (retrait assumé) ; la mémoire du repli ne joue qu'à partir du premier résumé. `RELEASE-NEXT.md`. Commit : `fix(ai): keep the summary panel to its header until there is something to show`.

---

### Task 4 : « Traduire » toujours visible dans le panneau, « Déjà en {langue} » sans appel

**Files:**
- Modify: `src/components/ReadingPane/AiSummary.tsx` (`translatable`)
- Modify: `src/components/ReadingPane/ReadingPane.tsx` (`handleTranslateSummary`)
- Modify: `docs/FEATURES.md` (« traduction du résumé » ≈ l. 2650-2705), `docs/RELEASE-NEXT.md`
- Test: `src/components/ReadingPane/AiSummary.test.tsx`, `src/components/ReadingPane/ReadingPane.ai.test.tsx`

**Interfaces:**
- Consumes: `sameLanguage(a, b)` de `src/lib/aiLanguages.ts`, `pushToast`, chaîne existante `ai.translation.alreadyTarget`.
- Produces: `translatable = !!done && !loading && available.length > 0` (la condition de langue disparaît). Dans `handleTranslateSummary` : si `!regenerate && choice?.lang === undefined && !shown && sameLanguage(aiResult.lang, lang)` → `pushToast(t('ai.translation.alreadyTarget', { lang: languageName(lang, i18n.language) }))` et retour **sans requête**. « Traduire en → X » (choix explicite) part toujours.

- [ ] **Step 1 : tests rouges**

`AiSummary.test.tsx` : « affiche « Traduire » même quand le résumé est déjà dans la langue cible » (result `{ lang: 'fr' }`, `targetLang="fr"` → `getByRole('button', { name: 'Traduire' })`).
`ReadingPane.ai.test.tsx` : « un résumé déjà en français : « Traduire » dit « Déjà en français. » sans appeler /ai/translate » (espionner `requestAiTranslation` → `not.toHaveBeenCalled()`, toast présent).

- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** (voir Produces). Mettre à jour les commentaires (« Il n'apparaît que si… » devient faux).
- [ ] **Step 4 : vert.**
- [ ] **Step 5 : docs** — relire le paragraphe de la traduction du résumé dans `FEATURES.md` et la décision « Le summary's « Traduire » split button stays hidden when… » (devenue fausse : la corriger, pas seulement compléter). Commit : `feat(ai): keep "Translate" in the summary panel, say "already in <language>" without a call`.

---

### Task 5 : message actionnable pour une traduction inexploitable

**Files:**
- Modify: `src/locales/*.json` (`ai.errors.segments`)
- Modify: `docs/FEATURES.md` (la phrase qui cite le message), `docs/RELEASE-NEXT.md`

Nouveau texte (fr) : **« Le fournisseur n'a pas rendu une traduction exploitable (texte recopié ou coupé). Réessayez, ou choisissez un autre fournisseur via « Traduire avec… ». »** Même sens dans les 9 autres langues, guillemets de la langue. Pas de code : chaîne seule.

- [ ] **Step 1 : script Node** qui remplace la clé dans les 10 fichiers ; parité ok.
- [ ] **Step 2 : `npx vitest run src/lib/aiErrorKey src/components/ReadingPane`** (aucun test ne fige le texte ; sinon l'adapter).
- [ ] **Step 3 : docs + commit** — `fix(ai): tell what to do when a provider returns an unusable translation`.

---

### Task 6 : serveur — `cacheOnly` sur `POST /api/ai/translate`

**Files:**
- Modify: `server/ai/attempt.ts` (`Attempt.cacheOnly`), `server/ai/translate.ts` (`TranslateRequest.cacheOnly`), `server/routes/ai.ts`, `src/api/backend.ts` (`requestAiTranslation` : `cacheOnly?: boolean`)
- Modify: `docs/FEATURES.md` (« Traduction — serveur », route), `SECURITY.md` si la route y est décrite
- Test: `server/ai/attempt.test.ts`, `server/ai/translate.test.ts`, `server/test/ai.test.ts`

**Interfaces:**
- Produces: `Attempt<T>.cacheOnly?: boolean` — pour chaque candidat, lecture du cache seulement ; sans aucune entrée, `throw new AiError('technical', 'not_cached')` **avant** toute réservation de plafond et tout appel ; `skipCacheRead` et `cacheOnly` ensemble = 400 `invalid_body` à la route. `translate()` : avec `cacheOnly`, pas de `shareInflight` (un rejeu ne doit ni créer ni rejoindre une génération partagée : un vrai appel qui s'y rattacherait recevrait `not_cached`). Route : corps `cacheOnly` booléen strict (`badFlag`), erreur `not_cached` → **`404 { error: 'not_cached' }`** (traitée dans la route avant `sendAiError`). Réponse en cas de succès : la même qu'un hit de cache aujourd'hui (`fromCache: true`).

- [ ] **Step 1 : tests rouges**

`attempt.test.ts` : « cacheOnly : sans cache, lève not_cached sans appeler ni réserver » (`call` jamais appelé, `bumpUsage` non appelé — les tests voisins montrent comment observer l'usage) ; « cacheOnly : avec cache sur le second candidat, le rend sans appel ».
`translate.test.ts` : « cacheOnly ne passe pas par la génération partagée » (deux `translate()` simultanés, l'un `cacheOnly`, l'autre non : le second appelle le fournisseur).
`server/test/ai.test.ts` : « POST /translate cacheOnly sans cache → 404 not_cached » ; « cacheOnly + regenerate → 400 ».

- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** (voir Produces). Dans `runWithFallback`, la boucle : `if (cached) return …; if (a.cacheOnly) continue;` puis après la boucle `if (a.cacheOnly) throw new AiError('technical', 'not_cached');` — avant les autres sorties.
- [ ] **Step 4 : vert** — `npx vitest run server`.
- [ ] **Step 5 : docs** — `FEATURES.md` « Traduction — serveur » : le drapeau, sa garantie (aucun appel, aucune unité), le 404. Commit : `feat(ai): cache-only translation reads for replaying a shown translation`.

---

### Task 7 : client — mémoire par appareil d'une traduction d'article affichée

**Files:**
- Create: `src/lib/aiShownTranslations.ts`, `src/lib/aiShownTranslations.test.ts`
- Modify: `src/components/ReadingPane/useArticleTranslation.ts`
- Modify: `docs/FEATURES.md` (« Traduction — client », nouvel alinéa « Mémoire par appareil »), `docs/RELEASE-NEXT.md`
- Test: `src/components/ReadingPane/useArticleTranslation.test.tsx`

**Interfaces:**
- Consumes: `requestAiTranslation({ …, cacheOnly: true })` (tâche 6) ; `useAuthStore.getState().backendUser?.id`.
- Produces, dans `aiShownTranslations.ts` (pur, localStorage sous `frirss_aiShown:<userId>`, **200 entrées au plus**, les plus anciennes évincées, chaque lecture/écriture sous `try/catch`) :

```ts
export interface ShownTranslation { lang: AiLanguage; providerId?: number; hash: string; at: number }
export function rememberShown(userId: string, articleId: string, v: Omit<ShownTranslation, 'at'>, now?: () => number): void;
export function forgetShown(userId: string, articleId: string): void;
export function recallShown(userId: string, articleId: string, hash: string): ShownTranslation | null; // null si absent ou hash différent
```

Dans `useArticleTranslation` :
- `TranslateOptions.cacheOnly?: boolean` : chaque lot part avec `cacheOnly: true`, pas de notice d'erreur : toute erreur → état `idle` et `forgetShown`. Un `same` → `idle` aussi (rien à montrer). **Lot coupé en deux à la traduction** (échéance, réponse inexploitable, coupure amont) : il est en cache sous ses deux moitiés, jamais entier — sur un 404 `not_cached` d'un lot de 2+ segments, rejouer les deux moitiés en `cacheOnly` (gratuit par garantie serveur) et les recoller (`joinHalves`) ; une moitié absente termine le rejeu en silence ; jamais de coupe plus fine ; les autres codes (409, 5xx) ne coupent pas. *(Révisé après relecture : la règle initiale « jamais de coupe en deux » faisait échouer le rejeu sur les longs articles.)*
- Au changement de `key` (effet existant), si `enabled` et `recallShown(user, id, hash)` rend une entrée : `translate({ lang, providerId }, { cacheOnly: true })` — **avant** la traduction automatique (son délai `AUTO_SUMMARY_DELAY_MS` laisse le rejeu poser `loading` d'abord).
- Quand un snapshot `done` s'affiche avec `showing: 'translation'` (fin de boucle, ou `showTranslation`) : `rememberShown(user, id, { lang, providerId, hash })`. `showSource()` : `forgetShown`. Un `cacheOnly` réussi ré-enregistre (rafraîchit `at`).
- `providerId` mémorisé = celui de la traduction affichée (`r.providerId` du dernier lot) : le rejeu force ce fournisseur (`provider`) pour retomber sur la même clé de cache ; s'il n'est plus disponible, le serveur répond `no_provider` → silence, oubli.

- [ ] **Step 1 : tests rouges**

`aiShownTranslations.test.ts` : enregistre puis rappelle ; hash différent → `null` ; deux comptes isolés ; 201ᵉ entrée évince la plus ancienne ; localStorage qui lève → ne lève pas.
`useArticleTranslation.test.tsx` : « un article dont une traduction a été affichée est rejoué en cacheOnly au retour » (mock `requestAiTranslation` reçoit `cacheOnly: true` et répond depuis le « cache » → état `done`, `showing: 'translation'`) ; « 404 not_cached → idle, sans erreur, mémoire effacée » ; « Texte source efface la mémoire » ; « un rejeu ne coupe jamais en deux » (502 deadline → un seul appel).

- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vert** — `npx vitest run src/lib src/components/ReadingPane`.
- [ ] **Step 5 : docs** — `FEATURES.md` « Traduction — client » : l'alinéa « Mémoire par appareil » (quoi, où, la garantie cacheOnly, les cas d'oubli : « Texte source », hash changé, cache absent, fournisseur disparu) ; `RELEASE-NEXT.md`. Commit : `feat(ai): remember a shown article translation per device`.

---

### Task 8 : un `<s>` barré dans l'article ne doit jamais atteindre le modèle

Le correctif des balises retire `</s>` du **protocole**, mais un article qui contient un vrai texte barré (`<s>…</s>`, balise HTML légitime gardée par le sanitiseur) l'envoie encore dans le segment, et le modèle doit le réécrire : même arrêt possible sur un modèle Llama/Qwen (non mesuré, signalé dans `FEATURES.md`).

**Files:**
- Modify: `src/lib/articleSegments.ts` (helper pur), `src/components/ReadingPane/useArticleTranslation.ts` (`prepare`, ligne ≈ 246 : `send`)
- Modify: `docs/FEATURES.md` (« Traduction — client », découpage ; retirer la réserve « non mesuré » de « Traduction — serveur »)
- Test: `src/lib/articleSegments.test.ts`, `src/components/ReadingPane/useArticleTranslation.test.tsx`

**Interfaces:**
- Produces: `export function strikeToDel(html: string): string` — remplace chaque `<s …>` par `<del …>` (attributs gardés) et `</s>` par `</del>`, insensible à la casse, linéaire (`[^<>]`). Appliquée aux segments **envoyés** (`send`, après `sanitizeHtml`), titre compris. La traduction rendue garde `<del>` (même rendu barré ; `apply` ne reconvertit pas : assumé, noté dans l'inventaire).

- [ ] **Step 1 : tests rouges** — `strikeToDel('a <s class="x">b</s> c')` → `'a <del class="x">b</del> c'` ; `<S>`/`</S >` aussi ; `<span>` intact ; dans `useArticleTranslation.test.tsx`, un corps avec `<s>` → `requestAiTranslation` reçoit un segment sans `<s`.
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** (`send = segmented.segments.map((s, i) => strikeToDel(i === 0 ? s : sanitizeHtml(s)))`).
- [ ] **Step 4 : vert** — `npx vitest run src/lib src/components/ReadingPane`.
- [ ] **Step 5 : docs + commit** — `fix(ai): send strikethrough as <del> so no article carries a tokenizer stop string`.

---

## Auto-revue

- Couverture des décisions : 1 → tâches 1-2 ; 3 → tâche 3 ; 4 → tâches 5 et 8 (+ correctif des balises, commit 7b9a062) ; 5 → tâche 4 ; 6 → tâches 6-7 ; 2 et 7 → rien, assumé.
- Cohérence des noms : `cacheOnly` (route, `TranslateRequest`, `Attempt`, `requestAiTranslation`, `TranslateOptions`) ; `not_cached` (AiError message, corps 404) ; `rememberShown` / `forgetShown` / `recallShown`.
- Fichiers partagés : `AiSummary.tsx` (tâches 3 puis 4, séquentielles) ; `FEATURES.md` partout (relire la section avant d'écrire) ; `useArticleTranslation.ts` (tâches 7 puis 8, séquentielles) ; `articleSegments.ts` (tâche 8 seule).
