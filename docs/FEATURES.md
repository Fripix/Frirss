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

---

## Serveurs FreshRSS

Plusieurs connexions FreshRSS par utilisateur, avec un serveur par défaut et un
basculement rapide. Le jeton greader est **chiffré en base** (AES-256-GCM) et
injecté côté serveur par le proxy ; il n'atteint jamais le navigateur.

- **Où** : `server/routes/servers.ts`, `server/crypto.ts`,
  `src/components/Preferences/servers/` (gestion complète),
  `src/components/ServerSwitcher/` (sélecteur), `src/lib/serverList.ts`
  (logique partagée).
- **Deux endroits, un seul complet** : Préférences → Flux liste les serveurs et
  porte toutes les actions — basculer, ajouter, renommer, définir par défaut,
  supprimer, et le jeton maître de chaque serveur. La barre du haut ne fait que
  basculer ; son `+` et son clic droit sont des raccourcis vers Préférences,
  ils n'exécutent rien.
- **Jeton par serveur** : le jeton maître se configure et s'éprouve depuis la
  ligne de n'importe quel serveur, sans y basculer — les routes sont adressées
  par `/:id`. Le drapeau global `hasRefreshToken` ne décrit que le serveur
  actif : `RefreshTokenField` ne l'écrit que depuis la ligne de celui-ci.
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

- **Où** : `src/hooks/useKeyboardNav.ts`, `src/components/ShortcutBar.tsx`, Préférences → Général

---

## Liste d'articles

Affichage compact inspiré de GoodRead : source en accent, titre, résumé sur deux
lignes, barre verticale pour les non-lus. Scroll infini paginé. En-têtes de
groupe par date. Trois densités (Aperçu / Standard / Compact) et le mode grille.

- **Où** : `src/components/ArticleList/`
- **Fonctions** : marquer lu au clic, favori, à lire plus tard, ouverture de
  l'original, balayage sur mobile (`SwipeableArticleRow`), sélection multiple
  via les actions de ligne
- **Piège** : ouvrir un article marque lu **dans `selectArticle`**, pas dans
  `toggleRead`. Il y a **cinq** sites d'écriture dans `feedStore` (lecture via
  `selectArticle`, lecture via `toggleRead`, favori, à lire plus tard,
  étiquettes) — toute modification du traitement des échecs doit couvrir les cinq.

### Marquer tout comme lu
Confirmation optionnelle avant de vider une vue entière.

- **Où** : `src/lib/markAllRead.ts`
- **Spec** : `docs/superpowers/specs/2026-08-15-optional-mark-all-read-confirm-design.md`

### Recherche
Recherche respectant le **périmètre** de la vue courante : chercher depuis un
flux cherche dans ce flux, depuis une catégorie dans cette catégorie.

- **Spec** : `docs/superpowers/specs/2026-08-16-scoped-search-design.md`

### Vue agrégée d'une catégorie
Cliquer une catégorie affiche les articles de tous ses flux.

- **Spec** : `docs/superpowers/specs/2026-08-14-category-aggregate-view-design.md`

---

## Volet de lecture

Titre, méta (source, auteur, date), étiquettes en pastilles, corps HTML
**assaini**, liens en accent, blocs de code et citations stylés. Mode Focus
(plein écran) au double-clic. Contenu bidirectionnel rendu dans son sens propre.

- **Où** : `src/components/ReadingPane/ReadingPane.tsx`, `src/utils/sanitizeHtml.ts`
- **Piège majeur** : le profil DOMPurify `html: true` **retire `<iframe>` et
  `<svg>`**, silencieusement. Une icône SVG dans le HTML d'un article ressort
  vide — dessiner ces icônes en CSS. Ne **pas** élargir le profil : le HTML des
  articles vient de sources non fiables.

### Extraction du contenu complet
Pour les flux tronqués, récupération de l'article complet via `/cors-proxy/`,
avec cache à deux niveaux. Activable par flux.

- **Où** : `src/lib/extractCache.ts`, `src/lib/extractStore.ts`

### Vidéos YouTube intégrées
Vignette cliquable (façade) au lieu d'un `<iframe>` chargé d'emblée.

- **Où** : `src/lib/youtube.ts`, `src/lib/articleThumbnail.ts`
- **Spec** : `docs/superpowers/specs/2026-08-19-youtube-facade-design.md`
- **Piège** : la façade doit être posée **avant** l'assainissement — après, il n'y
  a plus d'iframe à remplacer. `src/lib/youtubeFacade.sanitize.test.ts` épingle
  cet invariant.

---

## Abonnements

Ajout d'un flux par URL avec choix de la catégorie, renommage, suppression.

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
    liste d'abonnements. L'interface le dit avant la saisie.

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
- **Spec** : `docs/superpowers/specs/2026-08-20-offline-action-queue-design.md`

---

## Apparence et thèmes

**36 couleurs** en 6 groupes, **7 tailles** de police en 3 groupes, nom et logo
de l'application, thèmes enregistrables, exportables en CSS, importables et
partageables par lien.

- **Où** : `src/stores/themeStore.ts`, `src/components/Preferences/AppearanceTab.tsx`,
  `src/components/Preferences/ThemePreview.tsx`, `src/components/Preferences/colorHighlight.ts`
- **Aides visuelles** : survoler une couleur **encadre l'élément réel** derrière le
  panneau, et **cercle la zone correspondante** dans un aperçu vivant qui se
  recompose en direct. Couverture : 28 couleurs encadrables sur l'interface, 14
  avec une zone d'aperçu, **6 avec aucune des deux** — l'interface le dit au lieu
  de laisser attendre une mise en évidence qui n'arrivera pas.
- **Piège** : `--sidebar-header-from` / `--sidebar-header-to` sont des **clés de
  thème**, pas des variables CSS ; seul `--sidebar-header-bg` est publié.

---

## Préférences

Panneau à navigation verticale : **Général** (langue, lecture, raccourcis),
**Apparence** (thème, couleurs, tailles, identité), **Étiquettes**, **Flux**
(gestion des serveurs FreshRSS et jeton maître de chacun), **Hors-ligne**, plus
**Administration** pour les administrateurs.

- **Où** : `src/components/Preferences/`
- **Spec** : `docs/superpowers/specs/2026-08-21-preferences-rework-design.md`
- **Garde-fou** : `src/components/Preferences/settingsCoverage.test.ts` fige un
  relevé de **232 réglages** et échoue si l'un cesse d'être référencé. Ne jamais
  modifier le relevé pour faire passer le test. Son parcours est **récursif**
  depuis le 2026-08-26 : à plat, il déclarait disparu tout réglage déplacé dans
  un sous-dossier du panneau.
- **Synchronisation** : les préférences logiques sont synchronisées par le serveur
  (`UI_SYNC_KEYS`) ; les préférences géométriques — largeurs de panneaux,
  visibilité de la barre latérale — restent locales à chaque appareil.

---

## Administration

Gestion des comptes (création, édition, rôle, mot de passe, suppression), mode
d'authentification, configuration OIDC, URL break-glass, ouverture des
inscriptions, animation de connexion.

- **Où** : `server/routes/admin.ts`, `src/components/Preferences/AdminTab.tsx`

---

## Backend

### Proxy
Point de passage unique vers FreshRSS et vers l'extraction d'articles.

- **Où** : `server/routes/proxy.ts`
- **Protection SSRF** : cibles internes bloquées par défaut, en littéral **et**
  après résolution DNS (ce qui défait `10.x.x.x.nip.io`), à chaque saut de
  redirection. `PROXY_INTERNAL_HOSTS` autorise explicitement des hôtes internes.
- **Réécritures** : `PROXY_REWRITES` remplace l'URL publique par une adresse
  interne — gros gain de latence quand FriRSS et FreshRSS partagent un réseau.
- **Règle** : tout nouvel appel sortant passe par `fetchUpstream()`, jamais par
  `fetch()` directement, sous peine de contourner le garde SSRF.
- **Redaction** : `redactUrl()` retire la valeur d'un paramètre `token` avant
  toute écriture dans un journal.

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

### Scripts opérateur
- `scripts/backup-db.js` — instantané atomique horodaté
- `scripts/reset-password.js` — réinitialisation d'un mot de passe

---

## Internationalisation

**9 locales** : `fr` (repli), `en`, `de`, `es`, `it`, `nl`, `pl`, `pt`, `uk`.
488 clés. i18next v26 : pluriels `_one`/`_other`, plus `_few`/`_many` pour `pl`
et `uk`.

- **Où** : `src/locales/*.json`, `src/i18n.ts`
- **Règle** : toute chaîne visible va dans **les neuf** fichiers. Vérifier la
  parité avec la commande du `CLAUDE.md` avant de livrer.

---

## Versions et livraison

`dev` porte la version **en préparation** ; les builds `dev` affichent
`vX.Y.Zb<N>` où **N compte les pushes** depuis le dernier tag. Prod affiche
`vX.Y.Z` sans suffixe.

- **Où** : `src/lib/version.ts`, `.github/workflows/publish.yml`
- **Spec** : `docs/superpowers/specs/2026-08-14-dev-version-label-design.md`

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
| ALL | `/api/proxy` | Passage vers FreshRSS et extraction d'articles |

---

## Variables d'environnement

Les valeurs par défaut et les explications détaillées sont dans le `README.md`.

`FRIRSS_BASE_URL` · `FRIRSS_DATA_DIR` · `PROXY_REWRITES` ·
`PROXY_INTERNAL_HOSTS` · `REDIS_URL` · `CACHE_ARTICLES_PER_FEED` · `CACHE_TTL` ·
`CACHE_SYNC_INTERVAL` · `FRIRSS_REFRESH_MAX_FEEDS` · `CORS_ORIGIN`

---

## Familles de traductions

Chaque famille correspond à une zone de l'interface :

`app` · `sidebar` · `addFeed` · `articleList` · `articleRow` · `swipe` ·
`emptyState` · `readingPane` · `preferences` · `login` · `admin` · `servers` ·
`dates` · `time` · `shortcutBar` · `viewMode` · `connection` · `update` ·
`refresh` · `saved`

---

## Comment mettre ce fichier à jour

1. Modifier ce document **dans le même commit** que le changement.
2. Ajouter la fonctionnalité dans sa famille : ce qu'elle fait, où elle vit, ses
   réglages, ses pièges.
3. Compléter le tableau des routes et la liste des variables si nécessaire —
   sinon `src/lib/featuresDoc.test.ts` échoue.
4. Consigner tout piège qui a coûté du temps. C'est la partie la plus utile du
   fichier, et celle qu'aucun outil ne peut reconstituer.
