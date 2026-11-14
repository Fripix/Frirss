# Installation pour débutants et guide pour assistants IA — conception

*2026-11-14. Statut : validé par le propriétaire le 2026-11-14 ; rien n'est construit.*

## Intention

Un débutant qui arrive sur le GitHub de FriRSS ou sur le site vitrine doit
comprendre ce qu'est FriRSS, l'installer en suivant des étapes, et savoir
quelles variables régler et quand. Et s'il demande de l'aide à son assistant
IA (ChatGPT, Claude…), l'assistant doit pouvoir lire un texte de référence
qui le guide sans inventer.

Point de départ (relevé le 2026-11-14) :

- **Site** : la page « Installer » a déjà des prérequis, trois étapes
  numérotées, un encadré « réseau privé » et un tableau des variables groupé
  (Démarrage, Réseau, Cache, Limites). Bonne base.
- **README** : l'installation est un `docker run` suivi de blocs denses
  (adresse privée, reverse proxy, Ollama) ; la configuration est un tableau à
  plat de 15 variables, sans dire quand on en a besoin, suivi d'un long
  paragraphe technique sur l'extraction. C'est là que le débutant décroche.
- **Écarts** : le site ajoute `--restart unless-stopped` et documente `TZ`,
  absents du README, alors que `src/config/installation.ts` du site dit
  reprendre les commandes du README.
- **Rien pour les IA** : ni `llms.txt`, ni guide dédié.

## Objectifs

1. README lisible par un débutant : installation en étapes numérotées,
   variables classées par besoin.
2. Un guide unique pour assistants IA, dans le dépôt, désigné par le README et
   le site via une phrase prête à copier.
3. Site : bloc « Installer avec une IA », `llms.txt`, écarts avec le README
   corrigés.

## Non-objectifs

- Pas de serveur MCP dans FriRSS (écarté par le propriétaire : il voulait des
  instructions d'installation, pas une fonctionnalité).
- Pas de changement de l'app, de l'image Docker ni des valeurs par défaut.
- Pas de refonte du reste du README (aperçu, site, démo, fonctionnalités,
  sauvegardes, sécurité) au-delà de ce que les étapes exigent.
- Pas de refonte visuelle du site : on ajoute un bloc dans l'identité existante.

## Anti-objectifs (échec même si « ça marche »)

- Le guide IA dit autre chose que le README (variable inventée, commande
  différente, conseil dangereux). Un guide faux est pire qu'absent.
- Le guide pousse à désactiver la garde anti-SSRF, à exposer le port du
  conteneur à Internet, ou à coller un mot de passe dans la conversation.
- Du texte du README disparaît (le paragraphe d'extraction, les conseils
  reverse proxy et Ollama) au lieu d'être déplacé.
- Une fuite d'infra dans un dépôt public (garde-fou habituel, valeurs fictives).

## Contraintes

- README rendu par GitHub : pas de style, `<a>` seul sur sa ligne autour d'un
  `<picture>`. Changement visuel du README → aperçu montré avant publication
  (rendu `gh api /markdown`).
- `scripts/sync-check.mjs` du site lit la section `## Configuration` du README
  et ses lignes `` | `NOM` | `` : garder ce titre et ce format de ligne (des
  sous-titres `###` et plusieurs tableaux dans la section sont acceptés).
- Le lien brut du guide doit pointer vers `main`, sinon il sert une version
  périmée. Donc README et guide vont sur `main`, puis `main` est fusionné dans
  `dev`. **Pousser `main` attend l'accord explicite du propriétaire.**
- Site : branche dédiée, captures montrées, fusion sur « fusionne », poussée sur
  « pousse » (règles du `CLAUDE.md` du site). Textes du site validés par le
  propriétaire : les nouveaux textes lui sont montrés avant fusion ; les
  existants ne sont pas réécrits sauf pour corriger un écart.

## Approches envisagées

- **A. Un fichier de référence unique dans le dépôt, désigné par le README et
  le site** — une seule source, testable contre le README. **Choisie par le
  propriétaire.**
- B. Seulement un `llms.txt` sur le site — peu de travail, mais les assistants
  le lisent rarement d'eux-mêmes ; les gens collent un lien ou un texte.
- C. Un long texte à copier contenant toutes les instructions — deux copies
  (README, site) qui dérivent en silence.

Ordre décidé : README d'abord, puis le guide IA (qui reprend ses étapes), puis
le site.

## Conception

### 1. README (sur `main`)

**Haut de page.** Une phrase simple tôt, avant le jargon : FreshRSS récupère
et garde les flux ; FriRSS est l'interface dans laquelle on les lit. Elle dit
aussi ce qu'il faut pour l'installer : une instance FreshRSS et une machine
avec Docker. La section *About* garde la voix du propriétaire (ne pas la
réécrire).

**`## Installation` devient des étapes numérotées** (sous-titres `###`) :

0. **Before you start** — FreshRSS en marche, API activée (*Settings →
   Authentication → Allow API access*), mot de passe API défini (*Settings →
   Profile*), Docker installé. Encadré : « Installer avec un assistant IA »,
   avec la phrase à copier (voir §2).
1. **Start FriRSS** — trois variantes : `docker run` (avec
   `--restart unless-stopped`, aligné sur le site), Docker Compose (le
   `docker-compose.yml` du dépôt), Unraid (Community Applications).
2. **Create your account** — `http://localhost:8080` ou l'adresse de l'hôte ;
   premier compte = administrateur ; inscriptions fermées ensuite.
3. **Connect FreshRSS** — les trois champs, en rappelant que ce sont les
   identifiants FreshRSS, pas ceux de FriRSS. Encadré « FreshRSS sur une
   adresse privée » (`PROXY_INTERNAL_HOSTS`, symptôme `POST /api/proxy 403`),
   repris tel quel.
4. **Going further (optional)** — reverse proxy et HTTPS (ne pas exposer le
   port, délais de 120 s), Redis, Ollama (`OLLAMA_CONTEXT_LENGTH`). Les blocs
   existants sont déplacés ici, pas supprimés.

Une étape de vérification finit l'étape 1 :
`curl http://localhost:8080/api/health` renvoie la version.

**`## Configuration` : variables groupées par besoin**, mêmes groupes que le
site, un petit tableau par groupe avec une phrase « quand en avez-vous
besoin » :

- *Start* : `TZ` (ajoutée), `PUID`, `PGID`
- *Network* : `FRIRSS_BASE_URL`, `PROXY_INTERNAL_HOSTS`, `PROXY_REWRITES`,
  `CORS_ORIGIN`
- *Cache (Redis)* : `REDIS_URL`, `CACHE_*`
- *Limits and storage* : `FRIRSS_REFRESH_MAX_FEEDS`, `FRIRSS_PROXY_RATE_LIMIT`,
  `FRIRSS_DATA_DIR`

Le paragraphe sur l'extraction est conservé intégralement dans un
`<details><summary>How article extraction works</summary>` sous le tableau.

### 2. Guide pour assistants IA (sur `main`)

Fichier `docs/INSTALL-WITH-AI.md`, en anglais, écrit pour un assistant IA (il
reste lisible par un humain). Lien brut :
`https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md`.

Phrase à copier (README et site, traduite sur le site) :
> Read https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md and help me install FriRSS step by step.

Contenu :

- **Rôle et règles** : guider une personne qui débute, une étape à la fois,
  dans sa langue ; vérifier chaque étape avant la suivante ; si ce guide et le
  README divergent, le README fait foi ; ne jamais inventer de variable ni
  d'option (seules celles listées existent).
- **Ce qu'est FriRSS** en trois lignes, et ce qu'il n'est pas (il ne remplace
  pas FreshRSS).
- **Questions à poser d'abord** : FreshRSS est-il installé et où (adresse
  publique, IP du réseau local, nom de service Docker) ? Docker, Compose ou
  Unraid ? Architecture (amd64 / arm64, Raspberry Pi 64 bits) ? Accès depuis
  l'extérieur prévu (reverse proxy) ?
- **Parcours selon les réponses** : commandes identiques au README, avec
  `PROXY_INTERNAL_HOSTS` ajouté seulement quand l'adresse de FreshRSS est
  privée (ou `PROXY_REWRITES` quand les deux partagent un réseau Docker).
- **Après le démarrage** : vérification `/api/health`, création du compte
  administrateur, connexion à FreshRSS.
- **Dépannage** (symptôme → cause → correctif) : `POST /api/proxy 403` →
  `PROXY_INTERNAL_HOSTS` ; port 8080 occupé → changer le port hôte ;
  permissions sur le dossier de données → `PUID`/`PGID` ; connexion FreshRSS
  refusée → mot de passe API et accès API ; traduction IA coupée derrière un
  proxy → délais de 120 s ; réponse Ollama tronquée →
  `OLLAMA_CONTEXT_LENGTH=16384` ; OIDC qui revient mal → `FRIRSS_BASE_URL`.
- **Ce que l'assistant ne doit jamais faire** : demander le mot de passe
  FreshRSS, le mot de passe API ou un secret dans la conversation (la personne
  les tape elle-même dans FriRSS) ; conseiller d'exposer le port directement à
  Internet ; contourner la garde anti-SSRF autrement que par l'hôte précis ;
  épingler une version inventée.
- **Table des variables** : reprise du README (nom, rôle, défaut).

**Test garde-fou** `src/lib/installWithAiDoc.test.ts` : l'ensemble des
variables de la section Configuration du README et celui de la table du guide
sont égaux (une variable ajoutée d'un côté seulement fait échouer). Il vérifie
aussi que le nom d'image et le montage `/app/data` des commandes du guide sont
ceux du README. Prouvé capable d'échouer avant d'être commité. Il n'attrape pas
une prose devenue fausse : relire le guide fait partie de toute modification
de l'installation, comme pour `docs/FEATURES.md`.

**Vérification du guide** : un agent sans contexte reçoit seulement la phrase
à copier et joue l'assistant face à trois profils simulés (Docker sur un
Raspberry avec FreshRSS sur IP privée ; Unraid avec FreshRSS sur le même réseau
Docker ; VPS avec reverse proxy et FreshRSS public). On contrôle que ses
commandes correspondent au README et qu'il ne franchit aucun interdit. Puis le
`docker run` du guide est lancé sur le banc pour confirmer `/api/health`.

### 3. Site vitrine (dépôt `FriRSS-Site`, branche dédiée)

- **Bloc « Installer avec une IA »** sur la page Installer, dans l'étape
  « Préparer FreshRSS » ou juste après les prérequis : une phrase
  d'explication et la phrase à copier dans le composant de code existant
  (bouton copier). Français et anglais, même structure. Texte montré au
  propriétaire avant fusion.
- **`llms.txt`** à la racine du site (anglais) : ce qu'est FriRSS, lien vers le
  guide IA brut, le README et la page Installer.
- **Écarts** : `installation.ts` est déjà aligné une fois le README corrigé
  (`--restart`, `TZ`). `sync-check.mjs` lit les variables du README : `TZ` y
  apparaîtra et le site ne la liste pas dans `variables` (elle est active dans
  le compose). **Mon choix** : `sync-check.mjs` traite `TZ` comme déjà montrée
  (elle figure dans les commandes), plutôt que de la dupliquer en ligne
  commentée dans le compose.
- Puis `sync-check` relancé contre le nouveau README et revue acceptée selon
  `docs/RELEASES.md` du site.
- Gates du site (`check`, `build`, Playwright), captures desktop et 320 px
  envoyées, audit impeccable du bloc.

### Lecture débutant (avant / après)

Un agent sans contexte lit le haut du README et l'accueil du site comme un
débutant qui ne connaît ni FreshRSS ni Docker, et dit où il décroche. Fait une
fois avant (pour orienter les phrases d'introduction) et une fois après
(critère de réussite : il sait dire ce qu'est FriRSS, ce qu'il lui faut, et par
où commencer).

### Tenue à jour (demande du propriétaire, 2026-11-14)

Ce qui aide les IA doit rester juste dans le temps, pas seulement le jour où on
l'écrit. Donc, dans le même commit que le guide :

- **`CLAUDE.md` du projet** : une règle à côté de celle de `docs/FEATURES.md`.
  Tout changement d'installation, de variable, de valeur par défaut, de port ou
  de message d'erreur cité par le guide met à jour `docs/INSTALL-WITH-AI.md`
  dans le même commit, et sa prose est relue.
- **Procédure de release** (`CLAUDE.md`, étape 3 « Mettre à jour le README ») :
  le guide IA est relu avec le README, et le `llms.txt` du site avec le site.
- Le test garde-fou attrape les variables oubliées ; la règle couvre le reste.

## Ordre des livraisons

1. README + `docker-compose.yml` + guide IA + test, en un commit sur `main` (après gates et
   garde-fou), aperçu du rendu montré, **poussée de `main` sur accord du
   propriétaire**, puis `main` fusionné dans `dev`.
2. Site sur sa branche, captures, puis « fusionne » / « pousse » du
   propriétaire.

## Choix de Claude (après relecture, à vérifier par le propriétaire)

- **Vérifier le guide avant la poussée de `main`** : l'agent de vérification
  reçoit le fichier local à la place du lien, et le `docker run` passe sur le
  banc. Après la poussée, un seul contrôle : `curl` du lien brut sert bien le
  guide. Une seule demande d'accord pour `main`. (Toute poussée de `main`
  reconstruit `:latest` depuis le même code, comme les commits README
  précédents.)
- **Réseau privé ou Docker → `PROXY_INTERNAL_HOSTS` par défaut.** Si la
  personne saisit dans FriRSS une adresse privée ou un nom de service
  (`http://freshrss`), on autorise cet hôte, comme le dit déjà le README.
  `PROXY_REWRITES` n'est proposé qu'en option, quand FreshRSS a aussi une URL
  publique que la personne veut garder dans FriRSS : la réécriture fait passer
  par le réseau local, et ses origines sont déjà autorisées par la garde.
- **Le `docker-compose.yml` du dépôt fait foi pour Compose** et entre dans le
  périmètre, avec un minimum de changements : une ligne commentée
  `PROXY_INTERNAL_HOSTS` avec son explication. `NODE_ENV` et `FRIRSS_DATA_DIR`
  restent (redondants avec le `Dockerfile`, sans effet). Le guide renvoie à ce
  fichier au lieu d'en recopier un autre. Le test compare le nom d'image et le
  montage `/app/data` du guide avec le README et `docker-compose.yml`.
- **Unraid** : la référence est le modèle `templates/frirss.xml` du dépôt
  public `Fripix/unraid-templates`, lu le 2026-11-14 : port hôte 8787, données
  dans le dossier appdata d'Unraid, `PUID` 99 / `PGID` 100, champ
  « FreshRSS Internal Host » = `PROXY_INTERNAL_HOSTS`. Le guide et le README
  disent d'ouvrir le port 8787 sur Unraid (pas 8080), et rappellent qu'une
  installation antérieure à la 1.4.4 doit ajouter ce champ à la main.
- `OLLAMA_CONTEXT_LENGTH` est une variable d'Ollama, pas de FriRSS : elle va
  dans le dépannage du guide, pas dans sa table (sinon le test d'égalité
  échoue).

## Laissé au constructeur

- Formulation exacte des phrases du README et du guide (anglais simple,
  courtes).
- Où placer précisément le bloc IA sur la page Installer, dans l'identité de
  `docs/DESIGN.md` du site.
- `FEATURES.md` : aucune fonctionnalité de l'app ne change ; pas d'entrée, sauf
  si le test `featuresDoc` le réclame. `RELEASE-NEXT.md` : rien (documentation
  publiée sur `main` hors cycle, comme les commits README précédents).

## Évolution après validation (2026-11-14, décisions du propriétaire)

Le README réécrit en étapes restait trop long. Après comparaison avec 17 README
de projets auto-hébergés populaires (médiane ≈ 700 mots), le propriétaire a
choisi une **vitrine courte** :

- **README** (≈ 740 mots) : accroche, encadré « FriRSS needs a working
  FreshRSS », image d'aperçu, site et démo, About, **douze fonctionnalités en
  une ligne**, `## Installation` court (une commande, deux étapes, la phrase IA),
  `## Configuration` d'une ligne. Ces deux titres restent pour les anciens liens.
- **`docs/INSTALL.md`** : l'installation complète (Compose, Unraid, reverse
  proxy, mise à jour) et les sauvegardes. **`docs/CONFIGURATION.md`** : toutes
  les variables, groupées par besoin. **`SECURITY.md`** reçoit la liste de
  sécurité qui était dans le README.
- **Le test** `installWithAiDoc.test.ts` compare le guide IA à
  `docs/CONFIGURATION.md`, et les commandes au README, à `docs/INSTALL.md` et au
  guide. Le script de contrôle du site lit aussi `docs/CONFIGURATION.md`.
- **Captures** : les trois anciennes (juin, en français, données de test,
  contenu d'un tiers) sont remplacées par **une image composée** sur fond
  transparent : MacBook Air (thème clair, résumé IA), iPad (grille, Night) et
  un éventail d'iPhone (le même article en trois thèmes), appareils dessinés en
  CSS ; variante étroite à quatre iPhone. Prises sur l'instance de dev, adresse
  du serveur remplacée par `rss.example.com`, contenu choisi (pas d'arabe, rien
  d'animal ni de médical), compte de test remis dans son état d'origine.
