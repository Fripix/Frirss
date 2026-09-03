# Extraction d'articles côté serveur, avec cache Redis partagé — design

**Date** : 2026-09-03
**Statut** : approuvé (brainstorming)
**Origine** : conversation du 2026-09-03. Après une journée passée à régler
l'arrivée tardive du texte et des images par des fenêtres de préchargement
côté client, le constat : chaque appareil refait l'extraction de chaque
article. Dix lecteurs des mêmes flux populaires, ce sont dix extractions
identiques, dix passages par le proxy, dix requêtes chez le site d'origine.

## Le constat

**L'extraction tourne aujourd'hui entièrement dans le navigateur.**
`@mozilla/readability` et `dompurify` sont des dépendances front ;
`extractFullContent` (`src/utils/extractContent.ts`) récupère la page via
`/api/proxy` puis exécute Readability localement. Le serveur ne fait que
proxifier une page brute qu'il ne comprend pas.

Conséquence : le travail est **multiplié par le nombre de lecteurs** alors
qu'il est identique pour tous. Le résultat n'est pourtant pas personnel — la
page source est la même pour tout le monde, contrairement aux listes
d'articles dont l'état de lecture dépend du compte.

**Un cache serveur existe déjà** (`server/cache.ts`, activé par `REDIS_URL`)
mais il ne couvre que les lectures greader : listes d'articles et compteurs,
clé `frirss:c:<userId>:<hash>`, coupées à `CACHE_ARTICLES_PER_FEED` (50) par
`trimStreamJson`. Les pages d'articles n'y passent pas.

## Ce qui change

Une route `GET /api/extract` rend l'article **déjà extrait et assaini**. Le
client la demande d'abord ; si elle ne répond pas, il extrait lui-même comme
aujourd'hui.

### Les trois niveaux

| Niveau | Portée | État |
|---|---|---|
| Mémoire + IndexedDB (`src/lib/extractCache.ts`) | un appareil | existe |
| Redis, clé par URL | toute l'instance | **à faire** |
| Extraction réelle (`linkedom` + Readability) | — | **à faire** |

Le client interroge son cache local ; à défaut il appelle `/api/extract` ; le
serveur regarde Redis, et à défaut va chercher la page, l'extrait, la range et
la renvoie.

### La clé est l'URL, jamais l'utilisateur

`frirss:x:<sha1(url)>` — **sans identifiant de compte**, contrairement au cache
de listes. C'est ce qui fait qu'un Mac profite du travail d'un iPhone, et qu'à
dix comptes lisant les mêmes flux le travail est fait une fois. Le volume ne
se multiplie donc pas par le nombre d'utilisateurs.

Le TTL existant (`CACHE_TTL`, 24 h) gère la fraîcheur. **Aucune détection de
modification de la page source** : dans un lecteur RSS un article se lit dans
les heures qui suivent sa publication, et le bouton « Article complet » relance
déjà une extraction à la demande. Ajouter une invalidation serait l'usine à gaz
que ce cadrage refuse.

### Le déclenchement : aucun mécanisme nouveau

Le préchargement client existant — dix articles d'avance, filtré sur les flux à
extraction automatique — appelle la nouvelle route au lieu d'extraire
localement.

**L'extraction suit donc la lecture, jamais la taille des flux.** Un flux de
cinquante articles dont trois sont lus ne fait extraire qu'une dizaine de
pages. C'est ce qui fait tenir « dix flux comme cent » : quelqu'un qui survole
cent flux ne paie pas plus que quelqu'un qui en lit dix assidûment.

Corollaire important : **le premier lecteur en bénéficie immédiatement**, parce
qu'il ne demande pas l'article qu'il lit mais les dix suivants. Il remplit le
cache et en profite dans le même geste. Sans ce déclencheur, la fonctionnalité
serait inutile sur une instance mono-utilisateur — c'est-à-dire la majorité.

### Sans Redis

`REDIS_URL` vide reste le défaut et concerne la plupart des installations. La
route extrait quand même, sans rien garder. À la première réponse absente,
lente ou en erreur, **le client bascule sur son extracteur local**.

Le code client d'aujourd'hui n'est pas retiré : il devient le filet. C'est le
choix explicite du 2026-09-03 (« le serveur essaie, le navigateur prend le
relais »), retenu pour ne perdre aucune robustesse — une page que `linkedom`
ne saurait pas lire reste extractible par le navigateur.

## Le point sensible : deux extracteurs

C'est le vrai risque de cette conception, consigné plutôt que découvert. Le
serveur et le navigateur peuvent produire un HTML légèrement différent pour le
même article — moteurs DOM distincts.

Trois décisions le contiennent :

- **Le serveur fait autorité quand il répond.** Le client ne corrige, ne
  complète ni ne compare son résultat. Une seule vérité par réponse.
- **Le contrat d'assainissement est le même des deux côtés**, en particulier la
  permission accordée aux `<iframe>` vidéo : `sanitizeExtracted`
  (`src/utils/extractContent.ts`) les laisse passer délibérément, sans quoi une
  vidéo intégrée disparaîtrait avant qu'`injectVideoFacades` puisse en faire une
  façade. Un serveur plus strict ferait disparaître des vidéos qui s'affichent
  aujourd'hui.
- **Pas de troisième assainisseur.** La logique commune est extraite dans un
  module partagé, testé une fois, importé des deux côtés. Ce dépôt en compte
  déjà deux et documente ce piège ; un troisième serait une régression de
  conception, pas un détail.

## Les deux garde-fous posés par le propriétaire

### Aucune CVE réintroduite

La dépendance DOM est de **production** : elle survit à `npm prune --omit=dev`
et compte donc dans le scan Docker Hub. Mesures relevées le 2026-09-03 :

| | Paquets installés | Taille | `npm audit --omit=dev` |
|---|---|---|---|
| **`linkedom`** | **18** | **6,6 Mo** | 0 vulnérabilité |
| `jsdom` | 54 | 32 Mo | 0 vulnérabilité |

`linkedom` est retenu. **Barrière de livraison** : après ajout,
`npm audit --omit=dev` doit rendre **0 vulnérabilité**, et l'ajout rester sous
une vingtaine de paquets de production. Vérification refaite **au moment de
l'implémentation**, pas sur la foi de ce tableau : un avis peut paraître entre
temps. Si la barrière ne passe pas, on ne livre pas — le projet s'arrête de
lui-même plutôt que de dégrader l'image publiée.

### Un fonctionnement documenté

- `docs/FEATURES.md` — obligatoire dans ce dépôt pour toute fonctionnalité.
- **Le README aussi**, ce qui est inhabituel : le comportement dépend de la
  présence de Redis, donc c'est une décision d'exploitation. Un administrateur
  doit lire ce qu'il gagne en le branchant et ce qu'il perd sans.

## Gestion des échecs

| Situation | Comportement |
|---|---|
| Redis absent | La route extrait sans garder ; le client reçoit son extrait |
| Redis en panne pendant une requête | L'extraction se fait, l'écriture échoue en silence, la réponse part |
| `linkedom` échoue sur une page | La route répond une erreur ; le client extrait localement |
| Page injoignable / 404 | Erreur relayée ; le client tente à son tour et échoue pareil |
| Route absente (ancien serveur, front récent) | 404 traité comme un échec ordinaire → repli client |

Aucun réessai côté serveur. Un échec s'arrête et laisse la main au client.

## Tests

Logique pure d'abord, dans `src/lib/` ou `server/`, testée avant d'être écrite :

- **La clé de cache** — même URL, même clé ; URL différente, clé différente ;
  aucun identifiant d'utilisateur n'y entre. Un test doit échouer si quelqu'un
  réintroduit `userId`, car ce serait annuler le partage entre comptes.
- **Le contrat d'assainissement partagé** — les `<iframe>` vidéo survivent, le
  reste tombe. Ce test doit vivre à côté du module partagé et couvrir les deux
  appelants.
- **Le repli client** — réponse absente, 404, 500, corps illisible : chacun
  bascule sur l'extraction locale. Un test par cas, sans quoi le filet n'est
  pas prouvé.
- **Le déclenchement** — le préchargement passe par la route et n'extrait plus
  localement quand elle répond.

Garde-fou existant à surveiller : `featuresDoc.test.ts` exige qu'une route
serveur nouvelle figure dans `docs/FEATURES.md`. Il rougira tant que la
documentation n'est pas écrite — c'est voulu.

## Fichiers touchés

| Fichier | Rôle |
|---|---|
| `server/routes/extract.ts` *(nouveau)* | La route, le cache, l'extraction |
| `server/cache.ts` | Une clé sans utilisateur, à côté de `cacheKey` |
| `src/utils/extractContent.ts` | Demander au serveur, se replier sinon |
| Module partagé *(nouveau)* | Contrat d'assainissement commun |
| `docs/FEATURES.md`, `README.md` | Obligatoires, même commit |

Aucune chaîne d'interface nouvelle n'est prévue : la fonctionnalité est
invisible, elle rend seulement plus rapide ce qui existe. Si l'implémentation
en fait naître une, elle va dans les **neuf** locales.

## Hors périmètre

**La pré-extraction par le worker.** Elle n'apporterait que « prêt avant même
d'ouvrir l'application » — un supplément, pas le cœur — et portait tout le
risque de comportement en robot d'aspiration sur une instance à cent flux. À
reprendre plus tard, sur un socle éprouvé, avec un plafond par flux et par
passe.

**Le cache d'images côté serveur.** Refusé le 2026-09-03 : les images sont déjà
prises en direct par le navigateur chez le CDN d'origine et gardées par le
service worker, sans coûter un octet au serveur. Les y faire transiter, ce
serait les remettre sur le proxy — exactement ce qui l'a saturé le même jour.

**Baisser `CACHE_ARTICLES_PER_FEED`.** Ces cinquante articles sont des
métadonnées JSON de quelques dizaines de kilo-octets par flux, et
correspondent à la page que consomme le défilement infini. Descendre ferait
redemander plus souvent, donc plus d'allers-retours vers FreshRSS, pas moins.
