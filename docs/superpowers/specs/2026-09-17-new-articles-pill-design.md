# Pastille « nouveaux articles » — design

**Date** : 2026-09-17
**Statut** : approuvé (brainstorming)
**Origine** : discussion #14, « Frontend auto refresh? » (sebastien4). Il voudrait
des articles toujours à jour sans cliquer sur Rafraîchir.

## Le constat

- **FreshRSS relève les flux lui-même**, selon son cron ; FriRSS lit le résultat.
- **Les compteurs de non-lus sont relevés toutes les 60 s** (`syncCounts`,
  `App.tsx`) tant que l'application est ouverte.
- **La liste se recharge au retour sur l'onglet** (`silentRefresh`), jamais
  pendant qu'on la regarde : remplacer des lignes sous les yeux du lecteur est
  exactement ce que la règle actuelle évite.

Sur un onglet laissé ouvert, les compteurs montent donc et la liste ne bouge
pas. Rien ne dit qu'il y a du nouveau.

## Décisions du propriétaire

- **Une pastille « N nouveaux articles »** en haut de la liste ; un tap charge.
- **Toujours la pastille**, même liste tout en haut et aucun article ouvert :
  la liste ne change jamais d'elle-même.
- **Désactivable** dans Préférences → Général. Activée par défaut : elle
  signale, elle n'écrit rien (contrairement au marquage au défilement, éteint
  par défaut pour cette raison).
- **Pas pénible** : elle n'apparaît que quand il y a réellement du nouveau dans
  la vue affichée — FreshRSS relève en général toutes les 15 à 60 minutes, et
  jamais plus d'une fois par 20 minutes par flux —, glisse en place une seule
  fois, puis seul son nombre change.

## Ce qui change

### 1. Le signal

À chaque `syncCounts`, les compteurs reçus du serveur (après
`applyZeroFloor`) sont comparés, flux par flux, à ceux que le store connaissait
juste avant, par `computeRefreshDelta()` (`src/lib/refreshDelta.ts`, déjà
utilisé par le bandeau de relève). Seules les **hausses** de flux `feed/…`
comptent.

**Les actions locales ne déclenchent rien** : marquer un article non lu dans
FriRSS met le compteur local à jour de façon optimiste, le relevé suivant ne
voit donc aucune hausse.

**Limite assumée** : un article marqué non lu **sur un autre appareil** compte
comme une arrivée ; une arrivée et des lectures sur un autre appareil dans le
même intervalle, sur le même flux, peuvent s'annuler. Effet au pire : une
pastille inutile, ou une pastille qui attend le relevé suivant.

### 2. Les vues concernées

`viewFeedIds(vue, abonnements)` rend la liste des flux dont les arrivées
comptent, ou `null` quand la vue n'a pas de pastille :

| Vue | Flux comptés |
|---|---|
| un flux | ce flux |
| une catégorie (`isCategoryStreamId`) | les flux de cette catégorie |
| accueil (aucune sélection), filtre `all` ou `unread` | tous les abonnements |
| étiquette, Favoris, À lire plus tard | `null` |
| recherche en cours | `null` |

`countNewInView(newByFeed, flux)` additionne les hausses des flux de la vue.

**Premier relevé** : si le store ne connaît encore aucun compteur, rien n'est
compté — sinon tout le stock de non-lus passerait pour une arrivée.

### 3. Le compte

`feedStore.newInView` (nombre, 0 par défaut) :

- **s'accroît** à chaque `syncCounts` du nombre d'arrivées de la vue affichée ;
- **repart de zéro** dès que la liste est rechargée depuis le serveur :
  `loadArticles` (changement de vue, filtre, recherche, Rafraîchir), et la
  fin d'un `silentRefresh` réussi (retour sur l'onglet) ;
- `loadNewArticles()` : remet à zéro et appelle `loadArticles()`.

### 4. La pastille

`NewArticlesPill` (`src/components/ArticleList/`) :

- en haut de la liste, **collée au bord supérieur pendant le défilement**
  (`position: sticky`), centrée, dans toutes les dispositions — liste, côte à
  côte, grille — et sur téléphone ;
- texte « ↑ » + `refresh.newArticles` (clé existante, pluriels compris dans les
  10 langues) ;
- rendue seulement si `newInView > 0` **et** la préférence est active ;
- entrée animée une seule fois (glissement), aucune animation sous
  `prefers-reduced-motion` ; le nombre change ensuite sans ré-animation ;
- un bouton, dans une région `aria-live="polite"` ;
- au tap : `loadNewArticles()` puis la liste remonte en haut.

### 5. Le réglage

`uiStore.showNewArticlesPill` (booléen, **vrai** par défaut), persisté
(`frirss_showNewArticlesPill`) et synchronisé (`UI_SYNC_KEYS`, clés JSON
d'`applyServerPrefs`). Interrupteur **« Signaler les nouveaux articles »**
dans Préférences → Général, avec une ligne d'aide, sur le modèle de « Marquer
lu au défilement ». Deux clés nouvelles (`preferences.general.newArticlesPill`,
`newArticlesPillHint`) dans les **10** locales.

## Ce qui ne bouge pas

- Le bandeau de relève (`RefreshBanner`), notification de 5 s après
  Rafraîchir : c'est un autre objet.
- La cadence de `syncCounts` (60 s) et `silentRefresh` au retour d'onglet.
- La règle « la liste ne change pas sous les yeux du lecteur ».
- `settings-baseline.json` (232 réglages gelés).

## Structure

| Unité | Rôle |
|---|---|
| `src/lib/newArticles.ts` (nouveau) | `viewFeedIds`, `countNewInView` — pur, testé |
| `src/stores/feedStore.ts` | `newInView`, cumul dans `syncCounts`, remises à zéro, `loadNewArticles` |
| `src/stores/uiStore.ts` | `showNewArticlesPill`, synchronisation |
| `src/components/ArticleList/NewArticlesPill.tsx` (nouveau) | la pastille |
| `src/components/ArticleList/ArticleList.tsx` | montage, remontée en haut |
| `src/components/Preferences/GeneralTab.tsx` | l'interrupteur |
| `src/styles/index.css` | style de la pastille |
| `src/locales/*.json` | deux clés, 10 locales |

## Tests

- `viewFeedIds` : chaque ligne du tableau ; `countNewInView` : somme, flux hors
  vue ignorés, table vide.
- Store : un `syncCounts` avec hausse sur un flux de la vue incrémente ; hausse
  hors vue, baisse, et hausse venue d'une action locale n'incrémentent pas ;
  `selectView` / `loadArticles` et `loadNewArticles` remettent à zéro.
- Pastille : absente à 0, libellé au pluriel, tap → action ; préférence
  désactivée → absente.
- Réglage : persistance et synchronisation.

Vérification réelle : la pastille à **320 px**, sur tablette et desktop, en
liste et en grille, thème clair et sombre.

## Hors périmètre

Chargement automatique en haut de liste (refusé) ; notifications système ;
changement de la cadence de relève ; relève côté FreshRSS.
