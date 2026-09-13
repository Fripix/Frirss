# Menu contextuel d'un article — design

**Date** : 2026-09-13
**Statut** : approuvé (brainstorming)
**Origine** : issue #11, commentaire de Snake883 (2026-09-10) : « Any chance of
being able to right click on an article, and open in new browser tab? I still
have motor memory from using FreshRSS. » L'icône « Ouvrir à la source » existe
depuis la 1.4.x ; il manque le geste.

## Le constat

- **Une ligne d'article n'est pas un lien** : `ArticleRow` (lignes normale et
  compacte, `ArticleList.tsx`) et `ArticleCard` (grille) sont des
  `div role="button" draggable`. Le menu du navigateur n'a donc rien à proposer.
- **Aucun `onContextMenu` sur les lignes.** Le seul existant vit sur les boutons
  Favori et À lire plus tard (`useFileGesture`, `ArticleActions.tsx`), où clic
  droit et appui long ouvrent le rangement par catégorie.
- **Le menu des flux** (`FeedContextMenu`, `Sidebar.tsx`) n'est pas réutilisable
  tel quel, mais ses briques le sont : `clampToViewport()`, fermeture sur
  `pointerdown` extérieur (pas `mousedown` : iOS ne l'émet pas avant le clic),
  appui long de 500 ms annulé au mouvement, clic final avalé, suppression de la
  sélection iOS (`-webkit-touch-callout: none` ET `user-select: none`).
- **« Ouvrir à la source »** passe par `openArticleAtSource()` : `openExternal()`
  (`window.open(url, '_blank', 'noopener')`) puis `selectArticle()` — l'article
  est marqué lu et garde sa place.

## Décisions du propriétaire

- **Un menu maison, pas le menu du navigateur** : il peut marquer lu et reste
  cohérent avec le menu des flux, sans toucher à la structure des lignes.
- **Menu complet** : ouvrir à la source, lu / non lu, favori, à lire plus tard,
  copier le lien.
- **Au doigt : appui long**, présenté en **feuille du bas sur téléphone**, menu
  flottant sur tablette et desktop.
- **Clic molette** sur une ligne : ouvre directement à la source.

## Ce qui change

### 1. Où

Ligne normale, ligne compacte, carte de la grille. **Pas** dans le volet de
lecture.

### 2. Ouverture

- **Clic droit** (`contextmenu`) sur la ligne : `preventDefault()`, menu au
  curseur.
  - **Le clic droit des boutons Favori et À lire plus tard reste prioritaire** :
    leur gestionnaire appelle déjà `preventDefault()` ; le gestionnaire de la
    ligne sort si `e.defaultPrevented`. Les boutons ne sont pas modifiés.
  - **Touche Menu / Maj+F10** : le navigateur émet `contextmenu` sur l'élément
    focalisé avec `clientX = clientY = 0` ; le menu se place alors sur la ligne
    (coin bas-gauche de son rectangle), pas au coin de la fenêtre.
- **Appui long de 500 ms** au doigt (`touchstart`), annulé par `touchmove` et
  `touchend` — un défilement ou un balayage de ligne (`SwipeableArticleRow`, qui
  écoute `touchmove` en natif) annule donc l'appui. Le clic qui termine un appui
  abouti est avalé : il n'ouvre pas l'article.
  - **Piège** : Chrome Android émet aussi `contextmenu` sur appui long. Si l'appui
    long vient d'ouvrir le menu, ce `contextmenu` est absorbé
    (`preventDefault()`) sans rouvrir le menu.
  - Sous `@media (hover: none)`, les lignes et cartes reçoivent
    `-webkit-touch-callout: none; user-select: none;` (les deux, comme
    `.sidebar-feed-item`). Le bureau garde la sélection de texte.
- **Clic molette** : `onMouseDown` avec `button === 1` → `preventDefault()`
  (évite le défilement automatique Windows/Linux) ; `onAuxClick` avec
  `button === 1` → `openArticleAtSource()`, exactement comme l'icône. Sans URL,
  rien.
- Ouvrir le menu **ne sélectionne pas** l'article.

### 3. Présentation

- `useBreakpoint() === 'mobile'` → `BottomSheet` titrée avec le titre de
  l'article, rangées ≥ 44 pt.
- Sinon → menu flottant `position: fixed` au point d'ouverture, replacé par
  `clampToViewport()` après mesure. Un iPad au trackpad reçoit donc le menu
  flottant : le choix suit le format, pas le pointeur.
- Fermeture : après chaque action, `pointerdown` à l'extérieur, Échap, et
  changement de vue.

### 4. Entrées, dans l'ordre

| # | Entrée | Condition / libellé | Action |
|---|---|---|---|
| 1 | Ouvrir à la source | absente si l'article n'a pas d'URL | `openArticleAtSource(article, selectArticleAtSource)` |
| 2 | Marquer lu / Marquer non lu | selon `article.read` | `toggleRead(article)` — même effet que le ✓, retrait sous « Non lus » compris |
| 3 | Ajouter aux favoris / Retirer des favoris | selon `article.starred` | `toggleStar(article)` |
| 4 | À lire plus tard / Retirer de À lire plus tard | selon le libellé lecture différée | `toggleReadLater(article)` |
| 5 | Copier le lien | absente sans URL | presse-papiers + toast `toast.linkCopied` ; échec → `toast.copyFailed` (ton erreur) |

- Libellés : réutiliser `articleRow.openSource`, `markRead`, `markUnread`,
  `addStar`, `removeStar`, `addReadLater`, `removeReadLater`. **Seule chaîne
  nouvelle** : `articleRow.copyLink`, dans les **10** locales.
- **« Copier le lien » copie toujours**, même là où `navigator.share` existe :
  l'entrée dit « copier ». Le partage reste dans le volet de lecture.
- Les actions passent par les fonctions du store existantes : file hors ligne et
  retour arrière en cas de refus serveur restent ceux d'aujourd'hui.

## Structure

| Unité | Rôle |
|---|---|
| `src/lib/articleMenu.ts` (nouveau) | `articleMenuItems(article)` → liste ordonnée `{ kind, labelKey }` ; `menuAnchor(event, rect)` → point d'ouverture (curseur, ou ligne si ouverture clavier) |
| `src/lib/copyLink.ts` (nouveau) | `copyLink(url, clipboard?)` → `'copied' \| 'failed'`, sans dépendance à l'interface |
| `src/hooks/useLongPress.ts` (nouveau) | appui long 500 ms au doigt : `onTouchStart`, `onTouchMove`, `onTouchEnd`, `onClickCapture` (clic avalé), `firedRecently()` pour le piège Android |
| `src/components/ArticleList/ArticleContextMenu.tsx` (nouveau) | rendu : `BottomSheet` sur téléphone, menu flottant ailleurs ; exécute les actions ; se ferme |
| `ArticleList.tsx` (`ArticleRow`, grille), `ArticleCard.tsx` | branchement : clic droit, appui long, clic molette ; un seul état de menu au niveau de la liste |
| `src/styles/index.css` | suppression de la sélection iOS sous `(hover: none)` |

- **`useLongPress` ne remplace pas** l'appui long des flux ni `useFileGesture` :
  ils fonctionnent et viennent d'être validés sur appareil. Troisième
  implémentation assumée ; unification au backlog.
- **Pas de `role="menu"`** : aucun menu de l'application ne l'a, et ce rôle
  exigerait la navigation aux flèches. Boutons simples, comme `FeedContextMenu`.

## Tests

Logique pure d'abord, testée avant d'être écrite :

- `articleMenuItems` : ordre ; libellés selon lu / favori / lecture différée ;
  entrées 1 et 5 absentes sans URL (et URL faite d'espaces).
- `menuAnchor` : curseur quand `clientX/clientY` non nuls ; bas-gauche du
  rectangle de la ligne quand ils valent 0.
- `copyLink` : succès ; `clipboard` absent ; `writeText` qui rejette.
- `useLongPress` (minuteries simulées, sur le modèle de
  `FeedItem.longpress.test.tsx`) : déclenche à 500 ms ; `touchmove` ou
  `touchend` avant annule ; le clic après un appui abouti est avalé, un clic
  ordinaire passe.
- `ArticleContextMenu` (Testing Library) : entrées selon l'état ; clic sur une
  entrée → action appelée puis fermeture ; Échap ferme ; `BottomSheet` sur
  téléphone.
- Lignes : `contextmenu` déjà `defaultPrevented` (bouton Favori) n'ouvre pas le
  menu ; clic molette → ouverture à la source ; clic gauche inchangé.

Les tests existants ne sont pas modifiés. Vérification réelle : desktop,
tablette et téléphone à **320 px** (feuille du bas), thème clair et sombre.
**L'appui long sur un vrai iPhone ne peut être confirmé que par le
propriétaire** — le dire, ne pas le déclarer vérifié.

## Documentation

`docs/FEATURES.md` (Liste d'articles : nouvelle entrée, avec le piège de
priorité du clic droit des boutons et celui de Chrome Android) et
`docs/RELEASE-NEXT.md` dans le commit qui livre la fonctionnalité.

## Hors périmètre

Navigation aux flèches dans le menu (au backlog, commune à tous les menus) ;
menu dans le volet de lecture ; réécriture du « Copier le lien » du volet de
lecture ; unification des trois appuis longs.
