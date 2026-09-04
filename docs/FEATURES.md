# FriRSS — inventaire des fonctionnalités

**Ce fichier est la mémoire du projet.** Il recense tout ce que FriRSS sait
faire, où chaque chose vit dans le code, et les pièges qui ont déjà coûté du
temps. Il sert deux usages : éviter de casser ou de réinventer une
fonctionnalité existante, et servir de source à la documentation utilisateur.

**À mettre à jour dans le même commit que toute fonctionnalité ajoutée,
retirée ou modifiée.** `src/lib/featuresDoc.test.ts` échoue si une route
serveur, une variable d'environnement ou une famille de traductions n'est pas
mentionnée ici.

> **Ce que le test ne peut pas voir** : il attrape les **oublis d'ajout**, pas
> les descriptions devenues fausses. Une fonctionnalité dont le comportement
> change sans changer de route ni de clé i18n passera au travers. La prose reste
> sous responsabilité humaine.

---

## Architecture en bref

Frontend React 18 + Vite, servi par nginx. Backend Express + SQLite
(`better-sqlite3`), compilé par `tsc` vers `server-dist/`. Une seule image
Docker embarque les deux. Tous les appels à FreshRSS passent par le proxy
backend `/api/proxy` — même origine, donc pas de CORS, et les jetons ne
touchent jamais le navigateur.

FriRSS ne stocke aucun article : la source de vérité reste FreshRSS, interrogée
via son **API Google Reader**. La base SQLite ne contient que des comptes, des
connexions serveur et des préférences (~68 Ko).

---

## Authentification et comptes

### Comptes FriRSS
Comptes locaux avec mot de passe, session par JWT conservé en `localStorage`
(décision documentée dans `SECURITY.md`). Le premier compte créé devient
administrateur.

- **Où** : `server/routes/auth.ts`, `src/components/Login/Login.tsx`, `src/stores/authStore.ts`
- **Réglages** : inscriptions ouvertes/fermées (Préférences → Administration)
- **Fermée par défaut** : depuis la 1.4.4, une instance neuve refuse les
  inscriptions. Le **premier** compte reste toujours autorisé (`count === 0` est
  exempté), sans quoi une instance neuve serait inaccessible à son propre
  installateur ; les suivants demandent un geste explicite de l'administrateur.
  Le défaut précédent (`true`) laissait n'importe qui créer un compte sur une
  instance neuve exposée publiquement — et un compte est ce qui donne accès au
  proxy sortant.
- **Piège** : `INSERT OR IGNORE` sur `settings` — changer ce défaut ne touche que
  les bases **neuves**. Une instance existante garde la valeur enregistrée, ce
  qui est le comportement voulu : personne ne se fait fermer la porte par une
  mise à jour.
- **Piège — un 401 ne dit pas de quelle couche il vient.** Le compte FriRSS et
  le serveur FreshRSS rattaché sont deux authentifications indépendantes, et le
  proxy relaie le statut amont tel quel. L'intercepteur de `src/api/client.ts`
  ne déconnecte donc que sur les 401 de **notre** middleware, reconnus par
  `isBackendAuthFailure` (`src/lib/loginErrors.ts`) — voir « Serveurs
  FreshRSS ».

### SSO / OIDC
Connexion par fournisseur OIDC en complément des comptes locaux, ou **à la place**
(mode « SSO uniquement »), auquel cas le formulaire local est masqué.

- **Où** : `server/oidc.ts`, `server/routes/auth.ts` (`/oidc/*`), `src/lib/shouldHideLocalLogin.ts`
- **Spec** : `docs/superpowers/specs/2026-08-15-sso-only-mode-design.md`
- **Piège** : une URL « break-glass » permet de revenir au formulaire local si le
  SSO tombe. Sans elle, un OIDC cassé enferme dehors l'administrateur.

### Écran de connexion
Trois étapes : compte FriRSS, puis serveur FreshRSS, puis identifiants FreshRSS.
Animation de connexion configurable (aucune / portail / scanline).

- **Où** : `src/components/Login/` (`Login.tsx`, `LoginTransition.tsx`, `MatrixRain.tsx`)
- **Voir le mot de passe** (1.4.5) : la bascule vit dans le composant partagé
  `InputField`, donc les quatre champs de mot de passe de l'écran l'ont d'un
  coup. `aria-pressed` porte l'état.
- **Copie** (1.4.5) : en mode connexion, le sous-titre disait « Connexion »
  entre « Bienvenue sur FriRSS » et le bouton « Se connecter » — trois fois la
  même chose, dont deux inutiles. Il dit maintenant ce que l'application EST
  (`login.tagline`). En inscription et en restauration le sous-titre portait
  une vraie information : il la garde. `login.loginTitle` est devenue morte et
  a été retirée des 9 locales — `i18nCoverage.test.ts` l'a signalée.
- **Pas fait** : la composition en deux colonnes sur grand écran, proposée par
  la revue d'interface. La branche de restauration est imbriquée dans le même
  bloc d'en-tête que le titre, donc la refonte les emporterait ensemble ; à
  reprendre avec cette contrainte en tête.

---

## Serveurs FreshRSS

Plusieurs connexions FreshRSS par utilisateur, avec un serveur par défaut et un
basculement rapide. Le jeton greader est **chiffré en base** (AES-256-GCM) et
injecté côté serveur par le proxy ; il n'atteint jamais le navigateur.

- **Où** : `server/routes/servers.ts`, `server/crypto.ts`,
  `src/components/Preferences/servers/` (gestion complète),
  `src/components/ServerSwitcher/` (sélecteur), `src/lib/serverList.ts`
  (logique partagée).
- **Portée du jeton — piège** : le proxy n'attache le jeton greader qu'aux
  cibles dont l'**origine analysée** vaut celle du serveur, le chemin étant
  comparé avec une frontière explicite (`targetBelongsToServer`,
  `server/routes/proxy.ts`). Une comparaison par préfixe de chaîne — ce
  qu'elle était jusqu'à la 1.4.4 — acceptait `https://serveur.tld.tiers.tld/`
  et `https://serveur.tld@tiers.tld/`, deux hôtes étrangers. Ce n'est pas
  théorique : les URL d'images d'articles et de favicons viennent du **contenu
  des flux**, et `src/api/client.ts` attache `X-Server-Id` à toutes ses
  requêtes sans distinction — celui qui publie un flux choisit donc la cible.

- **Échec du rattachement — ce que l'écran a le droit de dire** :
  `serverConnectErrorKey()` (`src/lib/loginErrors.ts`) ne nomme que les causes
  réellement vérifiées, et rien d'autre :
  - **403 + `Target host not allowed`** → notre garde anti-SSRF a refusé une
    cible privée ; le message renvoie à `PROXY_INTERNAL_HOSTS`.
  - **401 qui n'est pas l'un des nôtres** → FreshRSS a refusé les identifiants ;
    le message rappelle que le mot de passe d'**API** se définit à part de celui
    du compte. `greader.php` répond le même 401 `Unauthorized!` pour un mot de
    passe faux **et** pour un mot de passe d'API jamais défini : le message
    couvre donc les deux.
  - Tout le reste — hôte injoignable, coupure réseau, et le 400 d'un nom
    d'utilisateur inconnu — garde le générique `login.errorServer`. Ce 400 est
    partagé avec notre propre « cible absente » : deux causes, un statut, donc
    aucune nommée.
  - **Pourquoi** : le proxy relaie le **statut amont tel quel**, donc un 403 peut
    aussi bien venir de FreshRSS que de nous ; seul le corps distingue les deux.
    Avant la 1.4.6, le `catch` de `Login.tsx` jetait l'erreur sans la lire et
    affichait « connexion impossible » pour tout. Héberger FreshRSS sur une IP
    privée — le cas majoritaire — produisait donc le message le moins
    exploitable, sans jamais mentionner la variable qui débloque (issue #8).
  - **Piège** : le marqueur est écrit des deux côtés d'une frontière que le
    typage ne traverse pas. `loginErrors.test.ts` relit `server/routes/proxy.ts`
    pour vérifier qu'il correspond encore ; sans lui, une reformulation côté
    serveur ferait repasser l'écran au message générique **en silence**, sans
    qu'aucun test de comportement ne rougisse.
  - **Le tri des 401 se fait par exclusion, et c'est délibéré.** `/api/proxy`
    répond aussi 401 quand le JWT **FriRSS** a expiré, avant même de joindre
    FreshRSS. On écarte donc les nôtres (`BACKEND_AUTH_MARKERS`) au lieu de
    reconnaître ceux de FreshRSS : nos messages vivent dans ce dépôt et sont
    vérifiables contre la dérive, ceux de FreshRSS non. Un quatrième message
    ajouté à `server/middleware/auth.ts` sans être listé ferait accuser le mot
    de passe de l'utilisateur alors que sa session a simplement expiré —
    `loginErrors.test.ts` relit le middleware et rougit dans ce cas.
  - **Pas de déconnexion parasite**, à deux verrous. `src/api/auth.ts` utilise
    **axios nu**, pas le client de `src/api/client.ts` : le rattachement d'un
    serveur ne passe donc pas du tout par l'intercepteur. Et depuis la 1.4.8,
    cet intercepteur ne déconnecte plus sur **tout** 401 : il n'agit que sur
    les nôtres (`isBackendAuthFailure`, même `BACKEND_AUTH_MARKERS`). Un 401 de
    FreshRSS — session expirée là-bas, mot de passe d'API changé — traversait
    tout le reste de l'application (listes, favicons, extraction) et fermait la
    session FriRSS : une panne d'une couche déconnectait de l'autre. Un corps
    illisible (`responseType` binaire des images) n'est **pas** attribué à
    FriRSS : ne rien affirmer coûte une requête en erreur, se tromper coûte la
    session.
  - **Les deux sites d'appel comptent** : `Login.tsx` (première connexion) et
    `AddServerDialog.tsx` (Préférences → ajouter un serveur) mènent au même
    échec et partagent la fonction.

- **Deux endroits, un seul complet** : Préférences → Flux liste les serveurs et
  porte toutes les actions — basculer, ajouter, renommer, définir par défaut,
  supprimer, et le jeton maître de chaque serveur. La barre du haut ne fait que
  basculer ; son `+` et son clic droit sont des raccourcis vers Préférences,
  ils n'exécutent rien.
- **Jeton par serveur** : le jeton maître se configure et s'éprouve depuis la
  ligne de n'importe quel serveur, sans y basculer — les routes sont adressées
  par `/:id`. Le drapeau global `hasRefreshToken` ne décrit que le serveur
  actif : `RefreshTokenField` ne l'écrit que depuis la ligne de celui-ci.
- **Affichage immédiat, revalidation derrière** : la liste s'affiche dès que des
  serveurs sont déjà en mémoire (`shouldShowServerList()` dans
  `src/lib/serverList.ts`), et le rechargement court en arrière-plan. Le
  squelette ne sert plus qu'au démarrage à froid — indispensable, car
  `displayServers()` fabrique une ligne synthétique à partir de `serverUrl`
  quand la liste est vide : rendue trop tôt, elle se ferait passer pour un
  compte hérité et une panne réseau affirmerait que l'utilisateur n'a qu'un
  serveur ingérable. Un échec de chargement se dit toujours, même quand des
  données connues restent affichées.
- **Piège corrigé le 2026-08-26** : la gestion vivait uniquement dans
  `ServerSwitcher`, qui ne se monte que si la barre du haut est visible — la
  masquer emportait la bascule avec elle. Pire, renommer, définir par défaut et
  supprimer passaient par `onContextMenu`, que Safari iOS n'émet pas : trois
  actions sur cinq n'existaient pas dans la PWA installée.
- **Piège subsistant** : la connexion FreshRSS sans enregistrement en base
  (première connexion, comptes anciens) s'affiche en entrée synthétique, en
  lecture seule et non dépliable. Elle n'a pas d'identifiant en base : aucune
  action de gestion ne peut la viser.

---

## Navigation et mise en page

### Barre latérale
Catégories repliables, flux avec favicon et compteur de non-lus, entrées fixes
(Tous, Non lus, Favoris, À lire plus tard), étiquettes, réordonnancement par
glisser-déposer, masquage des flux entièrement lus.

- **Où** : `src/components/Sidebar/Sidebar.tsx`, `src/stores/uiStore.ts`
- **Liens du pied** (1.4.5) : étoile GitHub et soutien (BuyMeACoffee), à côté
  de l'engrenage des préférences. Discrets (opacité 0,4), éclairés au survol :
  c'est une application qu'on ouvre vingt fois par jour, un appel au soutien
  visible en permanence y deviendrait pesant.
  - **Une rangée séparée a été essayée puis abandonnée** : mal placée. Les deux
    liens sont revenus dans le pied.
  - **Le libellé cède, les icônes non.** À la largeur minimale (160 px), trois
    icônes et « Se déconnecter » ne tiennent pas ensemble et l'engrenage
    sortait du cadre : le texte est tronqué (`truncate min-w-0`) et les icônes
    portent `flex-shrink-0`. À la largeur par défaut, tout tient.
  - La règle de 44 pt du pied mobile vise `button` **et `a`** : ces liens sont
    des ancres, et la règle les laissait à 27 px au doigt.
  - **Pas de lien « proposer une idée » dans l'application** — essayé, retiré.
    Les modèles d'issue restent sur GitHub (`.github/ISSUE_TEMPLATE/` :
    rapport de bug, idée, plus des liens vers les discussions FreshRSS et le
    signalement privé de vulnérabilité) et servent à qui ouvre une issue
    depuis le dépôt.

### Dispositions
Trois colonnes, deux colonnes (liste seule), ou **grille**. La disposition est
globale, mais surchargeable **par flux**.

- **Où** : `src/lib/effectiveLayout.ts` — toujours résoudre par `effectiveLayout()`
  (surcharge du flux ?? global), jamais en lisant `panelLayout` directement
- **Spec** : `docs/superpowers/specs/2026-08-18-grid-view-design.md`

### Adaptation aux formats
`useBreakpoint()` renvoie `mobile` / `tablet` / `desktop`. Sur mobile, navigation
par onglets et pile de vues ; un basculement manuel permet à une tablette
d'adopter la disposition mobile.

- **Où** : `src/hooks/useBreakpoint.ts`, `src/components/MobileDrawer.tsx`, `src/components/MobileStack.tsx`
- **Règle** : conditionner le **survol** à `(hover: hover)`, jamais à la largeur —
  une tablette avec trackpad est un pointeur fin. Cibles tactiles ≥ 44 pt.

### Raccourcis clavier
Navigation et actions au clavier, chaque raccourci réassignable. Gestes intégrés
non réassignables : `ESC`, double-clic (mode Focus), clic prolongé (ranger).

- **Où** : `src/hooks/useKeyboardNav.ts`, `src/components/ShortcutBar.tsx`,
  `src/components/ShortcutHelp.tsx`, Préférences → Général
- **Barre du bas** : les deux entrées globales — palette (⌘K / Ctrl+K) et
  aide-mémoire (`?`) — sont poussées à droite derrière un séparateur et leur
  touche est en accent. Elles ne sont ni réassignables ni contextuelles,
  contrairement à tout ce qui les précède, et les mélanger le laisserait
  croire. Le libellé de la touche suit le clavier (`src/lib/platformKeys.ts`) :
  nommer ⌘ sur une machine qui n'a pas cette touche est la pire des deux
  erreurs.
- **Aide-mémoire sur `?`** (1.4.5) : fenêtre listant **tous** les raccourcis
  configurables avec les touches **réellement configurées**, plus les gestes
  intégrés dans une section à part — les mélanger laisserait croire qu'on peut
  les réassigner. Les libellés sont ceux de la section « Gestes et touches
  intégrés » des Préférences : les mêmes gestes, donc les mêmes chaînes, sinon
  les deux écrans divergent. `?` est traité **avant** les raccourcis
  configurables, sans quoi on pourrait le masquer en l'attribuant à une action.
  Échap y est capté en phase de capture, pour passer avant le gestionnaire
  global qui s'en sert pour quitter le mode Focus.

---

## Liste d'articles

Affichage compact inspiré de GoodRead : source en accent, titre, résumé sur deux
lignes, barre verticale pour les non-lus. Scroll infini paginé. En-têtes de
groupe par date. Trois densités (Aperçu / Standard / Compact) et le mode grille.

- **Où** : `src/components/ArticleList/`
- **Menus du format mobile** : `src/components/BottomSheet.tsx`. Le motif
  existait — le menu d'étiquettes du volet de lecture le posait à la main —
  mais les menus d'options s'ouvraient en liste ancrée sous leur icône, donc en
  **haut** de l'écran, hors de portée du pouce, avec des rangées de 13 px. Une
  seule implémentation, utilisée par les trois (options de liste, menu « ⋯ » du
  volet, étiquettes).
- **Bascules d'affichage groupées** : nom du flux, icônes des flux, séparateurs
  de date et barre serveur vivent dans une même piste (`.option-track`), comme
  la densité et la disposition en avaient déjà une. Leur état actif passe par
  la **seule couleur de l'icône** : le fond `--accent-glow` d'origine ressortait
  beaucoup plus sur le nouvel en-tête tiède que sur l'ancien blanc froid, et
  pesait plus que l'information ne le mérite.
- **Favicon du flux dans la ligne** (1.4.5) : `src/components/FeedFavicon.tsx`,
  extrait de la barre latérale où il ne servait qu'elle. La source n'était
  qu'un mot en majuscules de 10 px : repérer un flux dans une vue Tous les flux
  demandait de lire au lieu de reconnaître. Suit le réglage `showFavicons`
  existant. `ArticleList` construit une **carte** `sourceId → iconUrl` plutôt
  qu'un `find()` par ligne. **Pas dans la grille** : la carte a déjà sa
  vignette et son repli lettre, un favicon y ferait doublon.
- **En-tête** : titre à 15-16 px (il était à 14 px, noyé au milieu de huit
  icônes de même poids) et compte de non-lus de la vue à côté. Le compte n'est
  affiché que pour un flux et pour « tous les flux » : favoris, à lire plus
  tard et catégories sont des sélections transversales, un compte y voudrait
  dire autre chose.
- **Séparateurs de date** : 11 px sur `--list-summary` (ils étaient à 10 px
  dans le gris le plus clair de la palette) et suivis du nombre d'articles du
  jour. Ce sont les seuls repères de progression d'un scroll infini.
  **Chaque libellé porte une date**, pas seulement un mot : « MERCREDI » seul
  ne dit pas de quel mercredi il s'agit, et « Aujourd'hui » devient faux dès
  qu'on laisse l'onglet ouvert une nuit. Format : `AUJOURD'HUI · 31 AOÛT`.
- **Apparition échelonnée** : les dix premières lignes se déposent avec 25 ms
  d'écart (`data-stagger`). La décision revient à `staggerIndexes()`
  (`src/lib/rowStagger.ts`) : **la position ne sert qu'à ATTRIBUER un retard,
  une seule fois, à une ligne jamais rendue**. Ce qui a déjà été attribué ne
  bouge plus (une ligne en pleine animation ne doit pas perdre `data-stagger`
  au rendu suivant : elle sauterait à son état final), et ce qui a été rendu
  sans retard n'en reçoit jamais. La liste garde cette mémoire dans une ref
  (`rememberStagger`), remise à zéro à chaque changement de vue (flux, filtre,
  recherche) pour qu'y entrer anime toujours ses lignes. **Jamais sur le scroll infini** — une page ajoutée en bas arrive
  au-delà du seuil, et ses lignes ne sont de toute façon rendues qu'une fois.
  **Piège** : la règle portait d'abord sur la seule position. Depuis que le ✓
  retire une ligne (issue #10), tout ce qui la suit remonte d'un cran : la
  onzième ligne devenait la dixième, franchissait le seuil pour la première
  fois et rejouait l'animation d'entrée (`opacity: 0 → 1`, `fill: both`) alors
  qu'elle n'avait jamais quitté l'écran — un article clignotait à chaque clic.
  Le suivi des identifiants vus est mis à jour dans un effet, **jamais pendant
  le rendu** : un double rendu (StrictMode) verrait sinon toutes les lignes
  comme déjà vues dès la première peinture, et plus rien ne s'animerait.
  **Second piège, même symptôme** : la clé de rendu d'une bande de date valait
  `${label}-${index}`. Vider une bande — marquer lu le dernier article
  d'« Aujourd'hui » — décalait l'index de toutes les suivantes, donc leur clé :
  React démontait puis remontait leurs sous-arbres entiers, et les lignes
  remontées, portant encore `data-stagger`, rejouaient leur animation sur des
  nœuds neufs. Jusqu'à dix lignes clignotaient d'un coup. La clé vient
  désormais de `DateGroup.key` (`src/utils/dates.ts`), **indépendante de la
  position** : le libellé, complété de l'identifiant du premier article quand
  un même jour rouvre une bande plus bas dans la liste.
- **Repère « non lu »** : une barre de 3 px à gauche de la ligne, posée en CSS
  depuis l'attribut `data-unread` (`.article-row[data-unread]`), plus la pastille
  du mode Compact. Cette phrase a longtemps été fausse : `--list-unread-bar`
  n'était lue que par la pastille, et dans les modes Standard et Aperçu — les
  deux par défaut — l'état non-lu ne reposait que sur la graisse du titre et sa
  couleur. Barre ajoutée en 1.4.5. Même idiome (`inset 3px`) que la ligne
  sélectionnée : quand une ligne est les deux, les barres ont la même couleur.
- **Fonctions** : marquer lu au clic, favori, à lire plus tard, ouverture de
  l'original, balayage sur mobile (`SwipeableArticleRow`), sélection multiple
  via les actions de ligne
- **Piège** : ouvrir un article marque lu **dans `selectArticle`**, pas dans
  `toggleRead`. Il y a **cinq** sites d'écriture dans `feedStore` (lecture via
  `selectArticle`, lecture via `toggleRead`, favori, à lire plus tard,
  étiquettes) — toute modification du traitement des échecs doit couvrir les cinq.
- **Règle** : **deux** de ces cinq écritures RETIRENT une ligne de la liste ;
  les trois autres la modifient seulement, et la vue se réconcilie au
  rechargement. Une mise à l'écart explicite retire, sous le filtre qu'elle
  concerne — ailleurs, rien ne disparaît.
  - `toggleRead` (le ✓) retire sous le filtre « Non lus », depuis le
    2026-09-01 (issue #10). **De façon optimiste**, avec un rollback capable de
    réinsérer la ligne à son index d'origine, et jamais la ligne de l'article
    ouvert. Décision assumée, détaillée plus bas.
  - `toggleReadLater` retire de la vue « À lire plus tard » quand on enlève
    l'étiquette, **après confirmation du serveur** depuis le 2026-09-01. Le
    retrait était optimiste, avec un rollback qui n'est qu'un `.map()` :
    incapable de remettre une ligne déjà partie, il laissait sur un refus
    `articles: []` au-dessus d'un `readLaterCount: 1` — un élément compté sans
    ligne, l'étiquette restant posée côté FreshRSS. C'était le défaut payé puis
    corrigé sur `toggleStar` en 1.4.4, réglé ici de la même façon : seuls
    l'étiquette et le compteur bougent avant la réponse.
  - `selectArticle`, `toggleStar` et les étiquettes ne retirent rien. Retirer
    le favori depuis la vue Favoris sortait l'article de la liste — hérité du
    commit initial, sans décision consignée. Le prix en était un rollback
    impossible : un refus du serveur faisait disparaître l'article alors qu'il
    restait en favori côté FreshRSS, avec un compteur correctement restauré
    annonçant « 1 favori » au-dessus d'une liste vide. Aligné en 1.4.4.
- **Cache hors-ligne** : les cinq sites appellent `persistCurrentView()`, à
  l'aller **et** au rollback. Seuls les deux chemins de lecture le faisaient :
  mettre un favori puis recharger hors ligne le montrait non favori.
- **Cache mémoire des vues** : les DEUX écritures qui retirent une ligne
  appellent `memRemoveFromViews(articleId, filter)`, qui la retire du cache
  mémoire de **toutes** les vues portant ce filtre (la clé vaut
  `<feedId>:<filter>`). Sans cela, le retrait ne dure que le temps de la vue :
  `loadArticles` repeint depuis ce cache en posant `loading: !cached`, donc
  quitter la vue puis y revenir réaffiche la ligne retirée, sans spinner et
  sans limite de temps. Le helper n'a d'abord couvert que « Non lus » ;
  `toggleReadLater` avait le même défaut et l'a gardé jusqu'à ce que le helper
  soit généralisé. Un jumeau à moitié corrigé est un piège : **si un site
  d'écriture retire une ligne, il purge ce cache** — y compris le chemin qui
  garde la ligne retirée sans confirmation du serveur : le `catch` réseau de
  `toggleRead`, qui met l'action en file et laisse la ligne partie, purge de
  son côté.
- **Le ✓ retire la ligne sous le filtre « Non lus »** (issue #10, 2026-09-01).
  La décision est prise par `shouldLeaveList()` (`src/lib/removeOnRead.ts`) et
  appliquée par `toggleRead` **avant l'appel au serveur**, comme le drapeau
  `read` lui-même.
  - **Le geste compte, pas l'état.** Ouvrir un article le marque lu
    (`selectArticle`) mais laisse sa ligne : elle disparaîtrait pendant qu'on
    le lit. Le marquage au défilement, seul écrivain implicite, passe
    `{ implicit: true }` et ne retire rien — sans quoi la liste s'effondrerait
    en continu sous le lecteur.
  - **Le retrait est optimiste, et le rollback sait remettre la ligne.** Il a
    d'abord attendu la confirmation du serveur, ce qui faisait payer
    l'aller-retour vers FreshRSS à chaque clic : instantané quand il répond
    vite, plusieurs secondes sinon. Ce qui interdisait de retirer d'avance
    n'était pas le principe mais le rollback — un simple `.map()`, incapable
    de remettre une ligne déjà sortie du tableau. C'est le bug payé sur
    `toggleStar`, où l'article disparaissait de l'écran en restant favori côté
    FreshRSS. `toggleRead` retient donc la ligne AVANT de retirer, et un refus
    la réinsère — mais **la place se recalcule au moment du refus**, jamais
    depuis un index. Trois choses ont pu changer entre-temps, et un index n'en
    survit à aucune ; `planRowRestore()` (`src/lib/rollbackRow.ts`) les tranche
    toutes les trois :
    - **La vue n'est plus la même.** Le ✓ part du flux A, l'utilisateur ouvre
      le flux B pendant que l'écriture est en vol (`selectFeed` remplace
      `articles` en bloc) : réinsérer posait un article du flux A au milieu de
      la liste du flux B, et `persistCurrentView` l'écrivait aussitôt dans le
      cache de B, où il survivait au rechargement et au retour hors ligne. La
      vue est donc comparée par `viewIdentity()` — flux, filtre **et**
      recherche en cours, qu'une clé de cache ne distingue pas.
    - **La ligne est déjà revenue.** Un tiré-pour-rafraîchir ou un
      `silentRefresh` remplace la liste par une page serveur qui contient
      toujours l'article, le marquage ayant échoué : réinsérer en faisait une
      SECONDE copie, deux enfants React sous la même clé, et le doublon
      persisté.
    - **La liste a bougé.** Deux ✓ rapprochés dont l'un est confirmé : l'index
      retenu pour l'autre désigne la fin de la liste. La place se déduit de la
      DATE de publication, l'ordre de la liste elle-même ; le voisin du dessus
      ne sert qu'à départager un bloc publié à la même seconde, et il est
      vérifié présent, jamais supposé.

    Ce chemin n'a rien d'exotique : le jeton d'écriture CSRF est mis en cache
    pour toute la session (`src/api/feeds.ts`). Un jeton périmé envoyait donc
    chaque ✓ dans le refus, et pour toujours — voir « Jeton d'écriture
    (CSRF) » plus bas, qui redemande maintenant un jeton et rejoue l'écriture
    une fois. Sur un échec RÉSEAU, en revanche, la ligne **reste retirée** :
    l'état optimiste est celui qu'`enqueueAction` rejouera, le remettre
    contredirait la file.
  - **Un échec ne se déguise plus en réussite.** Le retrait étant optimiste, une
    écriture perdue est indiscernable d'une écriture passée : la ligne s'en va,
    le compteur baisse, et l'utilisateur ne l'apprend qu'au rechargement — où
    tout ce qu'il croyait avoir lu revient non lu. Les deux chemins d'échec de
    `toggleRead` poussent donc un toast d'erreur, la décision revenant à
    `writeFailureNotice()` (`src/lib/writeFailureNotice.ts`) :
    - **refus du serveur** → `toast.markFailed`, qui explique la ligne
      réapparue ;
    - **mise en file alors que le navigateur est EN LIGNE** →
      `toast.markQueued` : un 5xx de FreshRSS ou une requête restée sans
      réponse n'est pas une situation hors ligne, mais `isNetworkFailure` les
      range là — la ligne reste partie sans que rien n'ait été écrit ;
    - **hors ligne pour de bon** → silence, le bandeau global le dit déjà et un
      toast par clic serait du bruit.

    La notification n'a rien reclassé : `isNetworkFailure` garde son contrat et
    la file d'attente son comportement.
  - **Le cache mémoire attend la confirmation — sauf hors ligne.**
    `memRemoveFromViews` et la décision de rattrapage restent APRÈS la réponse
    du serveur : c'est le seul cache qu'un refus n'a alors rien à défaire, la
    ligne réinsérée y étant toujours. Le cache DURABLE, lui, est réécrit
    d'avance avec la liste optimiste (`persistCurrentView`). D'où le piège
    payé : sur échec réseau, la ligne reste retirée pour la file d'attente,
    mais le cache mémoire la gardait — quitter la vue et y revenir la
    repeignait, marquée LUE, sous « Non lus », sans spinner et sans limite de
    temps, soit le symptôme exact de l'issue #10 par le seul chemin qui ne
    purgeait pas. Le `catch` réseau purge donc lui aussi.
  - **Jamais la ligne de l'article OUVERT.** Deux bascules depuis le volet de
    lecture atteignent une vraie transition non-lu → lu sur lui : sans garde,
    sa ligne partait pendant qu'il restait affiché, `selectNextArticle` ne le
    retrouvait plus (`findIndex` → -1, puis `articles[0]`) et sautait en tête,
    et le balayage suivant/précédent du mobile devenait inerte. C'est
    l'invariant que `silentRefresh` entretient déjà en RÉINSÉRANT l'article en
    cours de lecture.
  - **Le retrait vaut aussi pour le cache mémoire** (`memRemoveFromViews`
    dans `feedStore.ts`, toutes les vues dont la clé finit par `:unread`).
    Il ne touchait que `articles` et le cache hors-ligne : quitter le flux et y
    revenir repeignait depuis le cache mémoire — et comme `loadArticles` pose
    `loading: !cached`, la ligne lue réapparaissait dans « Non lus » sans même
    un spinner, indéfiniment hors ligne. C'est le symptôme exact de l'issue #10.
  - **La pagination doit continuer** (`shouldTopUpAfterRemoval`,
    `src/lib/listTopUp.ts`). Le scroll infini ne partait que d'un événement
    `scroll` : en dépilant par le haut, `scrollTop` reste à 0 et aucun
    événement n'est émis — et quand le reste tient dans la fenêtre, la liste
    n'est même plus défilable. `toggleRead` demande donc **une** page
    supplémentaire quand, après le retrait, **la liste n'a plus rien à faire
    défiler** et que `continuation` n'est pas nulle.
  - **Le critère est le débordement, pas un nombre de lignes (2026-09-02).**
    La première version comparait les lignes restantes à un seuil
    (`TOP_UP_MIN_ROWS = 8`), ce qui ne veut rien dire d'un écran à l'autre :
    huit lignes sont plausibles sur un téléphone et absurdes sur un grand
    écran. Une vue charge ~50 non-lus ; en marquer 25 d'affilée en laisse 25,
    très au-dessus du seuil — donc aucun rattrapage — mais trop peu pour
    remplir une grande fenêtre — donc plus aucun `scroll` non plus. Les deux
    mécanismes se taisaient ensemble et la liste restait bloquée sur le reste
    d'une seule page (~25 lignes affichées pour ~80 non lus, seul un
    rechargement complet en sortait). Le fait « la liste défile-t-elle
    encore ? » est mesuré par `ArticleList` (`listOverflows`,
    `src/lib/listOverflow.ts` : `scrollHeight > clientHeight +
    OVERFLOW_SLACK_PX`) et **publié dans un canal hors React**
    (`publishListCanScroll`), que `toggleRead` lit au moment du retrait. La
    mesure est rafraîchie **après chaque rendu**, **au défilement** (les
    images qui finissent de charger changent `scrollHeight` sans rendu) et par
    un `ResizeObserver` sur le conteneur (fenêtre agrandie, barre latérale
    repliée : un simple redimensionnement suffit à faire cesser un
    débordement). Au démontage de la liste, elle revient au défaut prudent
    « défile encore » — sans quoi un ✓ depuis le volet de lecture plein écran
    demanderait une page par geste. Une mesure périmée coûte au pire une page
    inutile ou un rattrapage repoussé au ✓ suivant, jamais une boucle : rien
    de ce que fait `loadMore` ne réécrit cette mesure.
  - **Piège — pas pendant une recherche.** `shouldLeaveList` ne regarde que le
    filtre, resté « unread » quand une recherche est active : la ligne part
    donc bien, mais le rattrapage se tait (`shouldTopUpAfterRemoval` prend
    `searching`). La garde a été posée quand `loadMore` ignorait `searchQuery`
    et rapportait le FLUX NU ; depuis la 1.4.8 il pagine la recherche
    elle-même, donc **elle est devenue conservatrice** et non plus un
    contournement : rien ne dit qu'on veuille voir une liste de résultats se
    réalimenter sous le curseur après un simple ✓, et lever la garde se ferait
    exprès. Même précédent que `markReadOnScroll`, éteint en recherche.
  - **Piège — jamais depuis un effet React.** Une première version du
    rattrapage était un effet qui surveillait l'état de la liste
    (`useAutoLoadMore`, retiré le jour même). Deux emballements l'ont
    condamné : (1) le `catch` de `loadMore` remet `loadingMore` à `false` sans
    toucher `continuation`, donc `true → false` relançait l'effet, qui
    rappelait `loadMore` — 51 appels consécutifs mesurés ; (2) une page de 50
    éléments serveur peut ne rendre AUCUNE ligne (les favoris d'un flux sont
    filtrés côté client dans `fetchArticleStream`), l'effet voyait une liste
    trop courte et repaginait jusqu'à vider le flux — un seul appui sur le ★
    d'un gros flux suffisait. La décision est donc prise **au moment du
    retrait**, une fois : un geste ⇒ au plus une page. Un rattrapage en échec
    s'arrête, il ne se replanifie pas.
  - **Ne jamais annoncer « tout est lu » à tort, ni enfermer dans un
    squelette.** L'état vide « Non lus » est un message de réussite ; tant que
    `continuation` promet une page suivante, il serait faux. La première
    correction rendait alors le **squelette de chargement** — et ce squelette
    était **terminal** : rien ne le relançait jamais (le sondage d'`App.tsx` ne
    touche qu'aux compteurs, `silentRefresh` attend un retour d'onglet, et un
    squelette plus court que la fenêtre n'émet aucun `scroll`, donc
    `shouldLoadMore` n'était jamais consulté). Il ne portait pas non plus sur
    le seul ✓ : **toutes** les vues étaient concernées, et un ★ sur un flux
    dont les 50 premiers articles ne sont pas favoris suffisait à y tomber
    (`fetchArticleStream` filtre les favoris côté client, donc `articles: []`
    avec une continuation non nulle est un résultat normal). Le corps de la
    liste est désormais décidé par **`listBodyState`** (`listPagination.ts`),
    qui garantit que le squelette n'apparaît **que** pendant un vrai
    chargement : liste vide + continuation ⇒ état vide **neutre**
    (`emptyState.morePages`, jamais `emptyState.allRead`) avec un bouton
    « Charger la suite ». Pendant une **recherche**, cet état retombe sur
    l'état vide ordinaire — non plus faute de savoir paginer (voir ci-dessous),
    mais parce que l'état vide de recherche a déjà sa propre sortie
    (« chercher dans tous les flux »), plus utile là qu'un bouton de page
    suivante sur zéro résultat.
  - **Le bouton « Charger la suite » ne doit jamais être un no-op silencieux
    (2026-09-02).** Trois manières dont il pouvait cliquer pour rien, sans un
    mot :
    - **Échec réseau/serveur.** Le `catch` de `loadMore` se contentait de
      remettre `loadingMore` à `false` ; sur un 502 le bouton affichait
      « Chargement… » le temps de l'aller-retour puis revenait à son état de
      départ. Il pousse désormais un toast d'erreur — réutilise le mécanisme
      existant (`useUiStore.pushToast`, `tone: 'error'`) et le message déjà
      traduit `sidebar.loadError`, plutôt que d'en inventer un nouveau.
      `continuation` n'est pas touché : le bouton reste actionnable pour
      retenter.
    - **Page qui n'ajoute aucune ligne visible.** Les favoris d'un flux sont
      filtrés côté client (voir plus haut) : une page de 50 éléments peut
      légitimement n'en rendre aucun. Sur un flux de 500 articles dont
      l'unique favori se trouve vers la position 480, dix clics d'affilée
      repeignaient le même écran vide. `shouldReportInvisibleProgress`
      (`listPagination.ts`) détecte ce cas — page reçue, zéro ligne ajoutée,
      flux non épuisé — et déclenche un toast neutre (`toast.loadMoreEmpty`).
      Se tait quand le flux est épuisé : l'état vide définitif le dit déjà,
      et mieux.
    - **Course avec la revalidation d'une vue en cache.** `loadArticles` peint
      une vue déjà visitée depuis le cache mémoire (`loading` reste faux, pas
      de squelette) pendant que sa requête authoritative revalide encore en
      tâche de fond — rien ne le disait avant. Un clic dans cette fenêtre
      lançait `loadMore` en même temps que cette revalidation, qui gagne
      presque toujours la course et écrase la page ajoutée en réinitialisant
      `continuation` : le travail du clic était jeté sans un mot. Un nouveau
      champ `revalidating` du store couvre cette fenêtre ; `canLoadMore`
      (`listPagination.ts`) bloque à la fois le clic (bouton grisé, même
      libellé « Chargement… » que `loadingMore`) et l'action `loadMore`
      elle-même (garde-fou côté store, en plus de l'UI).
  - **Une page appartient à la vue qui l'a demandée (1.4.8).** `loadMore`
    capturait le flux et le filtre avant sa requête puis écrivait le résultat
    sur l'état d'APRÈS : changer de flux pendant l'aller-retour abîmait deux
    choses d'un coup. `state.articles` étant déjà la NOUVELLE liste, la page de
    l'ancienne vue lui était appendue ; et cette liste mélangée était persistée
    sous la clé de l'ANCIENNE vue (cache mémoire **et** cache hors ligne), donc
    la corruption survivait au rechargement. `loadMore` retient désormais
    `viewIdentity()` avant la requête et la relit après : si elle a changé, la
    page est **jetée entièrement** — pas d'ajout, pas d'écriture de cache, pas
    de `continuation` — et seul `loadingMore` retombe. Même garde que le
    `sameView()` de `loadArticles`, qui l'avait depuis toujours ;
    `viewIdentity` couvre en plus la recherche, qui change la liste à l'écran
    sans changer la clé de cache.
  - **Écarté** : réglage optionnel, bandeau « Annuler » (il ne rattrapait pas
    le cas invoqué), uniformisation des hauteurs de ligne. Détail et raisons
    dans `docs/superpowers/specs/2026-09-01-mark-read-removes-row-design.md`.
- **Le ✓ est arrivé en mode Compact avec l'issue #10** (2026-09-01). Il
  manquait aux lignes compactes alors qu'il existait dans la ligne normale et
  la vue grille. Ces lignes ayant toutes la même hauteur, le ✓ suivant se
  place exactement où était le précédent : on enchaîne les marquages sans
  bouger la souris. Le mode Compact comptait alors trois actions (à lire plus
  tard, favori, ✓, dans cet ordre) ; la barre d'actions ci-dessous en compte
  désormais quatre, dans un ordre commun aux trois modes.
- **Une barre d'actions unique pour les trois modes** (`ArticleRowActions`,
  `src/components/ArticleList/ArticleActions.tsx`) remplace les trois copies
  qu'écrivaient la ligne normale, la ligne compacte et la carte de grille.
  La ligne compacte n'avait **aucun conteneur** pour ses boutons : ils étaient
  enfants directs de la ligne et héritaient donc de son `gap-3`, comme le
  titre et l'heure — un conteneur dédié leur donne maintenant leur propre
  écartement : **`gap-2`, soit 8 px**. Il avait d'abord été fixé à `gap-1`
  (4 px), et c'était trop peu : `.article-row button` est volontairement
  exempté du `min-height: 40px` tactile (`src/styles/index.css`), donc chaque
  cible reste **22 × 22 px**, sous le minimum de 24 px de la règle WCAG 2.5.8 —
  et elles sont désormais quatre de front. Depuis l'arrivée de la 4ᵉ icône, une
  méprise coûte cher : le doigt qui visait le ✓ tombait sur « ouvrir à la
  source », qui ouvre un onglet, marque lu **et** sélectionne l'article — soit
  trois effets pour un doigt mal posé. Doubler l'écart rend l'essentiel de la
  séparation d'avant pour 8 px de largeur de ligne. L'ordre est désormais **le même partout** :
  étoile → à lire plus tard → ouvrir à la source → ✓, alors que le mode
  Compact inversait auparavant étoile et « à lire plus tard ». Le ✓ reste en
  DERNIER : c'est ce qui permet d'enchaîner des clics de marquage sans bouger
  la souris (issue #10, voir plus haut) — l'insérer avant l'aurait cassé.
  Les emplacements viennent de `rowActionSlots()` (`src/lib/rowActions.ts`),
  qui distingue deux absences : un article **sans URL** laisse un emplacement
  **réservé**, vide mais de la même taille qu'un bouton (sinon les icônes
  suivantes se décaleraient sur cette seule ligne) ; une icône masquée par
  réglage laisse un emplacement **retiré**, rien n'occupant sa place (la
  cause vaut pour toute la liste, rien n'a besoin d'absorber une variation).
  **Chaque mode garde sa disposition**, passée en `className` : la ligne
  compacte et la carte de grille alignent leurs icônes **en ligne** ; la ligne
  normale (et l'aperçu) les empile en **colonne**
  (`flex flex-col items-center gap-1 flex-shrink-0 pt-0.5`), comme du temps où
  elles étaient trois.
  ⚠️ **Cette colonne coûte de la hauteur de ligne, et c'est un choix assumé.**
  Quatre boutons empilés mesurent **102 px**, alors que le bloc de texte voisin
  (source, titre, résumé sur deux lignes) en fait **79,25 px** : la colonne est
  donc ce qui dicte la hauteur de la ligne, qui passe de **104,25 px** (trois
  icônes, la barre tenant alors dans le texte) à **127 px** — +22,75 px, à peu
  près un article de moins par écran dans la vue par DÉFAUT. Une **grille
  2 × 2** rendait ces 22,75 px et a été essayée un temps ; elle a été refusée à
  l'usage : les quatre icônes doivent rester alignées comme les trois d'avant.
  Les chiffres sont mesurés au navigateur (`getBoundingClientRect()`) sur le
  vrai balisage et la feuille de styles **construite**, panneau de 420 px, pas
  à l'œil. Rétrécir les boutons n'est pas l'échappatoire : ils sont déjà à
  22 × 22 px, sous le minimum WCAG 2.5.8 rappelé ci-dessus.
  Réglages de visibilité : `ArticleRowActions` reçoit désormais le choix de
  l'utilisateur (`useUiStore(s => s.rowActions)`), réglable dans Préférences →
  **Mise en page** (voir *Préférences* ci-dessous) — toutes visibles par
  défaut.
  ⚠️ **Masquer l'étoile ou « à lire plus tard » retire aussi un geste.**
  `useFileGesture` vit DANS `StarButton` et `ReadLaterButton` : l'appui long
  (ou le clic droit) qui ouvre `SavedCategoryPicker` disparaît avec le bouton,
  et avec lui la seule façon de classer un article dans une catégorie **depuis
  la liste** — le volet de lecture garde la sienne. Les balayages et les
  raccourcis clavier, eux, ne bougent pas. Le texte d'aide de la section
  « Mise en page » (`preferences.layout.hint`) le dit, dans les neuf langues :
  il a affirmé le contraire (« les gestes ne changent pas ») le temps d'un
  cycle.
  **Tests** : la carte de grille par `ArticleCard.test.tsx`, la ligne compacte
  par `ArticleRow.compact.test.tsx` (ordre des quatre icônes, emplacement
  réservé en 3ᵉ position sans URL, emplacement retiré par réglage, et le clic
  sur « ouvrir à la source » qui n'ouvre jamais l'article) — d'où l'export de
  `ArticleRow` depuis `ArticleList.tsx`, qui n'a pas d'autre consommateur.
- **Ouvrir à la source** (4ᵉ icône, `OpenSourceButton`) : ouvre l'URL d'origine
  de l'article dans un nouvel onglet (`openExternal()`, `src/lib/openExternal.ts`
  — `window.open(url, '_blank', 'noopener')`, jamais l'article dans FriRSS)
  puis **sélectionne** l'article (`openArticleAtSource()`,
  `src/lib/openArticleAtSource.ts`, qui reçoit `selectArticle` en argument).
  L'article ouvert devient donc l'article courant : au retour de l'onglet, le
  volet de lecture, les raccourcis et les actions portent déjà sur lui, sans
  avoir à le retrouver dans la liste. C'est ce que l'usage réel a demandé ;
  l'icône se contentait auparavant de le marquer lu **sous condition**.
  Deux conséquences, et ce sont elles qui font l'intérêt du changement :
  - `selectArticle` (`src/stores/feedStore.ts`) marque lui-même l'article lu,
    de façon optimiste et par le chemin de lecture normal — celui qui sait
    survivre hors ligne. La garde « jamais une bascule » de l'ancienne version
    n'a donc plus d'objet : elle protégeait de `toggleRead`, qui aurait
    repassé non lu un article déjà lu ; `selectArticle` sur un article déjà lu
    se contente de le sélectionner.
  - **La ligne ne quitte plus la liste sous « Non lus ».** Le retrait est
    décidé par `shouldLeaveList()` (`src/lib/removeOnRead.ts`), que seul
    `toggleRead` consulte — et dont le critère `selected` protège de toute
    façon l'article sélectionné. Le clic laisse donc la ligne en place, là où
    il la faisait disparaître.
  Le clic appelle `e.stopPropagation()` en premier, comme les trois autres
  boutons de la ligne, et la sélection est appelée **explicitement** dans le
  gestionnaire : laisser le clic remonter jusqu'à la ligne donnerait un
  comportement différent d'un mode à l'autre, la carte de grille arrêtant déjà
  la propagation sur son conteneur d'actions.
  Sans URL, `openArticleAtSource()` ne fait **rien du tout** — ni ouverture, ni
  sélection. La garde est dans le module et pas seulement dans l'affichage :
  aucun bouton ne mène là aujourd'hui (`rowActionSlots()` rend l'emplacement
  vide), mais un futur appelant qui ne consulterait pas les emplacements — un
  raccourci clavier, par exemple — changerait sinon l'état de l'article sans
  que rien ne s'ouvre.

### Marquer lu au défilement
Option **éteinte par défaut** (Préférences → Général, synchronisée) : un article
est marqué lu une seconde après être sorti par le **haut** de la liste.

- **Où** : `src/lib/markReadOnScroll.ts` (les décisions, testées),
  `ArticleList.tsx` (l'`IntersectionObserver`)
- **Pas un sixième site d'écriture** : l'écriture passe par `toggleRead`, l'un
  des cinq existants — donc le repli en cas d'échec et `persistCurrentView()`
  s'appliquent déjà. C'est aussi pourquoi la décision refuse un article **déjà
  lu** : `toggleRead` le repasserait non lu, l'exact contraire du réglage.
- **Piège majeur — le premier appel de l'observateur** rapporte l'état de
  TOUTES les lignes observées. Sans garde, ouvrir une vue dont la position de
  défilement est restaurée marquerait lu tout ce qui se trouve au-dessus. D'où
  `seen` : seule une ligne **ayant été visible** peut être marquée. L'ensemble
  est vidé à chaque changement de vue.
- **Sortie par le bas ≠ sortie par le haut** : remonter la liste fait sortir des
  lignes par le bas ; celles-là ne sont jamais marquées, on ne les a pas
  dépassées. `scrolledPastTop()` porte cette distinction.
- **Jamais pendant une recherche** : on parcourt des résultats, on ne dépile pas
  une file. Le délai d'une seconde laisse le temps de remonter, et revenir à
  l'écran annule la programmation.

### Marquer tout comme lu
Confirmation optionnelle avant de vider une vue entière.

- **Où** : `src/lib/markAllRead.ts`
- **Pas offert partout** : `canMarkAllRead()` retire le bouton des vues
  **Favoris** et **À lire plus tard**. `markAllAsRead()` s'adresse au flux
  sélectionné ou à la liste de lecture entière, et n'a aucune notion de filtre —
  il ne peut pas en avoir, ces deux vues étant des sélections transversales et
  non des flux qu'on vide. Le bouton y était rendu quand même : un contrôle qui
  se lit « marquer ces articles comme lus » marquait TOUTE la liste de lecture.
  Aucun raccourci clavier n'y mène, le bouton était la seule porte.
- **Spec** : `docs/superpowers/specs/2026-08-15-optional-mark-all-read-confirm-design.md`

### Recherche
Recherche respectant le **périmètre** de la vue courante : chercher depuis un
flux cherche dans ce flux, depuis une catégorie dans cette catégorie.

- **Recherches récentes** (1.4.5) : `src/lib/searchHistory.ts`, cinq au
  maximum, **par serveur** comme la vue courante (`lastView.ts`) — les flux
  diffèrent d'un serveur à l'autre, donc une requête qui avait un sens sur l'un
  est du bruit sur le suivant. Proposées seulement quand le champ est vide,
  sinon elles recouvriraient ce qu'on est en train de taper. **Locales à
  l'appareil, jamais synchronisées** : c'est la sorte de trace qu'on ne
  s'attend pas à voir apparaître sur un autre écran.
- **Scroll infini des résultats** (1.4.8) : `loadMore` appelait
  `fetchArticleStream(filter, selectedFeed, …)` sans jamais passer
  `searchQuery`. Descendre au bas d'une liste de résultats y appendait donc la
  page du **flux nu** — des articles sans rapport avec la requête, sous une
  boîte de recherche toujours remplie. Il passe désormais par `searchItems`,
  qui accepte une continuation, avec le **même périmètre** que la recherche
  initiale (`resolveSearchStreamId`) — sans quoi la suite chercherait ailleurs
  que le début.
- **Piège** : une page de résultats n'est écrite dans **aucun cache**, ni
  mémoire ni hors ligne. `viewKey` ne connaît que le flux et le filtre : y
  ranger des résultats les ferait repeindre à l'ouverture de la vue nue, hors
  de toute recherche. C'est déjà pourquoi `search` n'écrit rien.
- **Piège** : `activeServerId` vaut `string` sur certains chemins et `number`
  sur d'autres ; la clé de stockage interpole, pour que les deux formes visent
  le même seau.

- **Spec** : `docs/superpowers/specs/2026-08-16-scoped-search-design.md`

### Vue agrégée d'une catégorie
Cliquer une catégorie affiche les articles de tous ses flux.

- **Spec** : `docs/superpowers/specs/2026-08-14-category-aggregate-view-design.md`

---

## Volet de lecture

Titre, méta (source, auteur, date), étiquettes en pastilles, corps HTML
**assaini**, liens en accent, blocs de code et citations stylés. Mode Focus
(plein écran) au double-clic. Contenu bidirectionnel rendu dans son sens propre.

- **Où** : `src/components/ReadingPane/ReadingPane.tsx`, `src/utils/sanitizeHtml.ts`,
  `src/lib/articleBody.ts` (fabrication du corps), `src/lib/readingBody.ts`
  (ce qui est montré, et quand), `src/lib/imageAspect.ts` (réservation de la
  place des images), `src/lib/heroWarm.ts` (réchauffage des images en avant),
  `src/lib/readProgress.ts`
- **Ce que le volet montre** (1.4.10) : `src/lib/readingBody.ts`
  (`readingBodyKind`, `showsSkeleton`, `showsReadingTime`), testé à part.
  L'extraction si elle est là, **sinon le contenu du flux** — qui est déjà en
  mémoire, arrivé avec la liste — et le **squelette** seulement quand il n'y a
  réellement rien à montrer : un flux sans contenu (texte ni image ; un
  `<p>&nbsp;</p>` ne compte pas) dont on attend l'extraction. Sans extraction
  automatique, un article vide reste vide : pas de squelette que rien ne
  viendrait remplacer.
- **Pourquoi ce changement** : jusqu'ici, un flux à extraction automatique
  affichait le squelette gris tant que le texte complet n'était pas revenu,
  *alors que le contenu du flux était disponible*. L'application montrait un
  simulacre de chargement en tenant du vrai texte — c'est ce qui lui donnait
  son air de charger sans arrêt, en PWA iOS surtout, où l'on balaie vite. Le
  fantôme de balayage suit la même règle (et consulte `peekExtract`, donc il
  montre l'extrait quand le préchargement l'a déjà ramené) : il n'y a plus
  d'article gris ni pendant le geste ni après.
- **Bascule flux → extraction** : une **seule** réécriture d'`innerHTML`, sur
  le même nœud, sans animation — `reading-body-enter` ne joue qu'au montage, et
  le nœud ne se démonte plus. L'image d'en-tête garde la **même URL** de part
  et d'autre : `displayedHtml()` réinjecte celle du flux quand l'extraction l'a
  perdue, et quand l'extraction la porte, c'est la même. Le navigateur ne
  repart donc pas chercher une image. Épinglé par
  `src/lib/articleBody.test.ts` et `ReadingPane.body.test.tsx`.
- **Pastille « x min »** : affichée dès qu'il y a un corps, sur le contenu
  **montré** ; sa valeur grandit donc quand l'extraction arrive. Elle n'était
  auparavant cachée que parce qu'il n'y avait rien à mesurer sous le squelette.
- **Fabrication du corps** (1.4.10) : `src/lib/articleBody.ts` tient toute la
  chaîne — contenu choisi (extrait ou flux, image d'en-tête du flux réinjectée
  si l'extraction l'a perdue), façades vidéo, assainissement, `aspect-ratio`
  réservé, chargement différé au-delà des deux premières images, direction par
  bloc. Elle vivait dans le composant et tournait à **chaque rendu**.
  `reserveImgAspect()` tire ses dimensions des attributs de la balise, puis —
  depuis la 1.4.10 — des mesures relevées par le réchauffage en avant
  (`imageAspect.ts`). Sans l'une ni l'autre, la balise ressort intacte.
- **Piège majeur — l'objet `dangerouslySetInnerHTML` doit garder son identité**
  (1.4.10). React 19 n'écarte une prop que si `nextProp === lastProp`, puis
  réaffecte `innerHTML` **sans comparer `__html`**. Un littéral
  `{{ __html: … }}` écrit dans le JSX est un objet neuf à chaque rendu : le
  corps entier était reconstruit, chaque `<img>` détruite puis recréée, et donc
  blanche le temps de recharger. Comme le volet re-rend à chaque événement de
  défilement, cela produisait un clignotement violent en PWA iOS sur les flux à
  extraction automatique. Le corps, la façade vidéo d'en-tête et le squelette
  passent maintenant par des objets **mémoïsés** (`SKELETON_PROP` est même une
  constante de module). Mémoïser la seule chaîne n'y suffirait pas : c'est
  l'objet qui doit survivre. Le défaut existait depuis le passage à React 19
  (1.4.5) — React 18 comparait la chaîne et le masquait ; les 1.4.7 et 1.4.9
  l'ont rendu visible en faisant enfin aboutir l'extraction, donc en peuplant
  les articles d'images. Garde-fou :
  `src/components/ReadingPane/ReadingPane.body.test.tsx`.
- **Barre de progression** : `src/lib/readProgress.ts`. La mesure est coalescée
  sur `requestAnimationFrame` — une par image affichée, plus une par événement
  de défilement : chacun lisait `scrollHeight`/`clientHeight` (recalcul de mise
  en page forcé) puis posait un état qui re-rendait tout le volet. Un article
  plus court que la fenêtre affiche 100 %, pas 0 % : il est lu dès qu'il est là.
- **Morphing du titre** (1.4.5) : `src/lib/viewTransition.ts`. Le titre de la
  ligne cliquée et celui du volet portent le même `view-transition-name` le
  temps de la transition ; le navigateur anime le passage de l'un à l'autre.
  **Uniquement en 2 panneaux et en grille, sur desktop** : là, la liste est
  remplacée par le volet. En 3 panneaux les deux titres coexistent et se
  disputeraient le nom (le navigateur saute alors la transition) ; sur mobile,
  `MobileStack` garde la liste montée derrière **et** anime déjà la navigation.
  Sans support navigateur, ou sous mouvement réduit, il ne se passe rien.
  `flushSync` est indispensable : sans commit synchrone, le navigateur
  photographie deux fois l'ancien état.
- **Mouvement** (1.4.5) : l'article entre avec un léger déplacement vertical
  **dans le sens de la navigation** — un article situé plus haut dans la liste
  entre par le haut (`data-enter` posé sur l'élément avant le redéclenchement
  de l'animation). Position inconnue (recherche, ouverture directe) : sens par
  défaut, on n'invente pas un mouvement. Le corps porte `reading-body-enter`,
  qui ne joue **qu'au montage** de ce nœud : changer d'article réutilise le
  même élément, et la bascule flux → extraction aussi (elle ne réécrit que le
  contenu). Le seul montage réel qui reste est la sortie du squelette, pour les
  articles dont le flux ne livre rien.
- **Balayage d'un article à l'autre** (mobile et tablette) : le geste
  horizontal fait glisser l'article suivant ou précédent. Pendant le geste, un
  **fantôme** (`swipe-ghost`, un `<div>` DOM construit à la main dans
  `ReadingPane`, hors de React pour qu'aucun rendu ne vienne saccader
  l'animation) porte l'article visé. À l'arrivée, le vrai article est commité
  en `flushSync` **derrière** le fantôme, qui ne se fond qu'ensuite : sans ce
  maintien, le fondu découvrirait un article encore vide.
- **Quand le fantôme s'efface** : câblé dans `ReadingPane.tsx`. On regarde les
  **trois premières** images du corps ; si elles sont déjà `complete` — ou si
  l'article venait du cache d'extraits — le fondu part tout de suite, sinon on
  attend leur `load`/`error`, avec un délai de garde de 1,5 s pour qu'aucun
  fantôme ne reste collé à l'écran. **Piège** : attendre le *décodage*
  (`HTMLImageElement.decode()`) plutôt que le chargement a été essayé pendant
  le cycle 1.4.10 et retiré avant publication — le fantôme restait bien plus
  longtemps sur iPhone, et le balayage paraissait bloqué.
- **Partager / copier le lien** (1.4.5) : `navigator.share()` là où l'API
  existe, sinon le presse-papiers avec un toast de confirmation. Le volet ne
  proposait que « ouvrir l'original » : dans la PWA iOS installée, envoyer un
  article à quelqu'un obligeait à l'ouvrir d'abord dans Safari. Un partage
  **annulé par l'utilisateur** (`AbortError`) n'affiche rien — ce n'est pas un
  échec.
- **Images** : `max-height: 80vh` avec `width: auto`. Sans plafond, une
  infographie verticale — courante en tech et en sécurité — occupait trois
  écrans et coupait la lecture en deux.
- **Largeur de colonne : aucune limite** — décision de l'utilisateur, prise à
  l'essai. La revue d'interface proposait un plafond, jugeant qu'en mode Focus
  sur un grand écran le texte s'étalait trop. Deux versions ont été livrées
  (44em fixe, puis un réglage à quatre valeurs) et les deux ont été rejetées :
  la colonne suit la largeur disponible du volet, qui est déjà bornée par la
  disposition. **Ne pas réintroduire de plafond sans nouvel élément.**
- **Piège majeur** : le profil DOMPurify `html: true` **retire `<iframe>` et
  `<svg>`**, silencieusement. Une icône SVG dans le HTML d'un article ressort
  vide — dessiner ces icônes en CSS. Ne **pas** élargir le profil : le HTML des
  articles vient de sources non fiables.

### Extraction du contenu complet
Pour les flux tronqués, récupération de l'article complet, avec cache à deux
niveaux. Activable par flux. *(La doc a longtemps annoncé `/cors-proxy/` : cet
endpoint a été supprimé de la production en 1.3.1, et du serveur de
développement en 1.4.4.)*

- **Où** : `src/utils/extractContent.ts`, `src/lib/extractCache.ts`,
  `src/lib/extractStore.ts`
- **Le serveur d'abord, le navigateur en filet** (1.4.10) :
  `extractFullContent()` demande `GET /api/extract?url=…` (**JWT requis**, garde
  anti-SSRF sur la cible), qui extrait une fois pour toute l'instance et — quand
  Redis est là — partage le résultat entre appareils et entre comptes.
  **Toute** réponse absente, en erreur (404 sur un serveur plus ancien, 422 page
  non extractible, 403, 415, 502, 503, 504) ou illisible fait tomber sur
  l'extraction locale décrite ci-dessous — **sauf un 429**, qui est une question
  de cadence et non de capacité : voir plus bas — page récupérée par `/api/proxy` (**JWT requis**,
  même garde anti-SSRF) puis Readability dans le navigateur. Ce repli n'est pas
  du code hérité : c'est ce qui tient quand le serveur n'a pas la route, ne sait
  pas lire la page, ou ne répond pas.
  ⚠️ **Il ne couvre PAS l'absence de Redis** — la doc l'a affirmé jusqu'au
  2026-09-04, et c'était faux dans les trois endroits où elle le disait
  (README, notes de version, ici). `server/index.ts` monte la route
  inconditionnellement et `server/routes/extract.ts` ne conditionne à
  `cacheEnabled` que la lecture et l'écriture du cache : sans Redis la route
  répond quand même 200 avec un article frais, donc le repli **ne s'engage
  jamais**. Ce qui change sans Redis, c'est que rien n'est gardé — chaque
  appareil et chaque compte repaie l'extraction, sur le CPU et la bande
  passante du serveur au lieu du téléphone. Un déploiement sans Redis n'est pas
  « comme avant » : il a déplacé la charge sans le partage qui la justifiait.
- **Délais : 20 s sur la route serveur, 20 s sur le repli**
  (`SERVER_EXTRACT_TIMEOUT_MS`, `FALLBACK_EXTRACT_TIMEOUT_MS`). Un serveur qui
  accepte la connexion et ne répond jamais tenait l'extraction indéfiniment.
  **Six consommateurs**, dont **quatre files séquentielles** — `warmRunner`,
  `warmOfflineCache` et `prepareOffline` (`src/stores/feedStore.ts`) et le
  préchargement N+1…N+10 du volet de lecture (`ReadingPane.tsx`) — où un seul
  article bloqué bloque tout ce qui le suit. Les **deux autres sont des appels
  uniques**, pas des files : `revalidateIfStale` (`src/lib/extractCache.ts`),
  lancé sans être attendu, et `handleExtract` (`ReadingPane`), celui du bouton —
  là, le blocage ne retient personne d'autre, mais « Article complet » reste sur
  « Extraction… » sans erreur ni sortie.
  ⚠️ La doc a annoncé « cinq consommateurs, strictement séquentiels » jusqu'au
  2026-09-04 : elle oubliait la boucle de préchargement du volet de lecture —
  celle-là même qu'une version antérieure nommait, et la plus exposée à un
  article coincé — et qualifiait de file deux appels qui n'en sont pas.
  ⚠️ **Le repli était, lui, sans minuteur jusqu'au 2026-09-04**, ce qui vidait
  le premier de son sens : la panne visée est un backend coincé, et un backend
  coincé coince `/api/proxy` à l'identique — le blocage ne disparaissait pas,
  il se décalait d'une route. Les deux jambes sont désormais bornées : un
  article coûte **~40 s** quand les deux se taisent, et **~100 s** au vrai pire
  cas — l'attente honorée après un 429 (60 s au plafond) s'ajoute alors aux deux
  budgets. La doc a annoncé 40 s pour tous les cas jusqu'au 2026-09-04 ; le
  chiffre est désormais mesuré par un test à faux minuteurs, pas estimé.
  ⚠️ **Le chiffre est celui de la patience d'un lecteur, pas un calcul.** La
  doc a affirmé jusqu'au 2026-09-04 que 25 s se posait « juste au-dessus du
  plafond de corps du serveur (20 s) », donc qu'une page en cours de lecture
  n'était jamais abandonnée : c'était faux. Le budget réel du serveur additionne
  la résolution pré-cache (≤ 5 s), les en-têtes (≤ 30 s par saut) et le corps
  (≤ 20 s) — **au moins 55 s** sans redirection. Aucun délai client tenable ne
  couvre cela. Abandonner une page que le serveur lit encore est donc possible,
  et assumé : le repli repart chercher la même origine (deux requêtes pour cet
  article-là), mais l'extraction serveur va au bout et remplit le cache, dont le
  prochain appareil profitera. Des tests à faux minuteurs échouent si l'une des
  deux jambes perd son signal d'abandon.
- **429 : on attend quand le serveur dit quand revenir**
  (`RATE_LIMIT_MAX_WAIT_MS`, 60 s). Le seau de cadence (`FRIRSS_PROXY_RATE_LIMIT`, 600/min et par compte) est
  partagé par `/api/extract`, `/api/proxy` et le préchargement d'images. Depuis
  que la route répond à la vitesse de Redis, un balayage `prepareOffline` sur un
  appareil au cache chaud n'est plus freiné par le coût de l'extraction : sans
  image à charger, une boucle séquentielle dépasse largement le millier de
  requêtes par minute, donc le plafond est atteignable — là où la doc estimait
  encore que la préparation hors-ligne « reste sous la centaine ». Avec images
  (préréglage *standard* : 1 extraction + jusqu'à 6 images par article), on
  tourne plutôt autour de 400 requêtes/minute, sous le plafond mais pas loin.
  `extractFullContent` honore donc `Retry-After` une fois, puis réessaie ; sans
  cela l'article disparaissait du jeu hors ligne **en silence**, `feedStore`
  avalant l'échec — un défaut qui ne se découvre que dans l'avion. Et sur un 429
  le repli navigateur n'est PAS tenté : même seau, échec certain, jeton
  gaspillé. Ce refus tient même quand la seconde tentative **échoue** (abandon,
  panne réseau) : jusqu'au 2026-09-04 elle retombait dans `/api/proxy`, le
  jeton en moins.
  ⚠️ **Ce qui n'est PAS couvert, et la doc l'a longtemps passé sous silence en
  écrivant « on ne perd pas l'article ».** L'attente n'a lieu que si la réponse
  annonce un délai exploitable : sans en-tête `Retry-After`, avec un en-tête
  illisible, ou au-delà du plafond de 60 s, `retryAfterMs` rend `null` — il n'y
  a alors **ni attente ni repli**, `RateLimitedError` est levée, `feedStore`
  l'avale, et l'article est absent de ce passage exactement comme avant. Idem
  si le second essai revient en 429. Le cas courant reste couvert :
  `express-rate-limit` émet toujours un `Retry-After` d'au plus 60 s avec une
  fenêtre d'une minute. Rien n'ayant été mis en cache, le passage suivant
  reprend l'article.
- **Ce que coûte un repli** : sur 415, 422, 502 ou 503 `Extractor busy`, le site
  d'origine est récupéré **deux fois** — une fois par le serveur, une fois par
  le navigateur — et deux jetons quittent le seau de cadence partagé. (Sur
  l'autre 503, `Target host unresolved`, le serveur n'a joint personne : le
  repli est la seule requête.) Le « une requête au
  lieu de dix » du README décrit le chemin nominal ; le repli, lui, double le
  trafic vers l'origine pour cet article-là.
- **Piège — le HTML rendu par la route est BRUT.** Le serveur n'assainit rien
  (voir *Extraction d'articles*, côté backend), donc le client applique
  `sanitizeExtracted()` à la réception, avant de rendre la valeur et **avant
  qu'elle n'atteigne IndexedDB** (`putExtract`). Retirer cet appel publie une
  XSS stockée, atteignable depuis n'importe quel flux dont la page d'origine
  porte un `onclick` ou un `onerror`. Un test de
  `src/utils/extractContent.test.ts` échoue si l'étape saute.
- **Extraction de fond** : sur un flux à extraction automatique, la page
  entière est extraite en arrière-plan pour que l'article soit prêt avant
  qu'on l'ouvre. Séquentielle, précédée d'un délai d'installation de deux
  secondes pour ne pas concurrencer le premier rendu, et elle saute ce qui est
  déjà en cache. L'ordonnancement vit dans `src/lib/warmSchedule.ts`.
- **Piège** : seul un changement de VUE (`viewIdentity` : flux, filtre,
  recherche) annule le travail en cours. Un nouvel appel pour la même vue —
  c'est ce que fait le rattrapage de pagination, à chaque retrait de ligne —
  ÉTEND la file du run en cours. Le jeton d'annulation était auparavant
  incrémenté par chaque appel : le run repartait de zéro et repayait ses deux
  secondes sans arrêt, si bien qu'il ne prenait jamais d'avance et que
  l'article suivant arrivait en deux temps, texte puis image.
- **Préchargement en avant (volet de lecture)** : une seconde après l'ouverture
  d'un article, FriRSS prépare la suite de la liste. Deux travaux distincts,
  dans le même effet de `ReadingPane.tsx`, annulables par le même drapeau
  `cancelled` et sans reprise sur échec — le délai d'une seconde fait que
  balayer vite n'envoie rien du tout :
  - **le TEXTE des dix articles suivants** (N+1 … N+10, 1.4.10 — la fenêtre
    était de cinq), sur les seuls flux à extraction automatique,
    **séquentiellement** : une extraction à la fois — `/api/extract`, ou
    `/api/proxy` quand elle se replie, et les deux puisent dans le **même**
    seau de cadence. Ne pas élargir davantage ni paralléliser (voir le piège
    ci-dessous) ;
  - **l'image d'en-tête des dix articles suivants** (1.4.10), deux chargements
    en vol au plus. Le plan et le runner vivent dans `src/lib/heroWarm.ts` ; le
    composant ne fait que le câblage DOM.
- **Pourquoi le réchauffage d'images ne repasse pas par le proxy** : rien ne
  réécrit le `src` des images d'article. Quand un article s'affiche, le
  navigateur va chercher ses images **directement à leur origine** (la CSP
  autorise `img-src … https: http:`) et le service worker les met en cache. Le
  réchauffage fait donc littéralement ce que fera le rendu : `src` affecté sur
  une `new Image()` détachée. Même `destination === 'image'`, même route
  Workbox, **zéro octet par le backend**. C'est ce qui permet une fenêtre de
  dix là où la version proxifiée devait se rationner. Une image déjà présente
  dans `frirss-images` (`caches.match`) est sautée : relire un flux ne coûte
  rien.
- **Bénéfice second** : l'événement `load` donne `naturalWidth`/`naturalHeight`
  gratuitement. `src/lib/imageAspect.ts` les retient (carte bornée à 300
  entrées, éviction de la plus ancienne) et `reserveImgAspect()` s'en sert pour
  réserver la place des images dont le flux **n'annonce pas** les dimensions —
  le cas le plus fréquent, et celui où le texte sautait quand l'image se
  posait. Les attributs `width`/`height` de la balise restent prioritaires, et
  sans mesure utilisable la balise ressort **intacte** : rien n'est deviné.
  Cette réservation profite aussi au fantôme de balayage, qui construit son
  HTML avec la même fonction — l'article N+1 est justement le premier réchauffé.
- **Piège, payé cher** : le cycle 1.4.10 avait d'abord élargi la fenêtre de
  **texte** à dix articles et y avait ajouté le téléchargement des images du
  corps **par le proxy backend** (`cacheImages`). Effet mesuré sur iPhone : à la
  moindre pause dans le balayage, dix extractions plus quatre requêtes d'image
  chacune partaient d'un coup, saturaient le proxy (plafonné par utilisateur et
  par minute, `FRIRSS_PROXY_RATE_LIMIT`, pendant que l'extraction de fond y
  puise déjà), et le balayage suivant attendait derrière la file — 2 à 7 s au
  lieu de ~0,9 s par article. Cette version-là a été retirée. **Ne jamais
  réintroduire de récupération d'image proxifiée dans le volet de lecture** :
  les images ne passent que par le chargement direct décrit ci-dessus. Ce qui
  avait saturé le proxy n'était pas la largeur de la fenêtre de texte (revenue
  à dix, mais séquentielle : une requête par article) — c'étaient les quatre
  requêtes d'image par article qui s'y ajoutaient.
- **Assainissement à part** : `sanitizeExtracted()` est **plus permissif** que
  `sanitizeHtml()` sur un point, et doit l'être — il garde les `<iframe>`, sans
  quoi une vidéo intégrée à un article extrait disparaîtrait avant
  qu'`injectVideoFacades` puisse la voir. La permission est refermée aussitôt
  par `dropNonVideoIframes()` sur les seules vidéos que la façade sait lire.
- **Piège** : le résultat est **archivé tel quel** dans IndexedDB
  (`putExtract`). Ce qui est stocké doit donc correspondre à ce qu'une vue
  affiche : jusqu'à la 1.4.4 le stockage était plus large, et son innocuité ne
  tenait qu'au fait que `ReadingPane` repasse tout par `sanitizeHtml`. Une
  sûreté qui dépend de la vigilance de chaque futur consommateur n'en est pas
  une.

### Vidéos YouTube intégrées
Vignette cliquable (façade) au lieu d'un `<iframe>` chargé d'emblée.

- **Où** : `src/lib/youtube.ts`, `src/lib/articleThumbnail.ts`
- **Spec** : `docs/superpowers/specs/2026-08-19-youtube-facade-design.md`
- **Piège** : la façade doit être posée **avant** l'assainissement — après, il n'y
  a plus d'iframe à remplacer. `src/lib/youtubeFacade.sanitize.test.ts` épingle
  cet invariant.
- **Piège — spécificité CSS** : la vignette vit dans `.article-content`, et
  `.article-content img` pèse 0,1,1 (une classe + un type) contre 0,1,0 pour
  une classe seule. Elle héritait donc de `width:auto; height:auto;
  margin:1em 0` et s'affichait à sa taille **naturelle** — 480×360 pour
  `hqdefault.jpg` — dans une boîte 16:9 plus large qu'elle, découvrant le fond
  `--list-hover` : un rectangle vert sur la droite. Visible uniquement quand la
  colonne de lecture dépasse 480 px, donc sur bureau et jamais sur mobile, ce
  qui explique qu'il ait survécu longtemps. Corrigé par un sélecteur descendant
  (`.yt-facade .yt-facade__thumb`), qui repasse à 0,2,0. **Toute règle posée
  sur `.article-content <balise>` gagnera de la même façon contre le balisage
  que FriRSS injecte lui-même** : y penser avant d'en ajouter une.
- **Piège** : `reserveImgAspect()` ne pose rien sur la vignette. Le
  réchauffage en avant mesure l'image d'en-tête d'un article de flux YouTube,
  qui porte **exactement** l'URL `hqdefault.jpg` que la façade réutilise — la
  mesure existe donc, et un `aspect-ratio` 4:3 se serait posé sur une boîte
  16:9. Sans effet visible (la CSS fixe les deux dimensions), mais un mécanisme
  prévu pour les images d'un flux n'a rien à faire sur notre propre balisage.

---

## Abonnements

Ajout d'un flux par URL avec choix de la catégorie, renommage, suppression.

### Catégories (Préférences → Flux)
Renommer, supprimer, et déplacer un flux d'une catégorie à l'autre.

- **Où** : `src/lib/feedCategories.ts` (regroupement et validation, testés),
  `src/components/Preferences/CategoryList.tsx`, `feedStore`
  (`renameCategory`, `deleteCategory`, `moveFeedToCategory`)
- **Une catégorie n'est pas un objet stocké** : FreshRSS ne l'expose que
  **portée par ses flux** (`subscription.categories`). Il n'y a donc pas de
  liste à charger, seulement une liste à déduire — et **une catégorie vide
  n'existe pas**. En créer une se fait en y déplaçant son premier flux, ce que
  le sélecteur propose sous « nouvelle catégorie ». Même limite du modèle
  Google Reader que pour les catégories d'articles sauvegardés.
- **Supprimer une catégorie ne supprime aucun flux** : ils se retrouvent sans
  catégorie. La confirmation le dit **avant**, avec le nombre de flux
  concernés — c'est la question que pose toute suppression de catégorie, et y
  répondre après coup est trop tard.
- **Les trois actions rechargent les abonnements** au lieu de rapiécer l'état
  local : le serveur est seul à savoir ce qui reste après un renommage ou une
  suppression. `moveFeedToCategory` n'envoie que `a=` (ajouter à la catégorie),
  ce qui vaut déplacement parce que FreshRSS n'accorde qu'une catégorie par
  flux — mais on recharge derrière plutôt que de le supposer.
- **Pas de « retirer d'une catégorie »** : cela demanderait le paramètre `r=`,
  que `editFeed` n'envoie pas. Un flux sans catégorie apparaît dans le groupe
  « Sans catégorie », qui n'est ni renommable ni supprimable.
- **La barre oblique est refusée** dans un nom : l'identifiant est
  `user/-/label/<nom>`, et une barre à l'intérieur se lirait comme une
  imbrication.
- **Piège** : les actions de ligne (renommer / supprimer) sont révélées au
  survol par `group-hover`. **La classe `group` doit être sur la ligne**, sans
  quoi elles n'ont aucun parent à survoler et restent invisibles pour toujours.
  Écrit une première fois sans elle.

- **Où** : `src/components/Sidebar/AddFeedDialog.tsx`, `feedStore` (`addFeed`, `renameFeed`, `removeFeed`)
- **Note** : la découverte automatique du flux depuis l'URL d'un site est assurée
  par FreshRSS, pas par FriRSS.

---

## Étiquettes et articles sauvegardés

Étiquettes avec couleur, imbrication `Parent/Enfant`, héritage de couleur,
compteurs, réordonnancement.

Les **catégories d'articles sauvegardés** sont des étiquettes préfixées
(`À lire plus tard/Nom`). Le modèle Google Reader n'a pas d'étiquette vide : les
noms créés par l'utilisateur vivent dans les préférences synchronisées
(`savedCategoryNames`) et deviennent une vraie étiquette au premier article rangé.

- **Où** : `src/lib/savedCategories.ts`, `src/utils/labels.ts`, `src/components/Preferences/LabelsTab.tsx`
- **Spec** : `docs/superpowers/specs/2026-08-20-saved-categories-design.md`
- **Piège** : le préfixe est littéral et **en français** (`À lire plus tard/…`)
  quelle que soit la langue de l'interface, par cohérence avec l'identifiant déjà
  en dur pour cette étiquette.

---

## Relève des flux

Le bouton **Rafraîchir** demande à FreshRSS d'aller réellement chercher les
nouveaux articles, puis sonde le travail en cours et remplit la liste au fil de
l'eau. Sans jeton configuré, il se contente d'une relecture — le comportement
d'origine.

- **Où** : `server/actualizeRequest.ts`, `server/refreshJobs.ts`,
  `server/routes/servers.ts` (`/:id/actualize`), `src/lib/refreshPolling.ts`,
  `src/components/Preferences/servers/RefreshTokenField.tsx`,
  `src/components/RefreshBanner.tsx`
- **Spec** : `docs/superpowers/specs/2026-08-20-real-feed-refresh-design.md`
- **Réglages** : jeton maître (Préférences → Flux, écran de connexion, ajout de
  serveur) ; `FRIRSS_REFRESH_MAX_FEEDS`. Dans Préférences, le jeton se règle
  **par serveur**, depuis la ligne de chacun — y compris un serveur non actif.
- **Pièges** :
  - l'API greader **ne sait pas** déclencher une relève ; il faut l'action
    `c=feed&a=actualize`, hors API ;
  - FreshRSS applique un **contrôle CSRF global à tout POST**
    (`app/FreshRSS.php::initAuth()`), donc cet appel doit être un **GET** — le
    jeton apparaît par conséquent dans les journaux d'accès de FreshRSS ;
  - FreshRSS refuse de relever un flux plus d'une fois toutes les **20 minutes** :
    une relève peut légitimement ne rien ramener ;
  - le jeton maître donne aussi accès en **lecture** à tous les articles et à la
    liste d'abonnements. L'interface le dit avant la saisie ;
  - **`startJob` lance son travail SANS l'attendre** — voulu en production,
    l'appelant répond immédiatement. En test, cela laissait des `fetch` de
    relève se poser *après coup*, dans le `vi.stubGlobal('fetch')` d'un test
    **ultérieur**, où ils devenaient son `mock.calls[0]`. Un test lisait alors
    les en-têtes d'une requête qui n'était pas la sienne, par intermittence et
    selon la charge de la machine. `__settleJobs()` (réservé aux tests) draine
    les travaux en vol ; tout bloc de test qui déclenche une relève doit
    l'appeler dans son `afterEach`. Diagnostiqué en 1.4.5 sur un échec
    intermittent de `api.test.ts`.

### Retour visuel
Bandeau « X nouveaux articles » / « À jour » / « Relève en cours… », avec pulsation
des flux ayant reçu du contenu.

- **Où** : `src/lib/refreshDelta.ts`, `src/components/RefreshBanner.tsx`
- **Spec** : `docs/superpowers/specs/2026-08-16-refresh-feedback-design.md`

---

## Hors-ligne et PWA

Application installable (`display: standalone`). Les listes, les articles et les
images consultés restent lisibles sans réseau.

- **Où** : `src/lib/offlineStore.ts`, `src/lib/imageCache.ts`,
  `src/lib/offlineImages.ts`, `src/lib/storageEstimate.ts`,
  `src/components/OfflineBanner.tsx`, `src/components/UpdatePrompt.tsx`
- **Réglages** : préparation manuelle, mise à jour à l'ouverture, budget d'images
  (aucune / légère / standard / maximale)
- **Un seul remplisseur PROXIFIÉ du cache d'images** : la préparation manuelle
  (`feedStore.prepareOffline` → `imageCache.cacheImages`, seul `cache.put()`
  explicite du projet). Le choix des images y vit dans `articleImageUrls()`,
  exporté par `offlineImages.ts` et testé à part — c'était un helper privé du
  store. Le budget d'images (`imageBudget`) ne concerne que ce chemin-là.
- **L'autre remplisseur ne passe pas par le backend** : la route Workbox
  elle-même, quand le navigateur charge une image. C'est vrai du rendu d'un
  article, et donc du réchauffage en avant (`heroWarm.ts`, 1.4.10), qui charge
  l'image d'en-tête des dix articles suivants sur une `new Image()` détachée —
  aucune requête proxifiée, aucun budget consommé. La version proxifiée de ce
  réchauffage, essayée plus tôt dans le même cycle, bloquait le balayage sur
  iPhone : voir « Extraction du contenu complet ».
- **Spec** : `docs/superpowers/specs/2026-08-18-offline-images-design.md`
- **Piège majeur** : **récupérer une image ne la met pas en cache**. La route
  Workbox filtre sur `request.destination === 'image'`, ce qu'un `fetch()`
  programmatique ne produit pas. Et nginx envoie `connect-src 'self'`, donc un
  `fetch()` cross-origin est bloqué. Les images passent donc par le **proxy
  backend** puis un `cache.put()` explicite sous l'URL d'origine.

### File d'actions hors-ligne
Les actions faites sans réseau (lu, favori, à lire plus tard, étiquettes) sont
mises en file et rejouées au retour.

- **Où** : `src/lib/actionQueue.ts`
- **Piège** : `replayQueue()` est déclenché au montage **et** à chaque événement
  `online`. Sans garde, deux passes se chevauchaient, envoyaient chaque action
  deux fois, et la plus lente réécrivait la file de la plus rapide. Les appels
  concurrents attendent maintenant la même exécution (`replayInFlight`).
- **Spec** : `docs/superpowers/specs/2026-08-20-offline-action-queue-design.md`

### Jeton d'écriture (CSRF)
Toute écriture vers FreshRSS — ✓, favori, « à lire plus tard », étiquette,
« tout marquer comme lu », abonnement, renommage/suppression de libellé — est
signée par un jeton obtenu sur `/reader/api/0/token` et gardé en mémoire.

- **Où** : `src/api/feeds.ts` (`ensureToken`, `clearWriteToken`, `postSigned`),
  classification dans `src/lib/writeTokenRetry.ts`
- **Le piège qu'il a coûté** : le jeton n'était vidé qu'à la connexion et au
  changement de serveur. Une fois périmé — session FreshRSS renouvelée, serveur
  redémarré —, **toutes** les écritures échouaient jusqu'au rechargement de la
  page. Combiné au retrait optimiste de la ligne, cela donnait des articles qui
  disparaissaient de l'écran, un compteur de non-lus immobile, et tout qui
  revenait non lu au rechargement.
- **Une seule reprise.** `postSigned()` vide le jeton, en redemande un et
  rejoue l'écriture **une fois**, avec le jeton FRAIS. Un second échec ressort
  tel quel, sans transformation : rollback et file d'attente conservent
  exactement les décisions qu'ils prenaient déjà. La reprise unique tient à la
  forme du code — deux appels écrits en clair, ni boucle ni récursion.
- **Ce qui déclenche la reprise** : 401 (réponse canonique de greader,
  `Google-Bad-Token`), 403 et 400 selon la version de FreshRSS et le proxy
  devant. **Pas** une absence de réponse (c'est le hors-ligne, il doit aller
  en file sans délai), **pas** un 5xx, **pas** les autres 4xx.

---

## Accessibilité et confort d'usage

Travail transversal, sans écran dédié — il vit dans `src/styles/index.css` et
dans quelques composants partagés.

- **Focus clavier** : un anneau `:focus-visible` global (`index.css`). Chaque
  sélecteur est écrit en toutes lettres plutôt que dans un `:where()`, pour
  valoir 0-1-1 et l'emporter sur l'utilitaire `.outline-none` (0-1-0) quel que
  soit l'ordre du fichier. La couleur mélange l'accent à `--reading-title`,
  c'est-à-dire à la couleur du **texte de la surface** : elle fonce sur un fond
  clair, s'éclaircira sur un fond sombre, sans deuxième clé de thème. La barre
  latérale reprend l'accent pur.
  *Avant la 1.4.5 : 137 boutons, 4 anneaux de focus (tous dans `Login.tsx`),
  aucune occurrence de `:focus-visible`, 18 `outline-none`.*
- **Zoom iOS** : la règle `@media (max-width: 768px) { input { font-size: 16px } }`
  vaut 0-0-1 et **perdait** contre `.text-sm` (0-1-0). Elle porte désormais
  `!important` — c'est la seule façon de battre un utilitaire sans le dupliquer
  sur vingt appels. Le champ de recherche de la liste garde son style en ligne,
  qui était le contournement ponctuel du même problème.
- **Cibles tactiles** : le bloc `@media (pointer: coarse)` couvre maintenant les
  champs en plus des boutons (44 px). Exclusions communes aux deux règles :
  cases à cocher, boutons radio, sélecteurs de couleur et curseurs, qui ont leur
  propre dimensionnement.
- **Mouvement réduit** : `prefers-reduced-motion` couvre le reste des animations.
  **Pas** de règle attrape-tout `* { animation: none }` : le bandeau de relève se
  ferme *par* une animation et resterait affiché indéfiniment. Les rotations de
  chargement sont gardées aussi. Les deux transitions mobiles
  (`MobileStack`, `MobileDrawer`) posent leurs durées en style en ligne, hors
  d'atteinte du CSS : elles lisent `prefersReducedMotion()`
  (`src/lib/reducedMotion.ts`).
- **Noms accessibles** : les boutons à icône seule portent un `aria-label` en
  plus du `title` (une infobulle, que le tactile n'affiche jamais et que les
  lecteurs d'écran annoncent inégalement). **Règle** : ne jamais poser
  d'`aria-label` sur un bouton dont le libellé est visible et différent — cela
  casserait « Label in Name » au lieu de le corriger. Les composants partagés
  (`ToolbarBtn`, `ActionBtn`) le posent depuis leur prop `label`, celle-là même
  qu'ils affichent quand le contexte le permet.

---

## Apparence et thèmes

**36 couleurs** en 6 groupes, **7 tailles** de police en 3 groupes, nom et logo
de l'application, thèmes enregistrables, exportables en CSS, importables et
partageables par lien. **Quatre thèmes sont livrés** et le thème peut suivre le
réglage clair/sombre du système.

- **Où** : `src/stores/themeStore.ts`, `src/components/Preferences/AppearanceTab.tsx`,
  `src/components/Preferences/ThemePreview.tsx`, `src/components/Preferences/colorHighlight.ts`
- **Section ouverte par défaut** : **Thème** (la galerie), pas Couleurs. C'est
  le geste le plus courant et le seul qui change tout d'un coup ; les 36
  couleurs viennent après.
- **Ordre des groupes de couleurs** : **Accent en premier**. C'est la couleur
  qui teinte toute l'interface — badges, liens, états actifs, anneau de focus —
  donc celle qu'on vient changer d'abord ; elle était en troisième position,
  sous deux sections de réglages fins de la barre latérale.
- **Thèmes livrés** (1.4.5), définis dans `SHIPPED_THEMES` : `FriRSS Default`
  (clair), `FriRSS Riso` (clair), `FriRSS Paper` (clair, sépia),
  `FriRSS High Contrast` (clair), `FriRSS Night` (sombre),
  `FriRSS Desk` (sombre). **Les clairs d'abord dans la galerie** : c'est ce
  qui est préféré, autant que ce soit ce qu'on voit en premier.
  - **Un thème va jusqu'au bout de son idée, barre latérale comprise.** Paper
    a longtemps été une page sépia surmontée d'un bandeau menthe, avec un
    accent vert et des survols verdis : le vert de la marque appartient au
    thème par défaut et à `Night`, pas à une page de livre. Il est désormais
    sépia partout — cuir sombre, bandeau tan→brun, encre sienna. Le contrôle à
    faire sur tout nouveau thème : `sidebar-header-from/to`, `accent`,
    `list-hover` et `list-selected` sont les quatre endroits d'où la teinte du
    thème par défaut a tendance à survivre.
  - **`Riso`** résout la contrainte propre aux thèmes **clairs** : le fond doit
    rester blanc (le teinter a été essayé deux fois et rejeté), donc le blanc
    doit être **le sujet** plutôt qu'un pis-aller. Ici c'est le papier d'une
    impression risographe, et l'encre fluo rose est la couleur signature du
    procédé. Le rose descend en trois profondeurs — encre pleine dans le
    bandeau, version assombrie pour l'accent qui porte du texte sur blanc, et
    presque-noir pour l'encre des titres — si bien que la page appartient à une
    famille **sans qu'aucune surface soit teintée** : le rose ne touche que le
    survol et la sélection. Ce qui le sépare de `Neon`, retiré : là, deux
    couleurs saturées sur fond sombre se disputaient l'écran.
  - **Deux leçons payées cher**, à relire avant d'en proposer un autre :
    l'idée d'un thème doit être **visible** — `Lowlight` reposait sur une
    baisse de contraste, un principe qu'on ne voit pas, et il ne restait à
    l'écran que charbon + ambre. Et un référent concret (page de livre, photo,
    matériau) donne un meilleur résultat qu'un accord de couleurs choisi dans
    l'abstrait — c'est ce qui sépare `Paper`, `Desk` et `Porcelain` de tous
    ceux qui ont été retirés.
- **Ce qui a été essayé et écarté** — Lagoon, Neon et Circuit, en sombre puis
  en clair, plus Midnight, Ember, Nordic, Lowlight, Velvet et Porcelain. La leçon, à retenir avant d'en
  proposer d'autres : **une palette bâtie autour de deux couleurs vives donne
  un écran qui fatigue vite**, et sur fond clair la couleur doit être si
  assombrie pour rester lisible qu'il n'en reste plus grand-chose. Ce qui tient
  est un fond franc — blanc ou noir — et une seule couleur qui ponctue.
  Tous ces noms vivent dans `RETIRED_THEME_NAMES` et sont retirés des listes
  enregistrées. Le test ne fige pas
  leur nombre — il vérifie que le thème par défaut ouvre la liste et que les
  noms sont uniques.
  - **Comment on en ajoute un** : l'utilisateur donne deux couleurs
    principales — ou une image de référence — **et dit s'il le veut clair ou
    sombre**. La palette complète est dérivée de là.
  - **Recette** : la première couleur devient l'accent (et ouvre le dégradé
    d'en-tête), la seconde ferme ce dégradé **et** prend les liens, pour
    qu'elle ait un rôle et pas seulement une présence.
  - **Le compromis des thèmes clairs** : une couleur vive et saturée ne tient
    pas le contraste sur un fond clair — `#4cdcbc` sur blanc ne donne que
    1,6:1. La couleur d'origine garde donc les **grandes surfaces** (le dégradé
    d'en-tête, où elle est incontestable) pendant qu'`accent`, qui habille du
    texte et des icônes, prend une version **assombrie de la même teinte**.
    Le fond, lui, reste **blanc** : teinter les panneaux à la couleur du thème
    a été essayé et rejeté (voir ci-dessus).
    Repère mesuré : `list-source` est du texte de 10 px, donc l'accent vise
    4,5:1 sur `panel-bg`. Lagoon, Neon, Desk et Circuit sont entre 5,0 et 5,5 —
    au-dessus du thème par défaut (1,8) et de Paper (3,0), qui sont hérités.
  - Dans un thème clair, la barre latérale **reste sombre** : c'est elle qui
    donne sa structure à l'écran, et la règle de hiérarchie tient toujours. Trois préréglages
    (`Midnight`, `Ember`, `Nordic`) ont été inventés sans cette étape et
    retirés aussitôt : une galerie de thèmes que personne n'a demandés
    encombre plus qu'elle ne sert. Ils sont listés dans
    `RETIRED_THEME_NAMES` et **activement retirés** des listes enregistrées,
    puisque c'est `ensureShippedThemes()` qui les y avait mis. Un choix
    « suivre le système » qui les visait retombe sur le préréglage
    correspondant, sans quoi le réglage cesserait d'agir en silence. Ce sont de simples
  **thèmes enregistrés** : `ensureShippedThemes()` garantit leur présence en
  tête de la liste — comme le thème par défaut l'était déjà — et « Charger »
  les applique sans machinerie nouvelle. Un préréglage modifié par
  l'utilisateur n'est jamais écrasé ; un préréglage supprimé revient au
  chargement suivant, parce que « suivre le système » a besoin d'eux.
  *Avant : le moteur savait tout faire — 36 couleurs, export, import, partage —
  mais ne livrait qu'un thème. Atteindre un thème sombre demandait de régler 36
  valeurs à la main.*
  - **Leurs noms ne sont pas traduits.** Le nom est l'identifiant : le traduire
    casserait la correspondance au changement de langue. Cohérent avec
    `FriRSS Default`, qui l'était déjà.
  - **Chaque préréglage définit les 36 couleurs.** `themePresets.test.ts` échoue
    si l'un en oublie une — une clé absente laisserait sur `:root` la valeur du
    thème précédent, ce qui donne une interface à moitié sombre.
  - **Piège majeur, corrigé** : un préréglage livré suit désormais le **code**,
    il n'est plus figé à la première version reçue. L'inverse était le
    comportement d'origine et s'est retourné contre nous — les quatre thèmes
    commandés ont été repassés en clair et **personne ne l'a jamais vu** : la
    copie enregistrée l'emportait, sans aucun moyen de s'en sortir depuis
    l'interface. Un correctif de préréglage doit atteindre tout le monde.
    Sans risque pour les personnalisations : régler une couleur modifie le
    thème **actif** (`frirss_theme`), pas l'entrée enregistrée — celle-ci ne
    change que si on appuie sur « Enregistrer » sous ce nom. Une variante
    personnelle se garde donc sous son propre nom.
  - **Migrations** : `migrateColors` ne concerne plus que les thèmes
    **personnels**, les préréglages venant du code. Le premier terme de chaque
    entrée est une **liste** d'anciens défauts : une couleur peut en avoir eu
    plusieurs (`list-active` a été lilas, puis beige, puis gris neutre) et
    toutes doivent mener à la valeur du jour, sinon la moitié des installations
    reste sur une teinte abandonnée selon la version d'où elle vient.
  - **Règle de hiérarchie** : la barre latérale reste *plus sombre* que les
    panneaux. En thème sombre elle descend sous eux (`#151410` contre
    `#201f1b`) ; l'inverse la fait flotter.
- **Suivre le système** : `followSystem`, `lightThemeName`, `darkThemeName`
  (synchronisés). `syncSystemTheme()` applique le thème visé, et **conserve les
  tailles de police courantes** — une bascule au coucher du soleil qui
  remettrait aussi le corps de texte à sa valeur d'usine serait une mauvaise
  surprise. « Charger » à la main garde, lui, son remplacement complet.
  Deux déclencheurs : l'événement `change` de `matchMedia`, et le retour au
  premier plan (`visibilitychange`) — le système bascule souvent pendant que
  l'onglet est masqué, ce qui est le cas courant d'une PWA laissée ouverte.
  Un thème visé qui n'existe plus ne déclenche rien : mieux vaut laisser le
  thème courant que basculer vers ce que personne n'a choisi.
- **Les surfaces de lecture sont NEUTRES.** Décision prise à l'essai, après
  deux tentatives de teinte : `panel-bg` `#ffffff`, `panel-header-bg`
  `#fafafa`, `panel-border` `#e8e8ec`, `list-active` `#f0f0f0`. La revue
  d'interface proposait un papier tiède pour s'accorder au noir chaud de la
  barre latérale ; les thèmes de couleur ont ensuite reçu un fond légèrement
  teinté de leur propre teinte. Les deux se lisent comme **un voile de couleur
  sur les articles** — c'est le retour reçu, deux fois. La teinte reste où elle
  est le sujet (« Paper »), et où elle a un sens transitoire (survol,
  sélection). **Ne pas reteinter la surface de lecture.**
- **Aides visuelles** : survoler une couleur **encadre l'élément réel** derrière le
  panneau, et **cercle la zone correspondante** dans un aperçu vivant qui se
  recompose en direct. Couverture : 28 couleurs encadrables sur l'interface, 14
  avec une zone d'aperçu, **6 avec aucune des deux** — l'interface le dit au lieu
  de laisser attendre une mise en évidence qui n'arrivera pas.
- **Piège majeur — l'accent n'est PAS lisible partout.** Il est réglé pour le
  **panneau**. Dans un thème clair il est assombri pour tenir sur le blanc, et
  devient alors illisible sur la **barre latérale**, qui reste sombre : le
  compteur de non-lus y disparaissait dans tous les thèmes clairs sauf celui
  par défaut, dont l'accent est clair par chance. Mesuré : accent sur
  `sidebar-bg` à **2,2** dans « Paper », **3,1** dans « Riso », **3,9** dans
  « High Contrast ».
  `applyThemeToDOM()` publie donc `--sidebar-badge-text`, `--sidebar-badge-bg`,
  `--sidebar-star` et `--sidebar-readlater`, calculés par `readableOn()`
  (`src/lib/readableText.ts`), qui éclaircit juste assez pour atteindre 4,5:1
  **en gardant la teinte**. **Toute couleur posée dans la barre latérale doit
  passer par là**, jamais par `--accent` ni `--badge-*`, qui appartiennent au
  panneau.
- **Piège des couleurs en dur** : `--badge-bg` et `--badge-text` sont dérivés
  de l'accent, mais le badge de non-lus de la barre latérale écrivait le menthe
  à 15 % en dur — sur un thème dont l'accent change (« Paper », « High
  Contrast »), il restait vert. Corrigé en 1.4.5, en même temps que les trois
  surbrillances de glisser-déposer restées orange. **Aucune couleur de
  l'interface ne doit être écrite en dur** : elles sont toutes réglables.
- **Encres dérivées** : `--on-accent` et `--on-danger` sont calculées par
  `applyThemeToDOM()` avec `readableTextOn()` (`src/lib/readableText.ts`,
  luminance WCAG). Ce ne sont **pas** des clés de thème : rien à régler, elles
  suivent l'accent et la couleur de danger choisis. Tout remplissage plein par
  l'une de ces deux couleurs doit écrire son texte avec l'encre correspondante,
  jamais `text-white` — le blanc sur l'accent menthe par défaut ne donnait que
  1,9:1, et un accent pâle faisait disparaître le libellé de son propre bouton.
  Même fonction pour les pastilles d'étiquette et les pastilles-lettres, dont la
  couleur vient de l'utilisateur ou d'un hachage.
- **Piège** : `--sidebar-header-from` / `--sidebar-header-to` sont des **clés de
  thème**, pas des variables CSS ; seul `--sidebar-header-bg` est publié.

---

## Préférences

Panneau à navigation verticale : **Général** (langue, lecture, raccourcis),
**Apparence** (thème, couleurs, tailles, identité), **Mise en page** (icônes
d'action de la ligne d'article), **Étiquettes**, **Flux** (gestion des
serveurs FreshRSS et jeton maître de chacun), **Hors-ligne**, plus
**Administration** pour les administrateurs.

- **Où** : `src/components/Preferences/`
- **Spec** : `docs/superpowers/specs/2026-08-21-preferences-rework-design.md`
- **Garde-fou** : `src/components/Preferences/settingsCoverage.test.ts` fige un
  relevé de **232 réglages** et échoue si l'un cesse d'être référencé. Ne jamais
  modifier le relevé pour faire passer le test. Son parcours est **récursif**
  depuis le 2026-08-26 : à plat, il déclarait disparu tout réglage déplacé dans
  un sous-dossier du panneau.
- **Montage des sections** : une section n'est montée qu'à sa **première
  visite**, puis y reste, masquée par un `display:none` en ligne. Le montage
  conditionnel d'origine la détruisait à chaque changement : Flux et
  Administration, les deux seules sections qui appellent le réseau au montage,
  repayaient un aller-retour complet à chaque retour, écran vide. Mesuré après
  correction : **zéro requête** sur trois allers-retours entre deux sections.
  - Le style en ligne n'est pas un caprice : la règle
    `.prefs-panel-body > [hidden]` ne vise que les enfants directs, et
    l'attribut `hidden` seul perd contre une classe utilitaire d'affichage.
  - **Conséquence à ne pas oublier** : une section qui reste montée ne peut plus
    compter sur son démontage. Trois d'entre elles reçoivent donc une prop
    `active` — `AppearanceTab` (sans quoi l'encadrement de couleur resterait à
    l'écran depuis une autre section), `OfflineTab` (qui doit relire l'espace
    disque à chaque retour) et `AdminTab` (qui revalide en silence, sans
    repasser par son écran de chargement).
- **Synchronisation** : les préférences logiques sont synchronisées par le serveur
  (`UI_SYNC_KEYS`) ; les préférences géométriques — largeurs de panneaux,
  visibilité de la barre latérale — restent locales à chaque appareil.
- **Mise en page** (`src/components/Preferences/LayoutTab.tsx`) : quatre
  interrupteurs, un par icône de la barre d'actions d'une ligne d'article
  (favori, à lire plus tard, ouvrir à la source, ✓) — toutes actives par
  défaut. Un seul objet en stockage (`useUiStore(s => s.rowActions)`,
  `setRowAction(kind, visible)`, clé `frirss_rowActions`), pas quatre
  booléens séparés : une seule entrée dans `UI_SYNC_KEYS` et dans les clés
  JSON restaurées, qu'une cinquième icône future n'aura pas à toucher.
  Décocher une icône **retire** son emplacement (les autres se resserrent) ;
  c'est différent de l'absence par article (ex. « ouvrir à la source » sans
  URL source), qui **réserve** l'emplacement au lieu de le retirer — voir
  `rowActionSlots()` plus haut. Cette section ne règle QUE les outils
  affichés sur la ligne : ni les boutons du volet de lecture (qui gardent les
  leurs, indépendamment), ni la piste d'options en tête de liste (source,
  favicons, séparateurs de dates, barre — qui règle le CONTENU montré par la
  ligne, pas les OUTILS qu'elle propose).
  - **Piège — deux des quatre interrupteurs emportent un geste avec eux.**
    Masquer « Favori » ou « À lire plus tard » retire aussi l'appui long (et le
    clic droit) qui classe un article dans une catégorie depuis la liste : le
    geste vit dans ces deux boutons, pas dans la ligne. Le texte d'aide de la
    section l'annonce ; les balayages et les raccourcis, eux, sont bien
    inchangés.
  - **Piège** : un appareil resté sur une version antérieure à cette
    fonctionnalité synchronise (ou relit depuis `localStorage`) un objet
    `rowActions` auquel il manque les clés ajoutées depuis. Sans
    complétion, `settings[kind]` vaudrait `undefined` — donc faux — et une
    icône disparaîtrait sans que personne l'ait décoché. `normalizeRowActions()`
    (`src/lib/rowActions.ts`) comble les clés manquantes avec
    `DEFAULT_ROW_ACTIONS`, et tourne aux **deux** endroits où l'objet entre
    dans le magasin : au chargement (`loadJson` + `normalizeRowActions`) et à
    la restauration synchronisée (`applyServerPrefs`) — exactement le même
    piège, et le même remède, que `normalizeImagePreset` pour
    `offlineImagePreset`.

---

## Administration

Gestion des comptes (création, édition, rôle, mot de passe, suppression), mode
d'authentification, configuration OIDC, URL break-glass, ouverture des
inscriptions, animation de connexion.

- **Où** : `server/routes/admin.ts`, `src/components/Preferences/AdminTab.tsx`

---

### Gouttière de défilement
`.nice-scroll` (`src/styles/index.css`) réserve la gouttière en permanence
(`scrollbar-gutter: stable`), sur la liste d'articles et le volet de lecture.

- **Pourquoi** : sans elle, la colonne change de largeur chaque fois que la
  barre de défilement apparaît ou disparaît. Depuis que le ✓ retire la ligne
  (2026-09-01), la liste franchit ce seuil en permanence — un retrait la fait
  passer sous la fenêtre, le rattrapage la repasse au-dessus — et la colonne
  tressautait sous le curseur pendant un marquage rapide.
- **Piège** : le symptôme est invisible pour qui a des barres en superposition
  (macOS par défaut), puisqu'elles ne prennent aucune place. Il n'apparaît
  qu'avec des barres classiques — macOS réglé sur « Toujours », Windows, Linux.
  Ne pas conclure d'un écran de développeur que le problème n'existe pas.

## Backend

### Journal d'accès
Une ligne par requête sur la sortie standard : horodatage, méthode, **chemin**,
code, durée. `/api/health` est sauté (bruit de sonde) et le journal est muet
sous `NODE_ENV=test`.

- **Où** : `server/accessLog.ts` (monté dans `server/index.ts`)
- **Ce que l'instance retient de ses lecteurs — décision du 2026-09-04** : la
  **chaîne de requête n'est pas journalisée**. Le middleware écrivait
  `req.originalUrl` ; c'était sans conséquence tant qu'aucune route ne portait
  de donnée en query string, et `/api/proxy` passe sa cible dans un en-tête,
  qui n'est pas journalisé. `GET /api/extract?url=…` (1.4.10) a changé cela :
  un conteneur de production aurait consigné l'URL complète de **chaque
  article extrait par chaque compte** — préchargement des dix articles suivants
  et balayage `prepareOffline` de trente jours compris, donc un historique de
  lecture plus large que ce que la personne a réellement lu. Le journal écrit
  donc `req.path`.
- **Pourquoi le chemin plutôt qu'une exception pour cette route** : une
  exception aurait été à re-décider à chaque nouvelle route portant une donnée
  en query string, et à oublier une fois. La cible n'a pas quitté la query
  string en revanche — l'y déplacer aurait touché la garde anti-SSRF, le seau
  de cadence et la clé de cache pour un gain nul sur le journal.
- ⚠️ **Piège — le chemin se lit AVANT le routage.** Express réécrit `req.url`
  en relatif au routeur qui traite la requête et ne le restaure qu'au retour de
  `next()`, ce qu'une route qui RÉPOND ne fait jamais. La première version lisait
  `req.path` depuis `res.on('finish')` : la production journalisait donc `GET /`
  pour `/api/proxy` **comme** pour `/api/extract` (les deux routes les plus
  volumineuses, devenues indiscernables), `POST /login` pour `/api/auth/login`,
  `PUT /users/3` pour `/api/admin/users/3` — toutes les routes sauf
  `/api/health` perdaient leur préfixe. La confidentialité était tenue, la
  valeur d'exploitation perdue. Le middleware capture donc le chemin à
  l'entrée ; `server/test/accessLog.test.ts` échoue si on le relit trop tard.
- **Ce qui reste journalisé, et doit le rester** : `finishError` écrit une ligne
  pour un refus de cible (trace promise à un balayage SSRF, voir *Proxy*), pour
  une panne de résolution et pour un échec d'amont. La ligne d'accès défaisait
  cette intention sur le chemin du succès, qui est le cas courant ; elle ne la
  défait plus.
- **Et ces lignes-là ne portent plus l'URL d'un article** (2026-09-04) :
  `/api/extract` ne passe à `finishError` que l'**origine** de sa cible, jamais
  le chemin. Le journal d'accès ne suffisait pas : l'échec d'amont, lui, écrivait
  la cible entière, et le refus le plus fréquent de cette route est un domaine
  d'article mort (`ENOTFOUND`) — un balayage hors ligne en déposait des dizaines.
  `/api/proxy` garde son chemin complet : là, c'est le point de terminaison
  greader qui a échoué, et c'est ce qu'on relit en exploitation.

### Proxy
Point de passage unique vers FreshRSS. Il sert aussi l'extraction d'articles,
mais seulement **en repli** depuis la 1.4.10 : le client demande d'abord
`/api/extract`, et ne récupère la page lui-même que si cette route n'a pas
répondu (voir *Extraction du contenu complet*).

- **Où** : `server/routes/proxy.ts`
- **Protection SSRF** : cibles internes bloquées par défaut, en littéral **et**
  après résolution DNS (ce qui défait `10.x.x.x.nip.io`), à chaque saut de
  redirection. `PROXY_INTERNAL_HOSTS` autorise explicitement des hôtes internes.
  Le refus renvoie `403 { error: 'Target host not allowed' }` — corps que
  l'écran de connexion reconnaît pour nommer la cause (voir *Serveurs
  FreshRSS*). Le README documente le cas à l'endroit où on le rencontre :
  la dernière étape de l'installation.
- **Une panne de résolveur n'est PAS un refus** (2026-09-04) : quand le
  résolveur n'a rien répondu du tout (`EAI_AGAIN`, `EAI_FAIL`, délai dépassé —
  `UnresolvedTargetError`), la réponse est `503 { error: 'Target host
  unresolved' }`, pas un 403. Les deux se répondaient à l'identique, au nom d'un
  argument d'oracle : un code à part aurait appris par différence qu'un 403
  signifie « cet hôte résout vers le réseau interne ». L'argument ne tient pas —
  ce cas ne se produit que lorsque le résolveur s'est tu, c'est un fait sur le
  résolveur et non un classement de la cible, et qui sonde un hôte dont il tient
  le DNS connaît déjà ce classement. Le prix de la confusion, lui, était payé
  par l'utilisateur : voir la *Résolution bornée* ci-dessous. Ce qui ne change
  pas : rien n'est joint, `fetchUpstream` ne se replie pas dessus. Un nom
  INEXISTANT (`ENOTFOUND`) reste un refus 403 — c'est l'état stable d'un hôte
  interne retiré de `PROXY_REWRITES`, pas un hoquet.
- **Résolution bornée dans le temps** : `assertTargetSafe` n'attend pas plus de
  `LOOKUP_TIMEOUT_MS` (5 s). ⚠️ **Ce plafond ne concerne pas que l'extraction**,
  bien qu'il ait été introduit pour elle : `assertTargetSafe` garde TOUTES les
  sorties du backend, donc `/api/proxy` (chaque lecture et écriture FreshRSS,
  chaque favicon), le worker de synchronisation (`server/worker.ts`), la
  découverte OIDC (`server/oidc.ts`) et le rafraîchissement de flux
  (`server/routes/servers.ts`). Conséquence, et c'est ce qui a rendu le 503
  ci-dessus nécessaire : sous musl une seule tentative dure déjà ces 5 s, donc
  un unique paquet DNS perdu — qui aboutissait autrefois au second essai — rend
  `ETIMEDOUT`. Tant que ce cas répondait 403, l'écran de rattachement d'un
  serveur FreshRSS annonçait à l'utilisateur que **son hôte était refusé**, avec
  la marche à suivre de `PROXY_INTERNAL_HOSTS` en prime : une erreur qui accuse
  une cause qu'elle n'a pas vérifiée. `dns.promises.lookup` n'accepte aucun délai, et la
  borne réelle serait sinon le budget de reprise du résolveur du système (musl :
  5 s par tentative, 2 tentatives par serveur de noms). **Ce que le plafond
  borne : UNE résolution**, pas la réponse rendue. Une requête qui en déclenche
  plusieurs les additionne — un échec de cache sur `/api/extract` en fait deux
  (garde pré-cache puis `fetchUpstream`, plus une par saut de redirection) :
  10 s sans redirection, et jusqu'à ~35 s au bout des `MAX_REDIRECTS` (5)
  sauts, qui portent le compte à 1 + 6 résolutions. **Limite connue** : ce plafond ne borne pas non plus le
  fil de `libuv` — `dns.lookup`
  s'exécute sur le pool de threads (4 par défaut, `UV_THREADPOOL_SIZE` n'est
  fixé nulle part, pool partagé avec les entrées-sorties fichier et la
  cryptographie) et abandonner l'attente ne rend pas le fil. Un résolveur en
  panne coûte donc encore des fils occupés, mais plus des requêtes immobiles —
  ce qui compte, la préparation hors-ligne tirant 4 requêtes de front (`BATCH`,
  `src/lib/imageCache.ts`), soit exactement la taille du pool. **Aucune
  mémorisation** des résolutions non plus, et c'est délibéré : garder un verdict
  « sûre » quelques secondes élargirait d'autant la fenêtre de la limite notée
  ci-dessus (l'adresse validée n'est pas épinglée).
- **Exception assumée — la lecture `X-Cache-Only` précède la garde complète.**
  Cette branche (peinture instantanée, sans aller-retour FreshRSS) ne franchit
  que le pré-contrôle littéral : `assertTargetSafe` n'y tourne pas, et un hôte
  interne au nom POINTÉ retiré depuis de `PROXY_INTERNAL_HOSTS` peut donc
  encore se faire rendre son entrée, sans refus ni ligne de journal — le trou
  qu'`/api/extract` a fermé de son côté, en beaucoup plus étroit. Ce qui
  l'étrécit : la clé porte l'identifiant de l'utilisateur et `isCacheableRead`
  exige un GET sur `/reader/api/0/`, donc un appelant ne relit que ce que SON
  compte a mis en cache du temps où l'hôte était autorisé, jamais le travail
  d'un autre. Y placer la garde complète coûterait une résolution DNS sur le
  chemin de peinture instantanée, celui qui doit précisément répondre sans
  réseau : troc refusé, exception écrite plutôt que tue.
- **Réécritures** : `PROXY_REWRITES` remplace l'URL publique par une adresse
  interne — gros gain de latence quand FriRSS et FreshRSS partagent un réseau.
- **Règle** : tout nouvel appel sortant passe par `fetchUpstream()`, jamais par
  `fetch()` directement, sous peine de contourner le garde SSRF.
- **Redaction** : `redactUrl()` retire la valeur d'un paramètre `token` avant
  toute écriture dans un journal.
- **Aucun en-tête d'identification fourni par le client n'est honoré.** Le jeton
  greader est injecté côté serveur, et seulement là. Un repli `X-Freshrss-Auth`
  a existé « pour l'installation, avant qu'une ligne serveur existe » — mais
  personne ne l'envoyait jamais : le flux d'installation passe les identifiants
  dans le corps du ClientLogin puis enregistre le jeton via `/api/servers`. Il
  ne servait qu'à laisser un compte authentifié attacher l'`Authorization` de
  son choix à n'importe quelle cible autorisée. Retiré en 1.4.4, avec un test
  qui garde la porte fermée.
- **Limite connue, assumée** : le garde valide l'hôte après résolution, mais
  **n'épingle pas** l'adresse validée — `fetch()` résout de nouveau à la
  connexion. Un DNS à TTL nul qui répond une adresse publique puis une adresse
  privée passe donc au travers. Le refermer imposerait de reconstruire la
  requête sortante sur `node:http(s)` (seuls à accepter une option `lookup`),
  donc de réimplémenter décompression, flux et annulation dans la fonction la
  plus sensible de l'application. Arbitrage écrit dans `SECURITY.md` : à
  revoir si l'inscription est ouverte aux inconnus.
- **Cadence** : `FRIRSS_PROXY_RATE_LIMIT` plafonne les requêtes proxifiées par
  utilisateur et par minute (600 par défaut, `0` désactive). La clé est
  l'identifiant de l'utilisateur, jamais son IP : plusieurs personnes derrière
  un même NAT ne doivent pas se partager un seau. Sans plafond, chaque compte
  emportait un relais anonymisant.
  **Le middleware est exporté (`proxyRateLimiter`) et `/api/extract` réutilise
  cette instance** : le plafond est UN seau pour les deux routes sortantes.
  Piège : `rateLimit()` s'alloue un `MemoryStore` neuf à chaque appel — deux
  appels de même configuration donnent deux compteurs indépendants sur le même
  identifiant, donc le double du plafond annoncé et une protection contournable
  en changeant d'URL. Le partage est vérifié par un test de comportement
  (`server/test/proxyRateLimit.test.ts`, plafond abaissé à 2), pas par une
  lecture du texte des sources — un garde-fou qui lisait `extract.ts` restait
  vert quand la ligne `router.use(...)` était mise en commentaire.
  À noter : ce magasin est **en mémoire, donc par processus**. Le plafond vaut
  par processus Node, pas par instance — sans effet sur l'image Docker de
  FriRSS, qui n'en lance qu'un, mais ce serait à revoir derrière plusieurs
  répliques (il faudrait alors un magasin partagé, Redis par exemple).
- **Un refus de cible est toujours journalisé** : le pré-contrôle littéral de
  `/api/proxy` comme la garde par résolution passent par `finishError`, qui
  écrit la cible (expurgée) dans le journal — sur `/api/proxy` comme sur
  `/api/extract`, qui lèvent la même `BlockedTargetError` exportée. Laisser
  l'un des deux répondre 403 en silence vidait de son sens la trace promise :
  les sondes les plus bruyantes (`http://127.0.0.1:6379/`, un nom de service
  nu, une IP privée) sont justement celles que le pré-contrôle tranche sans
  rien résoudre. Le corps de la réponse, lui, ne nomme jamais la cible — ce
  serait offrir un scanner de réseau interne.
- **Ordre des middlewares — piège** : `requireAuth` **avant** `express.raw`.
  L'inverse mettait jusqu'à 5 Mo en mémoire pour un inconnu avant de lui rendre
  son 401 ; sa signature était un `413` répondu à une requête non
  authentifiée.

### Extraction d'articles
`GET /api/extract?url=…` rend l'article extrait en HTML **brut, non assaini** :
c'est le **client** qui assainit à la réception, et l'afficher sans passer par
là est une faille XSS. Depuis la 1.4.10, `extractFullContent()` interroge cette
route **avant** d'extraire elle-même, et applique `sanitizeExtracted()` à ce
qu'elle rend (voir *Extraction du contenu complet*).

- **Où** : `server/routes/extract.ts`, `server/extract.ts`
- **Cache** : Redis, clé `frirss:x:<sha1(url)>` — **sans identifiant
  d'utilisateur**, contrairement au cache de listes. Le texte extrait d'une
  page est le même pour tous : c'est ce qui fait qu'un appareil profite du
  travail d'un autre, et qu'à dix comptes la page n'est extraite qu'une fois.
  TTL commun (`CACHE_TTL`, 24 h).
- **Fraîcheur : aucune détection de modification de la source, et aucun moyen
  de forcer une ré-extraction.** La doc a prétendu jusqu'au 2026-09-04 que « le
  bouton *Article complet* relance à la demande » : c'est faux deux fois.
  `handleExtract` (`src/components/ReadingPane/ReadingPane.tsx`) lit la mémoire
  puis IndexedDB et ne ré-extrait jamais ce qui est déjà en cache ; et même un
  cache local vidé serait servi par l'entrée Redis de 24 h, la route n'ayant
  aucun paramètre de contournement. Ce qui rafraîchit réellement, c'est
  `revalidateIfStale` (`src/lib/extractCache.ts`), au bout de 12 h — mais le
  serveur lui répond depuis une entrée qui vit 24 h, donc en pratique un article
  modifié ressort avec **jusqu'à ~24 h** de retard, pas 12, et une revalidation
  qui tombe sur le cache serveur ne fait que repousser `cachedAt`. Décrit tel
  quel plutôt que corrigé : ajouter un contournement rouvrirait à chaque client
  le droit de faire ré-extraire une page à volonté.
- **Analyse bornée : une à la fois, cinq requêtes au plus dans la file**
  (une en cours, quatre en attente — `EXTRACT_MAX_PENDING`,
  `server/extract.ts`). `parseHTML` + `Readability` sont **synchrones** : de
  ~20 ms pour 0,1 Mo à ~1 s au plafond de lecture (5 Mo), pendant lesquels
  l'unique processus Node qui sert toute l'instance ne fait rien d'autre — et
  cette charge est NEUVE, elle vivait sur chaque téléphone avant la 1.4.10. Le
  seau de cadence (600/min et par compte) permet un ordre de grandeur de plus
  que ce que la boucle absorbe : ce n'était pas une borne. Le compteur est pris
  à l'ARRIVÉE et rendu au départ, donc ce qui est borné est la **longueur de la
  file**, pas un parallélisme — celui-ci vaut déjà un, l'analyse étant
  synchrone. Au-delà de cinq, la route répond `503 { error: 'Extractor busy' }`
  et le client se replie sur son propre extracteur — ce qu'il faisait de toute
  façon avant la 1.4.10. Un `setImmediate` entre deux analyses rend un tour de
  boucle COMPLET aux autres requêtes ; une simple promesse réglée n'aurait rendu
  la main qu'aux micro-tâches.
  ⚠️ **Ce que cette borne ne fait PAS : borner le CPU.** Un compte peut tenir
  cinq requêtes en file indéfiniment, donc faire analyser en continu, avec un
  tour de boucle rendu entre chaque analyse. C'est la différence entre « le
  serveur est lent » et « le serveur ne répond plus » — pas une immunité à la
  charge.
- **Demandes simultanées coalescées** : dix appareils qui réclament la même URL
  froide en même temps ne déclenchent **qu'une** extraction et **une** requête
  chez le site d'origine. Le cache ne couvre que ce qui est déjà extrait : sans
  cette table des extractions en cours (bornée à 64 URL, vidée dans les deux
  issues pour ne jamais devenir un cache d'échecs), le « une requête au lieu de
  dix » du README ne valait que pour des lecteurs décalés dans le temps — pas
  pour une rafale de préchargement partagée.
- **Piège — le refus de cible passe AVANT la lecture du cache, et c'est la
  garde COMPLÈTE qui passe devant.** Justement parce que la clé est globale à
  l'instance : une entrée écrite du temps où un hôte interne était autorisé
  (`PROXY_INTERNAL_HOSTS`, `PROXY_REWRITES`) lui survit pendant tout le
  `CACHE_TTL`, et une lecture placée en premier la servait en 200 à n'importe
  quel compte, sans refus ni ligne de journal. La route attend donc
  `assertTargetSafe` — résolution DNS comprise — avant de toucher au cache.
  **Un pré-contrôle littéral n'y suffit pas** : `targetAllowedLiteral` ne
  connaît que `localhost`, les noms SANS point et les IP littérales, alors que
  les deux réglages qui rouvrent la porte nomment couramment un hôte POINTÉ
  (`PROXY_INTERNAL_HOSTS=nas.example.com`, une réécriture vers
  `http://nas.lan:8080`, un `*.svc.cluster.local`) — invisible pour lui, et
  donc servi depuis le cache. Couvert par `server/test/extractCache.test.ts`,
  cache garni, pour les DEUX formes d'hôte interne — l'IP littérale et le nom
  pointé qui résout en privé, qui ne sont pas attrapées par le même mécanisme.
  Chaque cas y fait répondre au doublon DNS l'adresse qui laisse SON mécanisme
  juger seul (une adresse publique pour l'IP littérale) : autrement la
  résolution refuse à la place du contrôle syntaxique, et le cas reste vert
  quand on retire ce dernier de `assertTargetSafe`.
- **Le prix de cette garde, compté** : **une** résolution sur un succès de
  cache — il n'en fallait aucune — et **deux** sur un échec, le même hôte étant
  résolu par la route puis de nouveau par `fetchUpstream` (plus une par saut de
  redirection). Aucune n'est gratuite : contrairement à ce que cette page a
  affirmé jusqu'au 2026-09-04, **il n'y a pas de cache de résolution au niveau
  du système** — l'image est bâtie sur alpine, donc sur musl, qui n'en tient
  aucun, et l'étape de production n'installe ni nscd ni résolveur local (la
  glibc n'en garde pas davantage sans nscd). Chaque appel sort donc du
  processus, et sort aussi de la machine : sur un réseau Docker défini par
  l'utilisateur — le seul cas où le résolveur embarqué existe, ni le pont par
  défaut ni `network_mode: host` n'en ayant un — ce résolveur ne répond
  localement que les **noms de conteneurs** et transmet tout le reste aux
  serveurs de l'hôte, sans rien mémoriser. Les cibles d'extraction étant des
  hôtes d'articles publics, seul le premier saut est un socket local : la
  requête externe complète reste due à chaque fois. La seconde résolution
  n'est pas évitée, et ce
  n'est pas un oubli : il faudrait mémoriser un verdict, donc le tenir pour
  valide au-delà de l'instant où il a été établi, dans la fonction qui garde
  toutes les sorties du backend. Le prix est assumé pour ce qu'il achète : une
  entrée empoisonnée est servie en silence à TOUTE l'instance pendant 24 h.
- **Piège — une résolution SANS RÉPONSE n'est pas une cible refusée.**
  `assertTargetSafe` bloque aussi bien un hôte qui résout vers le réseau
  interne qu'un hôte qui ne résout pas du tout : ne pas savoir où l'on va
  n'autorise pas à y aller. Mais au poste pré-cache, confondre les deux
  transformait le moindre hoquet du résolveur — un redémarrage sur le réseau
  Docker suffit — en 403 « Target host not allowed » sur TOUTES les
  extractions, y compris celles que Redis pouvait rendre sans toucher au
  réseau, et avec une erreur qui accuse la cible d'un défaut qui n'est pas le
  sien. La route distingue donc la panne de résolution
  (`UnresolvedTargetError`, sous-classe de `BlockedTargetError`) et poursuit
  jusqu'au cache, dont chaque entrée n'a été écrite qu'après un passage complet
  de cette même garde.
  **Un nom INEXISTANT n'est pas une panne**, et le confondre avec une rouvrait
  le trou entier : `ENOTFOUND` est l'état *stable* d'un hôte interne au nom
  pointé qu'on vient de retirer de `PROXY_REWRITES`, ou dont le conteneur ne
  voit plus le résolveur interne — son entrée de cache serait alors ressortie
  en 200 vers toute l'instance pendant `CACHE_TTL`. C'est aussi, et bien plus
  souvent dans un lecteur de flux, l'état stable d'un hôte d'article
  **public** dont le domaine a expiré ou déménagé : son entrée de cache
  chaude, autrefois rendue hors ligne, répond désormais 403. C'est le 403 le
  plus fréquent de cette route, et il est voulu — pas un défaut à déboguer.
  `lookupFailure` (`server/routes/proxy.ts`) trie par liste POSITIVE : seuls
  `EAI_AGAIN` (rcode SERVFAIL, ou délai total épuisé), `EAI_FAIL` (les autres
  rcodes d'échec — FORMERR, NOTIMP, et surtout REFUSED) et le dépassement de
  `LOOKUP_TIMEOUT_MS` (`ETIMEDOUT`) valent une panne ; `ENOTFOUND` **et tout
  code inconnu** sont un refus. Les deux réponses définitives — NXDOMAIN et
  « ce nom n'a pas d'adresse » — arrivent sous ce seul code `ENOTFOUND`, Node
  relabellisant `EAI_NONAME` et `EAI_NODATA` avant tout appelant : aucun code
  de la liste transitoire ne peut donc accompagner une réponse du résolveur.
  (`ESERVFAIL`, listé ici jusqu'au 2026-09-04, est un code de **c-ares** que
  seul `dns.resolve*` produit — jamais appelé dans ce dépôt : il n'a jamais
  rien classé, et une panne rendant `EAI_FAIL` valait un 403.)
  ⚠️ **Réserve** : une panne franche n'est pas toujours reconnue pour telle.
  Sous la musl de l'image de production, un échec d'**envoi** de la requête
  (`resolv.conf` illisible, socket refusé, aucun serveur de noms configuré)
  rend `EAI_SYSTEM`, que libuv ne transmet pas tel quel : sa traduction le
  remplace par l'`errno` du moment, un code quelconque absent de la liste,
  donc un refus. Une extraction répond alors 403 là où le cache aurait suffi.
  Le troc est assumé dans ce sens : c'est la disponibilité qui cède, jamais la
  garde. *(La réserve écrite ici jusqu'au 2026-09-04 nommait `EAI_NONAME` —
  une chaîne que le code ne reçoit jamais — et prêtait à musl un repliement de
  ses échecs qu'elle ne fait pas : `EAI_NONAME` est sa réponse NXDOMAIN, le
  cas définitif.)*
  ⚠️ **Limite acceptée, dans l'autre sens** : la phrase ci-dessus vaut pour
  `ENOTFOUND`, pas pour la branche transitoire. Pendant une vraie panne de
  résolveur, le repli sert le cache d'extraction — global à l'instance — y
  compris pour un hôte interne *autrefois* autorisé, la seule classe d'entrées
  qui puisse porter du contenu interne (`ALLOWED_INTERNAL` court-circuite la
  résolution au moment de l'écriture). Le tri par liste positive a ramené cette
  fenêtre de « toujours » à « tant que le résolveur bafouille » ; il ne la
  referme pas.
  **La sortie réseau, elle, ne faiblit pas** : cache vide,
  `fetchUpstream` rejoue la garde et refuse avant le moindre appel — et il le
  fait avec le même 403 que n'importe quel refus, sans code à part, pour ne pas
  offrir l'oracle « 403 = cet hôte résout vers le réseau interne ». Chaque
  moitié est tenue par un test de `server/test/extractCache.test.ts` : la panne
  sert le cache, la panne sans cache refuse quand même, et un `ENOTFOUND` ne
  consulte même pas le cache. Le tri lui-même, code par code, et le plafond de
  temps qui le nourrit sont vérifiés dans `server/test/proxyLookup.test.ts`.
- **Sans Redis** : la route extrait quand même, sans rien garder.
- **Piège** : l'appel sortant passe par `fetchUpstream`, jamais par `fetch` —
  c'est lui qui porte la garde anti-SSRF.
- **Piège — le HTML rendu est BRUT, et c'est voulu.** `onclick`, `onerror` et le
  reste survivent : Readability ne les retire pas. Le client applique
  `sanitizeExtracted()` à la réception, exactement comme pour sa propre
  extraction ; sauter cette étape publie une XSS vivante. Assainir côté serveur
  a été tenté puis abandonné le 2026-09-04 — `createDOMPurify` sur `linkedom` ne
  filtre **rien** faute de `NodeFilter` : DOMPurify bascule sans bruit en mode
  « environnement non supporté » et rend l'entrée telle quelle, sans erreur.
  Avant de « rétablir » un assainissement serveur, **prouver qu'il filtre** —
  un test qui injecte un `onerror` et le voit disparaître.
- **Plafonds de lecture** (`server/routes/extract.ts`) : la réponse doit être du
  `text/html` (sinon 415, avant toute lecture — un PDF ou une vidéo n'a pas
  d'article ; une réponse **sans en-tête `Content-Type`** tombe dans le même
  refus, plus étroit que l'ancien chemin par le proxy : le client se replie
  alors sur son extracteur local, qui, lui, lit la page quand même), au plus
  5 Mo (sinon 502) et
  lue en moins de 20 s (sinon 504). Le minuteur de `fetchUpstream` est désarmé
  à l'arrivée des en-têtes : il couvre la connexion, pas le corps. Sans ces
  bornes, une URL publique quelconque suffisait à faire avaler des Go au seul
  processus Node, ou à lui faire tenir une socket indéfiniment.
- **Cadence** : **le même seau que `/api/proxy`**, pas un second de même
  taille — la route réutilise le middleware exporté par `server/routes/proxy.ts`
  (`FRIRSS_PROXY_RATE_LIMIT`, 600 par défaut, `0` désactive). L'extraction est
  le plus gros consommateur de ce budget : une route sans plafond, ou dotée de
  son propre compteur, rendrait la protection contournable en changeant d'URL.
- **Échecs classés comme sur `/api/proxy`** : 403 cible refusée (journalisée,
  pour qu'un balayage SSRF laisse une trace), **503 `Target host unresolved`**
  (le résolveur n'a pas répondu — une panne, pas un refus : voir plus bas), 504
  délai, 502 panne amont. S'y ajoute un 503 propre à cette route,
  **`Extractor busy`**, quand la file d'analyse est pleine
  (`EXTRACT_MAX_PENDING`) : même code, deux corps distincts, et le client se
  replie dans les deux cas. Le corps ne nomme jamais la cible, et la ligne de
  journal passe par `redactUrl` dans **toutes** les branches — la branche 503
  écrivait la cible en clair jusqu'au 2026-09-04, alors que le préchargement
  d'images y fait passer des URL de CDN signées par un `?token=…`.
  La route appelle la garde complète
  (`assertTargetSafe`, exportée par le proxy, **avant la lecture du cache**)
  mais ne recopie ni le corps du 403 ni sa ligne de journal : elle laisse
  remonter la `BlockedTargetError` et la fait repartir par `finishError`, un
  seul chemin pour les deux routes. `fetchUpstream` rejoue ensuite la même
  garde sur la cible réelle et sur chaque saut de redirection. Une URL
  malformée qui franchit le filtre `^https?://` (`https://`, sur laquelle
  `new URL()` se casse) est donc un **403 des deux côtés**, jamais un 502 —
  mais pas par le même juge : sur `/api/proxy` c'est le pré-contrôle
  `targetAllowedLiteral` qui la classe (son `new URL()` échoue, il renvoie
  `false`), sur `/api/extract` et chez les appelants sans route devant eux
  c'est `assertTargetSafe`. Et `fetchUpstream` ne construit son
  `startHost` qu'APRÈS elle — sans quoi un `TypeError` brut échapperait à la
  classification pour les appelants sans route devant eux (`worker.ts`,
  `oidc.ts`, `servers.ts`). Un test appelle `fetchUpstream` **directement**
  pour ce point : par les deux routes HTTP, qui refusent la cible avant lui, il
  resterait vert quel que soit son comportement.
  Un `400 { error: 'Invalid or missing url' }` couvre les deux entrées
  refusées d'emblée — `url` absente, ou présente mais pas http(s).
- **422 quand la page n'est pas extractible** : le client tombe alors sur son
  extracteur local ; un corps vide en 200 l'en priverait, puisqu'il ne
  retient la réponse du serveur que lorsqu'elle porte un `content` non vide.

### nginx (image de production)
Sert `dist/` et proxifie `/api/` vers Express. Porte les en-têtes de sécurité
destinés au navigateur — CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` —
parce que c'est lui qui rend le document, pas le backend (`server/index.ts`
désactive délibérément la CSP de helmet pour ne pas entretenir deux politiques
divergentes).

- **Où** : `nginx.conf`, `Dockerfile`, `docker-entrypoint.sh`
- **Node sans privilèges** : Node tourne en `PUID:PGID` (1000:1000 par défaut).
  C'est lui qui exécute le code applicatif, analyse du contenu non fiable et
  détient la base — la moindre exécution de code y possédait le conteneur, donc
  le secret JWT et la clé de chiffrement des jetons. L'entrypoint démarre en
  root le temps d'adopter `/app/data` — toute installation antérieure l'a en
  root, et échouer dessus casserait chaque mise à jour — puis abaisse Node via
  `su-exec`.
- **nginx garde sa répartition standard** : master root qui se lie au port 80,
  workers abaissés au compte `nginx` par la directive `user`. Ce sont les
  workers qui touchent aux données des requêtes.
- **Piège — ne pas « finir le travail » en rendant le master non privilégié.**
  Ça marche, avec `cap_net_bind_service` posée sur le binaire, et c'est ce qui
  avait été fait d'abord. Mais une capacité de fichier est refusée sous
  `no-new-privileges` ou `cap_drop: ALL` : l'image cassait alors là où elle
  fonctionnait avant, pour un gain marginal — le master ne fait que superviser.
  Le seul déplacement acceptable serait de sortir du port 80, or ce port figure
  dans la configuration de reverse proxy de tous les utilisateurs.
- **Garde-fou** : le job `docker` de `ci.yml` construit l'image, la lance sur un
  `/app/data` appartenant à root (le cas de mise à jour réel), vérifie
  `/api/health`, que PID 1 n'est pas root, qu'aucun worker nginx ne l'est, et
  qu'aucun autre processus root ne traîne.
- **Piège** : nginx sert chaque requête depuis **une seule** location, et une
  location regex l'emporte sur le préfixe `/`. Les `.js`/`.css`/`.svg` étaient
  donc servis par le bloc « static assets » et jamais par `location /` : ils
  sortaient avec `Cache-Control` seul, sans CSP ni `nosniff`. Les quatre
  en-têtes y sont désormais **répétés**, et cette duplication est voulue —
  remonter les en-têtes au bloc `server` ne suffirait pas, un bloc qui déclare
  un `add_header` n'hérite plus d'aucun. Garder les deux listes en phase.
- **Taille des corps** : `client_max_body_size 5m`, aligné sur `express.json`
  et `express.raw`. Le défaut nginx (1 Mo) rendait le conteneur plus strict que
  le backend qu'il sert. Vérifié par le job `docker` de `ci.yml`, qui exige
  qu'un corps de 2 Mo atteigne Express.
- **Piège majeur — `/sw.js` ne doit JAMAIS recevoir de CSP.** Un service worker
  hérite de la CSP livrée avec son propre script et l'applique à ses `fetch()`
  internes. Or il intercepte toutes les requêtes d'images (`CacheFirst`, voir
  `vite.config.js`) : sous `connect-src 'self'`, il ne peut plus aller chercher
  une image tierce et **toutes les images d'articles cassent**, sans la moindre
  violation CSP visible sur le document — elle a lieu dans le contexte du
  worker. C'est exactement ce qui est arrivé pendant le cycle 1.4.4 : le bloc
  « static assets » matche `\.js$`, donc `/sw.js` avec. Une `location = /sw.js`
  le devance et lui rend les trois autres en-têtes sans la CSP.
- **Piège — `/sw.js` ne doit pas non plus être `immutable`.** Il est le seul
  fichier non versionné par un hash que sert le bloc statique, et le seul chemin
  par lequel une nouvelle version du worker atteint les clients. Il sort en
  `no-cache` : mise en cache autorisée, revalidation imposée.
- **Garde-fou** : le job `docker` de `ci.yml` vérifie que `/sw.js` sort **sans**
  CSP et **sans** `immutable`, et que le document comme les fichiers statiques
  portent bien une CSP.

### Cache Redis (facultatif)
Mise en cache write-through des lectures greader, avec revalidation. Vide =
désactivé, aucune dépendance.

- **Réglages** : `REDIS_URL`, `CACHE_ARTICLES_PER_FEED`, `CACHE_TTL`

### Worker de synchronisation
Pré-remplit les flux des utilisateurs actifs même navigateur fermé.

- **Où** : `server/worker.ts`
- **Réglages** : `CACHE_SYNC_INTERVAL`, `CACHE_SYNC_ACTIVE_DAYS`, `CACHE_SYNC_PARALLEL_USERS`

### Base de données
SQLite en WAL. Migrations **additives** uniquement (`PRAGMA table_info` +
`ALTER TABLE`, helper `columnExists`).

- **Où** : `server/db.ts`
- **Piège** : ne jamais sauvegarder `frirss.db` seul — les écritures récentes sont
  dans le `-wal` voisin. Utiliser `scripts/backup-db.js` (API `.backup()`, sûre
  même serveur lancé) ou arrêter le conteneur et copier les trois fichiers.

### Préférences serveur
Stockage clé/valeur par utilisateur (`preferences`), poussé en un lot par
`src/lib/prefsSync.ts`.

- **Où** : `server/routes/preferences.ts`
- **Bornes** : clé ≤ 128 caractères, valeur ≤ 1 Mio, 200 clés par requête,
  500 clés stockées par utilisateur. Calibrées très au-dessus du client réel —
  ~31 clés poussées d'un coup, la plus grosse étant `appLogo`, un PNG en data
  URL redimensionné à 256×256 côté client. Sans elles, un compte authentifié
  remplissait le volume SQLite 5 Mo à la fois.
- **Piège** : tout le lot est validé **avant** la moindre écriture. Valider au
  fil de l'insertion laisserait derrière soi les clés qui précédaient la
  fautive, sur une requête pourtant refusée.

### Scripts opérateur
- `scripts/backup-db.js` — instantané atomique horodaté
- `scripts/reset-password.js` — réinitialisation d'un mot de passe

---

## Sauvegarde et restauration

Sauvegarde **complète et chiffrée** de tout ce que FriRSS sait de lui-même :
comptes et mots de passe (hachages bcrypt), serveurs avec leur jeton FreshRSS et
leur jeton maître, la **clé qui déchiffre ces jetons**, le secret JWT, le secret
client OIDC, toutes les préférences et tous les réglages d'instance. Restaurée,
l'instance est celle qu'on avait.

Ne s'y trouvent pas : le **contenu FreshRSS** — articles, flux, états de lecture
— qui vit dans FreshRSS ; et `sessions`, seule table écartée, faite de jetons
porteurs qui expirent.

- **Où** :
  - Serveur : `server/backupCrypto.ts` (enveloppe), `server/backup.ts`
    (collecte et application), `server/routes/backup.ts` (les deux routeurs)
  - Interface : `src/components/backup/` — `BackupExport.tsx` (formulaire
    d'export, phrase de passe + confirmation) et `RestoreFlow.tsx` (choix de
    fichier → aperçu → remplacement), **partagé** entre les deux points d'accès
    ci-dessous ; `src/components/Preferences/admin/BackupBlock.tsx` héberge le
    bloc dans Administration ; `src/lib/backupErrors.ts` traduit le `code`
    renvoyé par le serveur en clé i18n (`backup.errNotBackup`,
    `backup.errVersion`, `backup.errPassphrase`, `backup.errSchema`,
    `backup.errTooMany`, `backup.errGeneric`)
  - Traductions : famille `backup`
- **Spec** : `docs/superpowers/specs/2026-08-26-backup-restore-design.md`
- **Chiffrement** : `scrypt` puis AES-256-GCM (`node:crypto`, aucune dépendance
  ajoutée). **Phrase de passe obligatoire, 12 caractères minimum** : le fichier
  contient tout, un chiffrement facultatif serait un piège. Perdue, elle rend la
  sauvegarde définitivement inutilisable.
- **Deux points d'accès, une seule implémentation** (`RestoreFlow.tsx`,
  prop `setup`) :
  - **Administration**, sur une instance déjà en marche : bloc
    « Sauvegarde et restauration » de `BackupBlock.tsx`, derrière
    `/api/admin/*` et le garde administrateur.
  - **Écran de première connexion**, sur une instance vierge (`Login.tsx`,
    lien « restaurer » visible tant qu'aucun compte n'existe) : mêmes étapes,
    derrière `/api/setup/*` et le garde « instance vierge ».
  - Dans les deux cas, le fichier choisi et sa phrase de passe ne servent
    d'abord qu'à un **aperçu** (nombre de comptes, de serveurs, date de
    création, version d'origine, variables d'environnement d'origine) : le
    remplacement n'est jamais à un clic du choix de fichier, il faut valider
    l'aperçu.
  - Le remplacement **déconnecte** l'utilisateur (les comptes de la session
    courante n'existent plus après restauration) ; il se reconnecte avec le
    mot de passe **de la sauvegarde**, pas celui de l'instance qu'il vient de
    remplacer. Depuis l'écran de première connexion, la restauration bascule
    aussi l'écran de « inscription » vers « connexion » (l'instance n'est plus
    vierge).
- **Pièges** :
  - `server/crypto.ts` met la clé de chiffrement en cache pour la durée du
    processus. La restauration appelle `resetKeyCache()` après le commit ; sans
    cela **tous** les déchiffrements échoueraient en silence, `decrypt()`
    renvoyant `null` — ce qui se lit « pas de jeton ».
  - Les routes `/api/setup/*` refusent dès qu'**un seul** utilisateur existe
    (`userCount()`) : elles ne peuvent pas exiger d'être administrateur.
  - L'instantané des variables d'environnement se construit par **liste
    blanche** (`BACKUP_ENV_KEYS`), jamais depuis `process.env` en bloc.
  - Le remplacement tient dans **une seule transaction** : un échec en cours de
    route laisse l'instance intacte.
  - Une phrase de passe erronée (`bad_passphrase`) ne doit **jamais** répondre
    401 : l'intercepteur axios lit tout 401 comme une session expirée et
    déconnecte, ce qui éjecterait l'administrateur avant qu'il ne voie
    l'erreur. Le serveur répond **422** — l'utilisateur est authentifié, c'est
    la phrase de passe *du fichier* qui est fausse — et le client distingue les
    motifs par le `code` de la réponse, pas par le statut HTTP. La
    correspondance code → statut est extraite dans `backupErrorStatus()`
    (`server/routes/backup.ts`), testée seule pour qu'une régression vers 401
    ne repasse plus inaperçue.
  - `openBackup()` **borne** les paramètres scrypt (`N` puissance de deux entre
    2¹² et 2¹⁷, `r` entre 1 et 16, `p` entre 1 et 4) avant tout appel à
    `scryptSync`. `maxmem` ne suffit pas : la mémoire de scrypt vaut
    `128 × r × N` (indépendante de `p`), le travail vaut `N × p × r` — une
    enveloppe forgée peut donc déplacer tout le coût vers `p` sans jamais
    dépasser `maxmem`. Comme `scryptSync` est **synchrone**, un tel fichier
    bloquerait la boucle d'événements et donc tout le processus Express
    (`/api/health`, `/api/proxy` de tous les utilisateurs) le temps du calcul —
    y compris via `/api/setup/restore/preview`, accessible sans authentification
    sur une instance vierge.
  - Une sauvegarde produite par un FriRSS **plus récent** peut porter une
    colonne qu'`ALTER TABLE ADD COLUMN` a ajoutée après coup : le garde de
    version de l'enveloppe ne le détecte pas, puisque le *format* n'a pas
    changé. `insertRows()` (`server/backup.ts`) compare les colonnes de chaque
    ligne au schéma réel (`PRAGMA table_info`) et lève `schema_mismatch` en
    **nommant** la colonne fautive plutôt que de la filtrer en silence — un
    filtre silencieux avaliserait la perte d'une future colonne sensible.
  - `assertPayload()` exige que `settings` contienne `encryption_key` **et**
    `jwt_secret` : une charge utile amputée de l'un des deux « réussirait » à
    s'appliquer tout en rendant l'instance irrécupérable (plus personne ne se
    connecte, jetons illisibles au redémarrage suivant).
  - Toute erreur non typée dans `fail()` est journalisée côté serveur
    (`console.error`, jamais le corps de la requête ni la phrase de passe)
    avant de répondre 500 générique au client — sans quoi un échec de
    restauration, précisément le moment où le diagnostic compte, ne laissait
    aucune trace.
  - Avec `REDIS_URL` défini, le cache est indexé par identifiant numérique
    d'utilisateur ; `applyBackup` réinstalle un jeu d'utilisateurs différent
    sur ces mêmes identifiants. `cachePurgeAll()` (`server/cache.ts`) purge
    tout l'espace de clés `frirss:c:*` après le commit, **juste à côté de**
    `resetKeyCache()` — même piège (état vivant hors de la transaction) sous
    deux formes. No-op si le cache est désactivé.
  - `RestoreFlow.tsx` vide `passphrase` et `envelope` dès l'entrée en phase
    `done`, et vide l'aperçu (`summary`) dès que la phrase de passe change
    après un aperçu réussi — même raisonnement que pour le choix d'un nouveau
    fichier : un aperçu périmé ne doit pas rester derrière un bouton de
    remplacement cliquable.
- **`scripts/backup-db.js` reste** : instantané brut, sans phrase de passe, pour
  l'opérateur qui a un accès shell. Les deux ne se remplacent pas.

---

## Palette de commandes

Entrée unique sur **⌘K / Ctrl+K** : aller à un flux, une catégorie, une
étiquette, une vue fixe, ou lancer une action (recherche, aide-mémoire des
raccourcis, dispositions, sections de préférences).

- **Où** : `src/lib/commandPalette.ts` (recherche et classement, testés),
  `src/components/CommandPalette.tsx`
- **Pourquoi** : l'application avait de quoi la nourrir depuis longtemps — dix
  raccourcis, une recherche à périmètre, flux, catégories, étiquettes, sections
  de préférences — il manquait l'entrée unique. Avec soixante-et-onze flux,
  atteindre le bon demandait de dérouler la barre latérale et de lire.
- **Rien de nouveau n'est stocké** : la palette assemble ce que les stores
  contiennent déjà. Son état d'ouverture n'est ni persisté ni synchronisé.
- **Accents repliés** : « securite » atteint « Sécurité ». Sans cela, la moitié
  des libellés français seraient inatteignables au clavier.
- **Tri stable** : à score égal l'ordre d'origine est conservé, sinon la liste
  sauterait sous le doigt à chaque frappe. Un début de libellé l'emporte sur un
  début de mot, qui l'emporte sur une occurrence au milieu.
- **⌘K est traité AVANT le filtre des champs de saisie** de `useKeyboardNav` :
  la convention veut qu'il fonctionne même le curseur dans la recherche.
- **Les catégories sont dédupliquées depuis les abonnements** : le store ne les
  liste pas à part, ce sont les flux qui les portent.
- **Changement de serveur** (1.4.5) : le geste vit dans
  `src/lib/switchServer.ts`, extrait de `ServerSwitcher` où il était seul, et
  la garde est la fonction pure `canSwitchTo()` (`serverList.ts`, testée) —
  elle refuse le serveur déjà actif et l'entrée **synthétique**, et compare les
  identifiants en TEXTE parce qu'ils arrivent tantôt en nombre, tantôt en
  chaîne. Un serveur sans nom est désigné par son hôte.
  - **Piège, déjà connu ailleurs et reproduit ici** : `ServerSwitcher` ne se
    monte que si la barre du haut est visible, et la masquer est un réglage —
    la liste des serveurs n'était donc rangée dans le store que dans ce cas.
    `App.tsx` la range désormais lui-même, dans l'effet qui interrogeait déjà
    `getServers()`. Sans cela, la palette n'aurait proposé aucun serveur
    précisément à ceux qui en ont le plus besoin.
  - Le serveur actif n'est pas listé : une entrée « basculer » qui désigne
    l'endroit où l'on est déjà n'est pas une commande.

---

## Messages transitoires (toasts)

Pile de messages en bas de l'écran, `role="status"` / `aria-live="polite"`.
Trois au maximum ; au-delà, les plus anciens sortent.

- **Où** : `src/stores/uiStore.ts` (`toasts`, `pushToast`, `dismissToast`,
  `MAX_TOASTS`), `src/components/Toaster.tsx`, styles `.toaster` / `.toast`
- **Pourquoi** : l'application n'avait **aucun** retour transitoire — deux
  bandeaux fixes (hors ligne, relève) et rien d'autre. Une action réussie ne se
  disait jamais.
- **Ni persistés ni synchronisés** : un message transitoire n'est pas une
  préférence, et le rejouer sur un autre appareil n'aurait aucun sens. Un test
  vérifie que `toasts` n'entre pas dans `UI_SYNC_KEYS`.
- **Identifiant croissant, pas le texte** : deux messages identiques doivent
  pouvoir coexister.
- **Durées** : 3,8 s sans action, 6,5 s avec — il faut le temps de lire, de
  décider, puis d'atteindre le bouton.
- **Un toast d'erreur n'est pas décoratif.** `toast.markFailed` et
  `toast.markQueued` sont, depuis le retrait optimiste de la ligne, le SEUL
  signal qu'une écriture n'est pas passée : les retirer rendrait l'échec
  invisible jusqu'au rechargement (voir « Liste d'articles »).

### Pourquoi « tout marquer comme lu » n'a pas d'annulation

C'est la seule action de l'application que rien ne défait, et la revue
d'interface demandait un « Annuler ». **Ce n'est pas réalisable honnêtement.**
L'API greader marque le flux **entier** à une date donnée et ne dit jamais
quels articles étaient concernés. Restaurer les seuls articles présents en
mémoire rendrait une partie de la vue non lue en laissant le reste lu, avec des
compteurs qui mentiraient. Un « Annuler » qui n'annule qu'une partie est pire
que pas d'annulation.

La confirmation **avant** (`markAllRead.ts`, optionnelle) reste donc le
garde-fou, et le toast se contente d'annoncer ce qui a été fait — avec le
compte pris du compteur de non-lus de la vue, pas du nombre d'articles chargés.

---

## Internationalisation

**9 locales** : `fr` (repli), `en`, `de`, `es`, `it`, `nl`, `pl`, `pt`, `uk`.
488 clés. i18next v26 : pluriels `_one`/`_other`, plus `_few`/`_many` pour `pl`
et `uk`.

- **Où** : `src/locales/*.json`, `src/i18n.ts`
- **Règle** : toute chaîne visible va dans **les neuf** fichiers. Vérifier la
  parité avec la commande du `CLAUDE.md` avant de livrer.
- **`<html lang>` suit la langue** : posé par `src/i18n.ts` à l'initialisation
  puis à chaque `languageChanged`. `index.html` fige `lang="fr"` — fichier
  statique servi par nginx, rien de mieux n'est possible avant l'exécution du
  bundle — et rien ne le corrigeait ensuite : le document annonçait du français
  à un lecteur polonais dès le premier écran. Les lecteurs d'écran choisissent
  voix et prononciation sur cet attribut. Pas de `dir` : les neuf langues
  d'interface vont de gauche à droite ; le sens d'écriture ne concerne que le
  **contenu** des articles, porté bloc par bloc par `dir="auto"`.
- **Les dates suivent aussi la langue** : `dateLocale()` (`src/utils/dates.ts`)
  rend l'étiquette i18next telle quelle — c'est une balise BCP 47 valide, donc
  `toLocaleDateString` la résout sans table à tenir à jour.
  ⚠️ **Piège corrigé** : trois endroits testaient `lng === 'fr' ? 'fr-FR' :
  'en-US'`, liste arrêtée aux deux premières langues du projet — **sept locales
  sur neuf** affichaient donc des dates à l'américaine. Le troisième, le
  fantôme de balayage du volet de lecture, était même figé sur `fr-FR` : hors
  interface française, la date changeait à l'instant où le fantôme cédait la
  place au rendu. `formatArticleDate()` sert désormais les deux, pour qu'ils ne
  puissent plus diverger.

---

## Versions et livraison

`dev` porte la version **en préparation** ; les builds `dev` affichent
`vX.Y.Zb<N>` où **N compte les pushes** depuis le dernier tag. Prod affiche
`vX.Y.Z` sans suffixe.

- **Où** : `src/lib/version.ts`, `.github/workflows/publish.yml`
- **Spec** : `docs/superpowers/specs/2026-08-14-dev-version-label-design.md`
- **`FRIRSS_DEV_VERSION`** : l'étiquette est injectée **à la construction**, pas
  à l'exécution — `publish.yml` la passe en argument de build, le `Dockerfile`
  en fait une variable d'environnement de l'étape builder, et `vite.config.js`
  la fige dans le bundle via `define`. Vide sur les images de production.

---

## Routes serveur

| Méthode | Route | Rôle |
|---------|-------|------|
| POST | `/api/auth/register` | Créer un compte |
| POST | `/api/auth/login` | Ouvrir une session |
| POST | `/api/auth/logout` | Fermer la session |
| GET | `/api/auth/me` | Utilisateur courant |
| POST | `/api/auth/change-password` | Changer son mot de passe |
| GET | `/api/auth/status` | Inscriptions ouvertes, existence d'un compte |
| GET | `/api/auth/oidc/config` | Configuration SSO exposée au client |
| GET | `/api/auth/oidc/login` | Démarrer le flux OIDC |
| GET | `/api/auth/oidc/callback` | Retour du fournisseur OIDC |
| GET | `/api/servers` | Lister ses connexions FreshRSS |
| POST | `/api/servers` | Ajouter une connexion |
| PUT | `/api/servers/:id` | Modifier une connexion |
| DELETE | `/api/servers/:id` | Supprimer une connexion |
| PUT | `/api/servers/:id/default` | Définir le serveur par défaut |
| POST | `/api/servers/:id/actualize` | Déclencher une relève réelle |
| GET | `/api/servers/:id/actualize` | État de la relève en cours |
| GET | `/api/preferences` | Lire les préférences synchronisées |
| PUT | `/api/preferences` | Écrire l'ensemble des préférences |
| PUT | `/api/preferences/:key` | Écrire une préférence |
| DELETE | `/api/preferences/:key` | Effacer une préférence |
| DELETE | `/api/preferences` | Tout effacer |
| GET | `/api/admin/users` | Lister les comptes |
| POST | `/api/admin/users` | Créer un compte |
| PUT | `/api/admin/users/:id` | Modifier un compte |
| PUT | `/api/admin/users/:id/password` | Réinitialiser un mot de passe |
| DELETE | `/api/admin/users/:id` | Supprimer un compte |
| GET | `/api/admin/settings` | Lire les réglages du serveur |
| PUT | `/api/admin/settings` | Écrire les réglages du serveur |
| POST | `/api/admin/backup` | Produire la sauvegarde chiffrée |
| POST | `/api/admin/restore/preview` | Déchiffrer et résumer, sans écrire |
| POST | `/api/admin/restore` | Remplacer l'instance |
| POST | `/api/setup/restore/preview` | Idem, instance vierge uniquement |
| POST | `/api/setup/restore` | Idem, instance vierge uniquement |
| ALL | `/api/proxy` | Passage vers FreshRSS ; extraction d'articles en repli |
| GET | `/api/extract` | Article extrait côté serveur, depuis le cache partagé ou fraîchement |

---

## Variables d'environnement

Les valeurs par défaut et les explications détaillées sont dans le `README.md`.

**Réglages de déploiement** — `NODE_ENV` (`production` active le service des
fichiers statiques et `trust proxy`) · `PORT` (port interne d'Express, 3001) ·
`PUID` · `PGID` · `FRIRSS_DATA_DIR` · `FRIRSS_BASE_URL` · `CORS_ORIGIN`

**Proxy sortant** — `PROXY_REWRITES` · `PROXY_INTERNAL_HOSTS` ·
`FRIRSS_PROXY_RATE_LIMIT`

**Cache et relève** — `REDIS_URL` · `CACHE_ARTICLES_PER_FEED` · `CACHE_TTL` ·
`CACHE_SYNC_INTERVAL` · `CACHE_SYNC_ACTIVE_DAYS` · `CACHE_SYNC_PARALLEL_USERS` ·
`FRIRSS_REFRESH_MAX_FEEDS`

> `FRIRSS_DEV_VERSION` n'est pas un réglage d'exécution : elle est lue **à la
> construction** par Vite (voir « Versions et livraison »).

> **Garde-fou** : `src/lib/featuresDoc.test.ts` relève les variables
> effectivement lues par le code — `env.X` et `env['X']`, fichiers de test
> exclus — et échoue si l'une manque ici. Jusqu'au 2026-08-29 il lisait le
> tableau du `README.md` : il ne pouvait donc attraper qu'un oubli entre deux
> documents, jamais une variable neuve absente des deux. C'est ainsi que
> `FRIRSS_PROXY_RATE_LIMIT` a traversé son propre ajout sans le faire rougir.

---

## Familles de traductions

Chaque famille correspond à une zone de l'interface :

`app` · `sidebar` · `addFeed` · `articleList` · `articleRow` · `swipe` ·
`emptyState` · `readingPane` · `preferences` · `login` · `admin` · `servers` ·
`dates` · `time` · `shortcutBar` · `viewMode` · `connection` · `update` ·
`refresh` · `saved` · `backup` · `toast` · `palette`

---

## Comment mettre ce fichier à jour

1. Modifier ce document **dans le même commit** que le changement.
2. Ajouter la fonctionnalité dans sa famille : ce qu'elle fait, où elle vit, ses
   réglages, ses pièges.
3. Compléter le tableau des routes et la liste des variables si nécessaire —
   sinon `src/lib/featuresDoc.test.ts` échoue.
4. Consigner tout piège qui a coûté du temps. C'est la partie la plus utile du
   fichier, et celle qu'aucun outil ne peut reconstituer.
