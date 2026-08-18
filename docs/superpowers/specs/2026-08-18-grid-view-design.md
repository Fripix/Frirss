# Vue grille — design

**Date** : 2026-08-18
**Statut** : implémenté

> **Correction post-implémentation.** La grille est un **mode de disposition**
> (`panelLayout='grid'`), 3e bouton du groupe *Liste seule / Liste + lecture
> côte à côte* — **pas** un 4e mode de densité du switcher Aperçu/Standard/Compact
> (ce switcher est masqué quand la grille est active). `panelLayout` est
> local à l'appareil (non synchronisé). Les **séparateurs de date sont désactivés
> par défaut** dans la grille (réglage propre `gridDateSeparators`, synchronisé) :
> par défaut une galerie continue, activables pour un regroupement par date. Le
> nombre de colonnes suit la largeur de la fenêtre (CSS `auto-fill`).

## Objectif

Ajouter une **vue grille** : une galerie de cartes plein écran avec miniatures,
en plus des modes liste existants. Répond au point #4 de la roadmap Reddit.

## Décisions (brainstorming)

- **Placement** : grille **plein écran** (la colonne liste + le volet de lecture
  cèdent la place à une galerie multi-colonnes).
- **Ouverture d'un article** : **lecteur overlay** — l'article s'ouvre en plein
  écran par-dessus la grille, un bouton retour / Esc revient à la grille pile où
  on était.
- **Cartes sans image** : **cartes uniformes** (miniature ratio fixe) + fallback
  élégant quand pas d'image. Pas de masonry.
- **Périmètre** : desktop **et** mobile (grille responsive).
- **Extrait de texte** : conservé sur la carte (2 lignes).

## Activation

Un **4e segment dans le `ViewModeSwitcher` existant** (même groupe que
preview / simple / compact), icône grille. Nouvelle valeur `viewMode: 'grid'`.

- Réutilise la plomberie de préférences existante : **persisté en localStorage
  et synchronisé par-utilisateur** (`prefsSync`), comme les autres modes. Aucun
  nouveau champ de store.
- S'applique au stream courant (tous / non-lus / feed / catégorie / favoris /
  read-later / recherche).

## Layout (App.tsx)

La grille plein écran réutilise le **chemin 2-panneaux déjà existant** : « liste
pleine largeur → le volet de lecture la remplace quand un article est
sélectionné ».

- `gridMode = viewMode === 'grid'` force le même comportement que `is2Panel` :
  la section liste passe pleine largeur (flex 1), et le `ReadingPane` la remplace
  à la sélection d'un article.
- **Bénéfice** : la barre d'outils de la liste (recherche, view switcher, tout
  marquer lu, titre du stream) reste en place sans duplication ; le « lecteur
  overlay » n'est que le `ReadingPane` plein écran avec bouton retour déjà câblé
  (`showBack`).
- La sidebar reste visible (inchangée). Sur mobile, la grille s'insère dans le
  flux liste existant (pleine largeur) — le reader overlay est le même que
  l'actuel.

## La grille (rendu dans ArticleList)

Le **corps** rendu par `ArticleList` bascule selon `viewMode` :
liste verticale (preview/simple/compact) **ou** grille de cartes (`grid`).

- **CSS Grid pur, responsive sans JS** :
  - Desktop : `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`
    → 2 colonnes sur étroit jusqu'à 4-5 sur large.
  - Mobile : `minmax(160px, 1fr)` → 2 colonnes.
- **En-têtes de date conservés** (AUJOURD'HUI, HIER…) : bande pleine largeur,
  **une grille par groupe de date**. Respecte le réglage `showDateSeparators`
  existant.
- **Scroll infini** : réutilise le `loadMore` du store, comme la liste
  (même conteneur scrollable, même sentinelle de bas de liste).

## La carte (`ArticleCard.tsx`, nouveau composant)

- **Miniature 16:9** via `extractImageFromContent` (déjà existant).
- **Fallback sans image** : dégradé accent + favicon / initiale de la source +
  titre agrandi. Toutes les cartes ont la **même taille** → grille alignée.
- **Contenu** : source (uppercase, couleur accent) + favicon, titre (2 lignes,
  clamp), date (`timeAgo`), extrait court (2 lignes, clamp).
- **État non-lu** : accent visible (barre/point + titre en gras).
  **État lu** : atténué — cohérent avec la liste.
- **Actions au survol** : favori ★, read-later, marquer lu — **mêmes composants
  et handlers que la liste** (`StarButton`, `ReadLaterButton`, `toggleRead`).
- **Clic sur la carte** : `selectArticle(article)` → ouvre le lecteur overlay.

## Navigation clavier — À PRÉSERVER (exigence explicite)

Une fois dans l'article (lecteur overlay ouvert depuis la grille), **tous les
raccourcis clavier restent actifs**, exactement comme dans les modes liste :

- Flèches **suivant / précédent** (`selectNextArticle` / `selectPrevArticle`).
- ★ favori, marquer lu / non-lu, read-later, ouvrir l'original, toggle sidebar.
- **Esc** : ferme le lecteur overlay et **revient à la grille** (désélection),
  pile où on était.

Ces raccourcis sont gérés par le hook global `useKeyboardNav`, qui agit déjà sur
`store.articles` et `selectArticle` — **indépendant du layout**. Donc la
navigation flèche suivant/précédent fonctionne dans l'overlay **sans code
spécifique**. Seul ajout : câbler **Esc = désélection** quand l'overlay provient
de la grille (sans casser le comportement Esc du mode Reading Focus existant).

## i18n

Libellé du mode grille (`viewMode.grid`) ajouté dans **les 9 locales**
(`src/locales/*.json`), comme toute chaîne UI.

## TDD

Logique pure extraite et testée là où pertinent (ex. helper de fallback / calcul
d'affichage de la carte). Le gros du rendu réutilise la donnée et les handlers
existants → peu de logique nouvelle.

## Accessibilité / motion

- Cartes = éléments cliquables au clavier (`role="button"`, `tabIndex`, Enter),
  comme les lignes de liste.
- `prefers-reduced-motion` respecté (pas d'animation de survol agressive).

## Hors périmètre (YAGNI v1)

- Pas de masonry (hauteurs variables).
- Pas de taille de carte réglable.
- Pas de navigation flèche *dans la grille elle-même* avant ouverture (Esc +
  clic suffisent pour v1 ; la nav flèche s'applique une fois l'article ouvert).
- Pas de drag & drop de réorganisation dans la grille.

## Fichiers touchés

- `src/components/ArticleList/ViewModeSwitcher.tsx` — 4e segment `grid`.
- `src/components/ArticleList/ArticleList.tsx` — branche de rendu grille du corps.
- `src/components/ArticleList/ArticleCard.tsx` — **nouveau** composant carte.
- `src/App.tsx` — `gridMode` force le layout pleine largeur (chemin 2-panneaux).
- `src/hooks/useKeyboardNav.ts` — Esc = retour grille depuis l'overlay.
- `src/styles/index.css` — styles grille + carte + fallback.
- `src/locales/*.json` (×9) — `viewMode.grid`.
- Tests unitaires (`src/lib/*.test.ts`) pour la logique pure extraite.
