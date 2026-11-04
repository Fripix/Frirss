# Barres personnalisables sur desktop — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** sur le format desktop, chaque bouton de la barre de la liste et de
la barre du volet de lecture, la barre de la liste entière et la barre des
raccourcis se masquent depuis Préférences → Mise en page ; tout ce qui est
masquable a sa commande dans la palette.

**Architecture :** un registre pur (`src/lib/toolbarItems.ts`) déclare les 23
éléments masquables et les deux barres ; un seul objet `toolbarVisibility`
dans `uiStore`, synchronisé. Les barres lisent `useToolbarShown()` (desktop
seulement). La palette découvre les commandes des barres par un bus
d'événements sonde/exécution (`src/lib/toolbarCommands.ts`), sur le modèle
d'`aiTranslateProbe.ts` : c'est le composant qui porte le bouton qui dit si
la commande est possible et sous quel libellé, et qui l'exécute avec le même
gestionnaire que son bouton.

**Tech Stack :** React 19, TypeScript strict, Zustand 5, vitest + Testing
Library (jsdom), i18next (10 locales).

**Spec :** `docs/superpowers/specs/2026-11-04-desktop-toolbar-visibility-design.md`

## Global Constraints

- Tout visible par défaut ; une clé absente ou non booléenne vaut **visible**.
- « Desktop » = `useBreakpoint() === 'desktop'`. Ailleurs, les réglages sont ignorés.
- Une seule clé de stockage : `toolbarVisibility` (`frirss_toolbarVisibility`),
  dans `UI_SYNC_KEYS` **et** dans `jsonKeys` d'`applyServerPrefs`, normalisée
  au chargement **et** à `applyServerPrefs`.
- Masquer **retire** ; rien n'est déplacé ni réordonné. Jamais de séparateur
  orphelin, jamais de conteneur vide, jamais de bande vide.
- Barre des serveurs et icônes des lignes : stockage et portée inchangés
  (tous formats).
- Toute chaîne visible dans les 10 locales ; parité vérifiée (commande du
  CLAUDE.md) ; nouvelle famille `preferences.toolbars` citée dans
  `docs/FEATURES.md` (sinon `featuresDoc.test.ts` rougit).
- Gates avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`,
  puis le garde-fou de fuite du CLAUDE.md. Messages de commit conventionnels,
  **sans trailer ni mention d'IA**.
- `docs/FEATURES.md` et `docs/RELEASE-NEXT.md` mis à jour dans le commit qui
  rend la fonctionnalité visible.

## Review Focus

1. **Appareil resté sur une version antérieure** qui synchronise un
   `toolbarVisibility` sans les clés récentes → ces boutons restent visibles
   (Task 1, Task 2).
2. **Tablette ou téléphone, réglages posés** → aucune différence, la barre
   tablette (branche « 2 colonnes » d'`ArticleList`) comprise (Task 4).
3. **Barre de la liste masquée avec une recherche active** (lancée depuis la
   palette ou l'historique) → le bandeau « recherche active » et sa croix
   restent atteignables (Task 4).
4. **« Tout lu » lancé depuis la palette avec la confirmation activée** → la
   boîte de confirmation s'ouvre, rien n'est marqué avant (Task 4).
5. **Tous les boutons du volet masqués, en 2 colonnes** → pas de barre vide,
   la progression reste en liseré en haut, et « Retour » est dans la palette
   (Task 5).

---

### Task 1 : registre et règles pures

**Files :**
- Create : `src/lib/toolbarItems.ts`
- Test : `src/lib/toolbarItems.test.ts`

**Interfaces :**
- Produces :
  - `type ToolbarZone = 'list' | 'reading'`
  - `TOOLBAR_ITEMS: readonly { id: ToolbarItemId; zone: ToolbarZone }[]`, dans
    l'ordre d'affichage :
    - list : `search`, `unreadFilter`, `random`, `starredFilter`,
      `markAllRead`, `optSource`, `optFavicons`, `optDateSeparators`,
      `optServerBar`, `density`, `layout` ;
    - reading : `back`, `read`, `star`, `readLater`, `labels`,
      `fullContent`, `summarize`, `translate`, `original`, `share`, `focus`,
      `fontSize`.
  - `type ToolbarItemId` (union des 23 ids ci-dessus)
  - `type ToolbarBarId = 'listBar' | 'shortcutBar'`
  - `type ToolbarToggleId = ToolbarItemId | ToolbarBarId`
  - `type ToolbarVisibility = Record<ToolbarToggleId, boolean>`
  - `DEFAULT_TOOLBAR_VISIBILITY: ToolbarVisibility` (tout `true`)
  - `normalizeToolbarVisibility(value: unknown): ToolbarVisibility`
  - `resetToolbarZone(v: ToolbarVisibility, zone: ToolbarZone | 'shortcuts'): ToolbarVisibility`
    (`list` remet aussi `listBar` ; `shortcuts` ne remet que `shortcutBar`)
  - `separatorsBefore(groupsVisible: boolean[]): boolean[]` : `true` pour un
    groupe visible précédé d'au moins un groupe visible.

- [ ] **Step 1 : tests qui échouent** (`toolbarItems.test.ts`)
  - `normalizeToolbarVisibility(undefined)` / `null` / `[]` / `'x'` → égal à `DEFAULT_TOOLBAR_VISIBILITY`.
  - `normalizeToolbarVisibility({ star: false })` → `star === false`, toutes les autres clés `true` (clés manquantes = visibles).
  - `normalizeToolbarVisibility({ star: 'no', bogus: false })` → `star === true`, pas de clé `bogus`.
  - `TOOLBAR_ITEMS` : 11 en `list`, 12 en `reading`, ids uniques.
  - `resetToolbarZone({ ...all false }, 'list')` → items `list` et `listBar` à `true`, `reading` et `shortcutBar` inchangés (`false`).
  - `resetToolbarZone(…, 'shortcuts')` → seul `shortcutBar` change.
  - `separatorsBefore([true, true, true])` → `[false, true, true]` ;
    `[false, true, false, true]` → `[false, false, false, true]` ;
    `[false, false]` → `[false, false]` ; `[true, false, false]` → `[false, false, false]`.
- [ ] **Step 2 :** `npx vitest run src/lib/toolbarItems.test.ts` → FAIL (module absent).
- [ ] **Step 3 :** implémenter, sur le modèle de `normalizeRowActions` (`src/lib/rowActions.ts`).
- [ ] **Step 4 :** même commande → PASS.
- [ ] **Step 5 :** gates + garde-fou, commit `feat: add a registry of maskable toolbar items`.

### Task 2 : préférence dans le store et accès desktop

**Files :**
- Modify : `src/stores/uiStore.ts` (état, chargement, setters, `jsonKeys`, normalisation, `UI_SYNC_KEYS`)
- Create : `src/hooks/useToolbarShown.ts`
- Test : `src/stores/uiStore.test.ts` (ajout), `src/hooks/useToolbarShown.test.tsx`

**Interfaces :**
- Consumes : Task 1.
- Produces :
  - `useUiStore` : `toolbarVisibility: ToolbarVisibility`,
    `setToolbarVisible(id: ToolbarToggleId, visible: boolean): void`,
    `resetToolbarZone(zone: ToolbarZone | 'shortcuts'): void` (chacun écrit
    `frirss_toolbarVisibility`).
  - `useToolbarShown(): (id: ToolbarToggleId) => boolean` — `true` pour tout
    id hors desktop ; sur desktop, la valeur stockée.

- [ ] **Step 1 : tests qui échouent**
  - uiStore : `applyServerPrefs({ toolbarVisibility: { star: false } })` →
    `toolbarVisibility.star === false` et `.share === true` ; une valeur
    `'garbage'` donne le défaut complet ; `UI_SYNC_KEYS` contient
    `'toolbarVisibility'` ; `setToolbarVisible('random', false)` puis lecture
    de `localStorage.frirss_toolbarVisibility` → `random: false`.
  - hook (mock de `useBreakpoint`) : `random` masqué → desktop `false`,
    `tablet` `true`, `mobile` `true`.
- [ ] **Step 2 :** lancer les deux fichiers → FAIL.
- [ ] **Step 3 :** implémenter (chargement `normalizeToolbarVisibility(loadJson('frirss_toolbarVisibility', null))`, branche `k === 'toolbarVisibility'` dans la normalisation d'`applyServerPrefs`).
- [ ] **Step 4 :** PASS, et `npx vitest run src/stores` vert (un test vérifie l'alignement `jsonKeys` / `UI_SYNC_KEYS` s'il existe).
- [ ] **Step 5 :** gates + garde-fou, commit `feat: store desktop toolbar visibility as one synced preference`.

### Task 3 : bus de commandes et palette

**Files :**
- Create : `src/lib/toolbarCommands.ts`
- Modify : `src/components/CommandPalette.tsx`
- Modify : `src/locales/*.json` (10) — `palette.labelAdd`, `palette.labelRemove`
- Test : `src/lib/toolbarCommands.test.tsx`, `src/components/CommandPalette.test.tsx` (ajout)

**Interfaces :**
- Consumes : `ToolbarItemId` (Task 1).
- Produces :
  - `interface ToolbarOffer { command: string; item: ToolbarItemId; label: string }`
  - `probeToolbarCommands(): ToolbarOffer[]` — événement synchrone
    `frirss:toolbar-probe`, `detail: { offers: ToolbarOffer[] }` que chaque
    écouteur complète.
  - `runToolbarCommand(command: string): void` — événement
    `frirss:toolbar-command`, `detail: { command }`.
  - `useToolbarCommands(getOffers: () => ToolbarOffer[], run: (command: string) => void): void`
    — pose les deux écouteurs une fois, lit les dernières fonctions par ref ;
    `run` n'est appelé que pour une commande que `getOffers()` propose
    **au moment de l'événement** (une commande périmée ne fait rien).
  - Palette : chaque offre devient `{ id: \`toolbar:${command}\`, label, group: 'actions' }`,
    dont `run` ferme la palette **puis** appelle `runToolbarCommand`.
    Nouvelle commande statique `action:toggleSidebar`
    (`t('preferences.shortcuts.toggleSidebar')` → `useUiStore.getState().toggleSidebar()`).
  - Locales : `palette.labelAdd` = « Ajouter l’étiquette {{name}} »,
    `palette.labelRemove` = « Retirer l’étiquette {{name}} » (fr ; en : « Add
    tag {{name}} » / « Remove tag {{name}} » — l'app dit *tag* ; les 8 autres
    traduites dans le même esprit).

- [ ] **Step 1 : tests qui échouent**
  - bus : deux composants montés avec `useToolbarCommands` → `probeToolbarCommands()` renvoie l'union de leurs offres ;
    `runToolbarCommand('x')` appelle le `run` du composant qui offre `x`, pas l'autre ;
    une commande qu'il n'offre plus (offres changées après rendu) n'appelle rien ;
    démonté → plus d'offre.
  - palette : un composant de test offre `{ command: 'demo', item: 'random', label: 'Demo' }` → la palette ouverte liste « Demo » sous « Actions » ; Entrée → palette fermée puis `run('demo')` appelé ; `action:toggleSidebar` présent.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter ; dans la palette, appeler `probeToolbarCommands()` dans le `useMemo` des commandes (déjà recalculé à l'ouverture), comme `translateWouldAct()`.
- [ ] **Step 4 :** PASS ; parité des locales.
- [ ] **Step 5 :** gates + garde-fou, commit `feat: let toolbars offer their actions to the command palette`
  (FEATURES : section palette — le bus, la règle « commande périmée = rien »,
  `toggleSidebar`).

### Task 4 : barre de la liste

**Files :**
- Modify : `src/components/ArticleList/ArticleList.tsx` (en-tête, l. ~847-1130 ; offres)
- Test : `src/components/ArticleList/ArticleList.toolbar.test.tsx` (harnais d'`ArticleList.random.test.tsx`)

**Interfaces :**
- Consumes : `useToolbarShown` (Task 2), `separatorsBefore` (Task 1), `useToolbarCommands` (Task 3).
- Produces : offres (commande → item, libellé) :
  - `unreadFilter` → `unreadFilter`, `t('articleList.unread')`
  - `random` → `random`, `t('articleList.random')` — seulement si `randomButton` existe et n'est pas `disabled`
  - `starredFilter` → `starredFilter`, `t('articleList.starred')`
  - `markAllRead` → `markAllRead`, `t('articleList.markAllRead')` — seulement si `canMarkAll` ; exécute `handleMarkAllRead` (même confirmation)
  - `optSource` / `optFavicons` / `optDateSeparators` / `optServerBar` → leur item,
    `t('app.labelValue', { label: t('articleList.viewOptions'), value: <libellé de l'option> })` ;
    mêmes gestionnaires que les bascules (`isInFeed` et `gridLayout` compris)
  - `density:preview|simple|compact` → `density`,
    `t('app.labelValue', { label: t('articleList.displayMode'), value: t('viewMode.preview|standard|compact') })` — seulement hors grille

Règles de rendu (desktop seulement ; mobile inchangé, branche tablette
inchangée puisque `useToolbarShown` y rend `true`) :
- `shown('listBar') === false` → ni la barre 2 colonnes, ni les deux rangées
  3 colonnes ; le conteneur `.article-list-header` n'est rendu que si la zone
  de recherche est active (`searchOpen || searchQuery`).
- Chaque bouton gardé par `shown(id)` ; `.option-track` non rendue si ses
  quatre bascules sont masquées ; `ViewModeSwitcher` ⇐ `shown('density')` ;
  `LayoutToggle` ⇐ `shown('layout')`.
- Séparateurs par `separatorsBefore` : 3 colonnes `[search] | [unread, random, starred] | [markAll]` ;
  2 colonnes `[search, unread, random, starred] | [markAll]`, et le trait
  vertical après le titre seulement si un bouton d'action est visible.
- 3 colonnes : la rangée d'actions n'est pas rendue si elle n'a aucun bouton.
- `useToolbarFold(actionRowRef, …)` reçoit `toolbarVisibility` dans ses deps.

- [ ] **Step 1 : tests qui échouent** (`useBreakpoint` mocké à `desktop`, sauf mention)
  - tout masqué sauf la barre, 3 colonnes → pas de rangée `.list-actions`, pas de `.option-track`, titre présent.
  - `listBar` masqué → aucun `h2` de titre, aucun bouton « articleList.search » ; `.article-list-header` absent.
  - `listBar` masqué + `searchQuery: 'rust'` → le bouton `articleList.clearSearch` est présent et le clic vide la recherche (Review Focus 3).
  - `listBar` masqué + événement `frirss:open-search` → le champ de recherche apparaît.
  - `search` masqué, 3 colonnes → la rangée commence par « articleList.unread », aucun séparateur avant lui ; `markAllRead` masqué → aucun séparateur en queue.
  - `useBreakpoint` → `tablet`, tout masqué → tous les boutons présents (Review Focus 2).
  - offres : `probeToolbarCommands()` contient `markAllRead` sur un flux non lu ; avec `confirmMarkAllRead: true`, `runToolbarCommand('markAllRead')` ouvre la boîte (`dialog.markAllTitle` ou le titre réel du `ConfirmDialog`) et `api.markAllAsRead` n'est pas appelé (Review Focus 4).
  - offres : en grille, aucune offre `density:*`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** PASS ; `npx vitest run src/components/ArticleList` vert.
- [ ] **Step 5 :** gates + garde-fou, commit `feat: hide list toolbar buttons on desktop`.

### Task 5 : barre du volet de lecture

**Files :**
- Modify : `src/components/ReadingPane/ReadingPane.tsx` (barre l. ~1436-1726 ; offres)
- Test : `src/components/ReadingPane/ReadingPane.toolbar.test.tsx` (harnais de `ReadingPane.links.test.tsx`)

**Interfaces :**
- Consumes : Tasks 1-3.
- Produces : offres (article ouvert seulement) :
  - `back` → `back`, `t('readingPane.back')` — seulement si `showBack`
  - `read` → `read`, `t(article.read ? 'preferences.shortcuts.markUnread' : 'preferences.shortcuts.markRead')`
  - `star` → `star`, `t('preferences.shortcuts.toggleStar')` ; `readLater` → `readLater`, `t('preferences.shortcuts.readLater')`
  - `label:<labelId>` → `labels`, `t(has ? 'palette.labelRemove' : 'palette.labelAdd', { name })`,
    pour chaque étiquette du store hors `READ_LATER_LABEL` et `categoryIds`
    (même filtre que `LabelMenu`) ; exécute `toggleArticleLabel(article, labelId)`
  - `fullContent` → `fullContent`, libellé du bouton (`showRss` / `fullContent`) — si `article.url` et pas `extracting`
  - `showSource` → `translate`, `t('ai.showSource')` — seulement si `showTranslatedBody` ; exécute `tr.showSource`
  - `original` → `original`, `t('preferences.shortcuts.openOriginal')` — si `safeHref(article.url)` ; `window.open(href, '_blank', 'noopener,noreferrer')`
  - `share` → `share`, libellé du bouton — si `article.url` ; `shareArticle(article)`
  - `focus` → `focus`, `t(readingFocus ? 'readingPane.focusExit' : 'readingPane.focusEnter')`
  - `fontDown` / `fontUp` → `fontSize`, `t('sidebar.reduceText')` / `t('sidebar.enlargeText')` — dans les bornes
  (`summarize` et `translate` gardent leurs commandes `action:aiSummarize` / `action:aiTranslate`.)

Règles de rendu :
- Chaque bouton gardé par `shown(id)` (le bouton scindé Traduire, chevron
  compris, par `shown('translate')`) ; l'appui long de Favori / À lire plus
  tard disparaît avec son bouton.
- Séparateurs par `separatorsBefore` sur `[read, star, readLater] | [labels] | [fullContent, summarize, translate, original, share]`.
- L'espaceur reste ; le bloc A−/A+ n'est rendu que si `shown('fontSize')`.
- Aucun bouton visible → la barre n'est pas rendue, et la progression
  s'affiche en liseré en haut (`reading-progress absolute top-0`, comme la
  branche mobile).
- `useToolbarFold(toolbarRef, …)` reçoit `toolbarVisibility`.

- [ ] **Step 1 : tests qui échouent** (desktop)
  - `labels` masqué → un seul séparateur entre le groupe Lu/Favori/Plus tard et Article complet ; `read`+`star`+`readLater` masqués → aucun séparateur avant Étiquettes.
  - tout masqué, 2 colonnes (`showBack`) → pas de `.reading-toolbar` ; avec `readProgress > 0` simulé (défilement du conteneur), un `.reading-progress` en `top-0` (Review Focus 5) ; `probeToolbarCommands()` contient `back`.
  - `fontSize` masqué → aucun bouton `sidebar.reduceText`.
  - offres : `runToolbarCommand('star')` appelle `toggleStar(article)` ; `label:user/-/label/X` appelle `toggleArticleLabel` ; pas d'offre `showSource` sans traduction affichée.
  - tablette, tout masqué → rendu identique à aujourd'hui (pas de barre desktop, comme avant).
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** PASS ; `npx vitest run src/components/ReadingPane` vert.
- [ ] **Step 5 :** gates + garde-fou, commit `feat: hide reading pane toolbar buttons on desktop`.

### Task 6 : barre des raccourcis

**Files :**
- Modify : `src/components/ShortcutBar.tsx`
- Test : `src/components/ShortcutBar.test.tsx` (ajout)

- [ ] **Step 1 : test qui échoue :** desktop, `shortcutBar: false` → le composant ne rend rien ; `true` → rendu inchangé.
- [ ] **Step 2 :** FAIL. **Step 3 :** `if (breakpoint !== 'desktop' || !visibility.shortcutBar) return null;` **Step 4 :** PASS.
- [ ] **Step 5 :** gates + garde-fou, commit `feat: allow hiding the shortcut bar`.

### Task 7 : Préférences → Mise en page

**Avant le JSX : invoquer le skill `frontend-design`** (consigne du projet).

**Files :**
- Modify : `src/components/Preferences/LayoutTab.tsx`
- Modify : `src/locales/*.json` (10) — famille `preferences.toolbars`
- Modify : `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`, `README.md`
- Test : `src/components/Preferences/LayoutTab.toolbars.test.tsx`

**Interfaces :**
- Consumes : Tasks 1-2 ; `topbarVisible` / `toggleTopbar`, `rowActions` existants.
- Produces : clés `preferences.toolbars.*` :
  `desktopTitle` (« Sur ordinateur »), `desktopHint` (masqué = toujours dans
  la palette, Ctrl/⌘ K ; masquer Favori ou À lire plus tard dans le volet
  retire aussi leur appui long), `desktopOnly` (affiché hors desktop : « Ces
  réglages ne s’appliquent qu’à l’affichage ordinateur. »), `listBar`,
  `listBarWhole` (« Afficher la barre »), `readingBar`, `shortcutBar`,
  `showAll` (« Tout réafficher »), `everywhereTitle` (« Sur tous les écrans »),
  `serverBar`, et `items.<ToolbarItemId>` pour les 23 éléments (fr :
  Rechercher, Non lus, Aléatoire, Favoris, Tout lu, Nom du flux, Icônes des
  flux, Séparateurs de date, Bascule de la barre des serveurs, Densité,
  Disposition (Liste / Côte à côte / Grille), Retour, Lu / Non lu, Favori,
  À lire plus tard, Étiquettes, Article complet, Résumer, Traduire, Original,
  Partager, Mode Focus, Taille du texte).

Mise en page de l'onglet : « Sur ordinateur » (titre + aide + mention
`desktopOnly` hors desktop) → Barre de la liste (« Afficher la barre » en
tête ; éteint, les 11 interrupteurs restent visibles mais `disabled`) +
« Tout réafficher » → Volet de lecture (12) + « Tout réafficher » → Barre des
raccourcis (1). Puis « Sur tous les écrans » : Barre des serveurs, puis le
bloc existant des icônes des lignes (titre et aide actuels conservés).
« Tout réafficher » n'est actif que si un élément de sa zone est masqué.

- [ ] **Step 1 : tests qui échouent**
  - 11 + 12 interrupteurs générés depuis `TOOLBAR_ITEMS` (aucun libellé en dur) ;
  - « Afficher la barre » éteint → les 11 de la liste `disabled`, ceux du volet non ;
  - « Tout réafficher » (liste) → `listBar` et items `list` à `true`, `reading` inchangé ;
  - l'interrupteur « Barre des serveurs » bascule `topbarVisible` ;
  - les quatre interrupteurs `rowActions` toujours là ;
  - `tablet` → la mention `preferences.toolbars.desktopOnly` est rendue.
- [ ] **Step 2 :** FAIL. **Step 3 :** implémenter (locales par script Node, `JSON.stringify(obj, null, 2) + "\n"`). **Step 4 :** PASS ; parité ; balayage des attributs visibles (`title`, `aria-label`) sans littéral.
- [ ] **Step 5 :** docs dans le même commit :
  - FEATURES : nouvelle entrée (registre, clé, normalisation, règles de
    rendu, bus de la palette, pièges : la branche tablette d'`ArticleList`
    est la même que la 2 colonnes, d'où le contrôle par `useToolbarShown`) ;
    relire la prose de « Préférences → Mise en page », des en-têtes de liste
    et du volet, de la barre des raccourcis ; citer `preferences.toolbars`.
  - RELEASE-NEXT : une entrée Fonctionnalités.
  - README : une phrase sous la personnalisation.
- [ ] **Step 6 :** gates + garde-fou, commit `feat: choose which toolbar buttons show on desktop`.

### Task 8 : garde-fou registre ↔ palette

**Files :**
- Test : `src/lib/toolbarCoverage.test.tsx`

- [ ] **Step 1 : écrire le test.** Monter `ArticleList` (desktop, 2 colonnes
  puis 3 colonnes, flux non lu, hors grille, en ligne) et `ReadingPane`
  (article avec URL, étiquette existante, `showBack`), puis :
  l'ensemble `{ offer.item }` ∪ `{ search, layout, summarize, translate }`
  (commandes statiques, dont la présence est vérifiée en rendant la palette
  avec `aiUsable`, `summarizeWouldAct`, `translateWouldAct` mockés à vrai)
  doit égaler l'ensemble des ids de `TOOLBAR_ITEMS`. Second test : tout
  masqué sur desktop → plus aucun `button` dans `.list-actions`,
  `.option-track` et `.reading-toolbar` (chaque bouton des barres est bien
  déclaré).
  *(Exception attendue : `random` demande un flux où le tirage est permis ;
  `translate` hors traduction affichée n'est couvert que par la commande
  statique — le test le dit en commentaire.)*
- [ ] **Step 2 :** PASS, puis **prouver qu'il sait échouer** : retirer l'offre
  `optFavicons` → rouge ; ajouter un faux item au registre → rouge ; tout
  remettre → vert.
- [ ] **Step 3 :** gates + garde-fou, commit `test: every maskable toolbar item has a palette command`.

### Task 9 : vérification réelle et livraison

- [ ] Push `dev`, puis `gh run list --branch dev --limit 2` : **CI** et **Publish image** verts sur le SHA.
- [ ] Redéployer `frirss-test` (procédure de la mémoire `frirss-release-state`), `/api/health` avec `uptime` faible.
- [ ] Oya sur `frirss-dev` (étiquette de version vérifiée, double rechargement) :
  3 colonnes, 2 colonnes, grille ; toutes zones masquées puis une à une ;
  mesurer par `getBoundingClientRect()` : aucune barre vide, aucun
  séparateur en tête/queue/doublé ; la liste commence en haut quand la barre
  est masquée ; la palette n'est pas pilotable par Oya (pas de ⌘K) : la
  couverture palette repose sur Task 8.
- [ ] Remettre les réglages de l'utilisateur de test comme avant.
- [ ] Revue finale de branche par un relecteur neuf (diff depuis `cac61ab`).
