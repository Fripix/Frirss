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

## Complément — revue finale (2026-09-17)

Trois défauts et deux points mineurs relevés à la revue finale du premier
passage d'implémentation.

**Fix 1 — recherche.** `search()` ne remettait pas `newInView` à zéro : une
pastille affichée avant une recherche restait visible au-dessus des
résultats, et un clic rechargeait le flux normal (`loadArticles`) pendant
qu'une recherche restait active. `search()` remet maintenant `newInView` à
zéro dès qu'elle démarre, et `ArticleList` force le compte à 0 tant que
`searchQuery` est renseigné (double garde : la remise à zéro couvre le
démarrage, le forçage couvre toute la durée de la recherche).

**Fix 2 — un relevé en vol ne doit jamais compter les écritures de l'app.**
`syncCounts` lit les compteurs serveur APRÈS un aller-retour réseau ; toute
écriture locale de `unreadCounts` pendant ce vol (✓, tout marquer lu, une
nouvelle vue) y ressemblait à une arrivée. Garde ajoutée :
- `countsEpoch` (module-level, incrémenté à chaque écriture locale
  recensée) : `syncCounts` compare sa valeur avant/après son attente réseau.
- Aucune arrivée comptée si : l'epoch a changé, un ✓/non-lu était encore EN
  VOL au démarrage du relevé (`readWritesInFlight`, voir Important 1
  ci-dessous), un rejeu hors-ligne (`replayInFlight`) est en cours, un
  rafraîchissement manuel tourne (`refreshPhase === 'running'`), ou
  `skipNextArrivals` est vrai.
- `skipNextArrivals` : posé (a) par `enqueueAction`, dès qu'une action rejoint
  la file hors-ligne, et (b) par `replayQueue` quand elle abandonne au moins
  une action — refusée par le serveur OU rejetée après trop d'échecs, les
  deux cas tombent dans `failed` côté `replayQueue`. Dans les deux cas, le ✓
  local ne correspond à rien côté serveur pour le relevé qui suit ; consommé
  (remis à faux) par le PROCHAIN RELEVÉ RÉUSSI seulement — un relevé qui
  échoue (exception avant la ligne qui le consomme) le laisse posé, sans quoi
  l'arrivée resterait masquée pour rien à la panne suivante.
- Plancher zéro (`zeroUnreadFloor`) : les flux dont le plancher expire
  pendant l'appel à `applyZeroFloor` sont notés dans un `Set` module-level et
  exclus du décompte d'arrivées de ce relevé (ils sautent de 0 au compte
  réel, ce qui n'est pas une arrivée) ; le `Set` est vidé après usage, y
  compris quand `applyZeroFloor` est appelé par `loadSubscriptions` (rien
  d'autre que `syncCounts` ne le consommerait) et lors d'un changement de
  serveur (`resetAndReload`, et le retour anticipé de `syncCounts` pour Fix 3).
- Les compteurs eux-mêmes (`unreadCounts`) sont toujours appliqués — seul le
  décompte de la pastille est retenu. Une arrivée manquée par ces gardes se
  voit donc au prochain rechargement, jamais perdue.

*Corrigé au contrôle du 2026-09-17* : `pendingActions > 0` faisait initialement
partie de la garde. Retiré — `replayQueue` ne tourne qu'au montage de l'app et
sur l'événement `online` (`App.tsx`), donc une seule action mise en file (un
5xx transitoire, par exemple) aurait masqué la pastille pour toute la session,
bien après que le relevé SUIVANT ait déjà écrasé le compte local par celui du
serveur. `skipNextArrivals`, posé au moment de la mise en file plutôt qu'à
celui de son abandon, couvre exactement ce cas sans ce défaut : un seul relevé
l'ignore, le suivant redétecte normalement une vraie hausse.

**Important 1 (deuxième re-revue, 2026-09-17) — une écriture ✓/non-lu encore
en vol.** `countsEpoch` était bumpé à l'écriture LOCALE optimiste
(`selectArticle`, `toggleRead`), avant l'appel réseau — pas à son règlement.
Un relevé qui démarre APRÈS ce bump, alors que `markAsRead`/`markAsUnread`
n'a pas encore atteint FreshRSS, capture donc un epoch déjà à jour : la
comparaison avant/après de `syncCounts` n'y voit aucun écart, alors que le
compte local a déjà bougé et que le serveur répond encore avec l'ancien.
`markAllAsRead` n'est pas concerné : elle n'écrit `unreadCounts` qu'APRÈS la
confirmation du serveur, jamais avant.
- `readWritesInFlight` (module-level, compteur) : incrémenté juste avant
  l'appel à `markAsRead`/`markAsUnread` dans `selectArticle` et `toggleRead`
  (les deux seuls sites hors `replayQueue`, déjà couvert par
  `replayInFlight`), décrémenté dans un `finally` — succès ou échec — qui
  bumpe aussi `countsEpoch` (le règlement PENDANT le vol du relevé reste
  couvert par la comparaison d'epoch existante).
- `syncCounts` capture `readWritesInFlight > 0` AVANT sa propre attente
  réseau ; si vrai, ce relevé ne compte aucune arrivée — que l'écriture se
  règle avant, pendant ou après son propre aller-retour.

**Fix 3 — changement de serveur.** Couvert par la même fonction : si
`activeServerId` a changé entre le départ de la requête et sa réponse,
`syncCounts` retourne sans rien toucher — ni `unreadCounts`, ni `newInView`.
Un relevé du serveur qu'on vient de quitter décrirait un monde qui n'est
plus le nôtre.

**M1 — focus au clic.** Le bouton de la pastille disparaît avec le clic ; le
focus clavier retombait sur `<body>`. La liste (`listRef`) reçoit
`tabIndex={-1}` (elle n'entre donc jamais dans l'ordre de tabulation normal)
et reçoit le focus programmatique (`{ preventScroll: true }`, le `scrollTo`
suivant fait déjà remonter la vue) juste après `loadNewArticles()`.

**M2 — `silentRefresh` et un changement de vue en vol.** La vue affichée est
retenue avant la requête (`viewKey`, comme `loadArticles` avec `sameView()`).
Si elle a changé au retour de la requête, le résultat est jeté : ni
`articles` ni `newInView` ne sont écrits pour une vue qui n'est plus à
l'écran.

**M6 — réglage désactivé, testé au niveau composant.** `NewArticlesPill`
prend désormais un prop `enabled` et ne rend RIEN quand il est faux — pas
même la région `aria-live`, pour ne pas laisser un lecteur d'écran annoncer
un décompte que le réglage a coupé. `ArticleList` la monte
inconditionnellement (`<NewArticlesPill enabled={showNewArticlesPill} …/>`)
au lieu de la conditionner par `&&`.

## Hors périmètre

Chargement automatique en haut de liste (refusé) ; notifications système ;
changement de la cadence de relève ; relève côté FreshRSS.
