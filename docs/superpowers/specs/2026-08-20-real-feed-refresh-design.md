# Relève réelle des flux depuis FriRSS — design

**Date** : 2026-08-20
**Statut** : approuvé (brainstorming)
**Origine** : rapport d'utilisation — le bouton « Rafraîchir » annonce « À jour »
alors qu'aucun article n'existe. Constat vérifié : l'affichage était exact, mais
le geste ne fait pas ce que l'utilisateur croit qu'il fait.

## Le problème

`feedStore.refresh()` enchaîne `loadSubscriptions()` puis `loadArticles()` :
deux **lectures** de FreshRSS. Rien ne demande à FreshRSS d'aller relever les
flux en amont. Quand FreshRSS n'a rien en base — abonnements fraîchement
importés, cron absent ou en retard — le bouton renvoie « À jour », ce qui est
littéralement vrai (aucun article nouveau depuis le passage précédent) et
pourtant trompeur.

L'utilisateur attend d'un bouton « Rafraîchir » qu'il rafraîchisse.

## Ce que l'API Google Reader ne permet pas

Vérifié dans `p/api/greader.php` : le seul appel à `actualizeFeedsAndCommit()`
s'y trouve dans l'import OPML. **Il n'existe aucun endpoint greader de relève
générale.** Cette voie est fermée, définitivement.

## La voie retenue : le cron en ligne de FreshRSS

FreshRSS expose, **hors API greader**, une action de relève :

```
{serverUrl}/i/?c=feed&a=actualize
```

authentifiée par le couple `user` + `token`, où `token` est le **« Jeton
d'identification maître »** de la page *Profil* de l'utilisateur FreshRSS
(`app/views/user/profile.phtml`, clé i18n `admin.auth.token`). Un utilisateur
non-administrateur peut le définir lui-même. Champ libre, sans générateur :
vide = désactivé.

Paramètres utiles :

| Paramètre | Rôle |
|-----------|------|
| `maxFeeds` | nombre de flux relevés en une passe. **Le défaut de 10 n'est pas un plafond** : le paramètre est libre (`paramInt('maxFeeds') ?: 10`, et `PHP_INT_MAX` si non positif). |
| `ajax=1` | réponse courte (`OK`) au lieu d'une page complète |
| `user`, `token` | authentification sans session |

### Contraintes du côté FreshRSS

- **Plancher de 20 minutes par flux** (15 min configurable par flux). Une relève
  peut légitimement ne rien ramener. C'est délibéré : éviter de faire bannir les
  utilisateurs par les serveurs RSS.
- `@set_time_limit(300)` dans le contrôleur. La coupure réelle viendra plutôt du
  serveur web ou du reverse proxy placé devant FreshRSS.
- La boucle de relève n'a qu'une condition de sortie : `$nbUpdatedFeeds >= $maxFeeds`.
  Aucun budget de temps interne.

## Sécurité — analyse et décision

### Portée réelle du jeton maître

Sans authentification, ce jeton autorise **trois** actions :

| Action | Effet |
|--------|-------|
| `feed&a=actualize` | déclencher une relève |
| `index&a=rss` | lire tous les articles de l'utilisateur |
| `index&a=opml` | exporter la liste des abonnements |

C'est donc une **capacité de lecture sur tout le contenu**, pas un simple
déclencheur. Il ne permet pas : de se connecter à l'interface, d'écrire (marquer
lu, s'abonner, se désabonner), de modifier les réglages ou le mot de passe.

### Pourquoi c'est acceptable

FriRSS stocke **déjà** `servers.freshrss_token`, le jeton greader, qui donne
lecture **et** écriture. Le jeton maître est strictement moins puissant. Il
n'élargit pas le rayon de souffle d'une compromission de la base FriRSS.

### Le risque réel : le jeton en query string — non neutralisable

> **Correction du 2026-08-21.** La version initiale de cette section affirmait
> que le POST évitait la query string. C'était **faux** et cela cassait la
> fonctionnalité : FreshRSS rejetait 100 % des relèves. Ce qui suit est mesuré.

La documentation de FreshRSS présente le jeton en **query string**. Il atterrit
alors en clair dans les journaux d'accès de tout serveur web ou reverse proxy
traversé, à **chaque** relève. Les journaux ont un lectorat plus large que la
base : rotation, sauvegardes, outils d'analyse. C'est le point où le jeton maître
fuite plus facilement que le jeton greader.

**Ce transport est obligatoire.** L'analyse initiale avait cherché « csrf » dans
`feedController.php` et n'y avait rien trouvé — mais le contrôle n'est pas dans
le contrôleur. Il est dans **`app/FreshRSS.php::initAuth()`**, qui applique une
vérification CSRF **globale à toutes les requêtes POST**, avec une liste
d'exceptions étroite. L'exception `feed/actualize` ne vaut que si
`allow_anonymous_refresh` est activé — ce qui n'est pas le cas par défaut. Le
contrôle s'exécute **avant** tout contrôleur.

Mesuré contre FreshRSS 1.29.1, jeton valide :

| Requête | Réponse |
|---------|---------|
| `GET`, identifiants en query string | **200** |
| `POST`, identifiants en query string | **302** (`403 [CSRF]` puis redirection) |
| `POST`, identifiants dans le corps | **302** (idem) |

**C'est la méthode qui décide, pas l'emplacement des identifiants.** Et il n'y a
pas de troisième voie : `isCsrfOk()` compare à un jeton lié à une session, or
FriRSS n'a aucune session FreshRSS — il s'authentifie par jeton, pas par mot de
passe.

Décision : **passer en GET et documenter honnêtement la conséquence.** Le jeton
maître apparaît dans les journaux d'accès du serveur FreshRSS. C'est le
fonctionnement de cet endpoint, pas un défaut de FriRSS.

Atténuations :

- **`PROXY_REWRITES`**, quand il est configuré, envoie la requête directement à
  FreshRSS par le réseau interne : aucun reverse proxy public ne voit l'URL, et
  seuls les journaux de FreshRSS lui-même contiennent le jeton.
- Le champ de saisie du jeton **avertit l'utilisateur avant** qu'il ne colle le
  secret (clé i18n `preferences.refresh.scopeWarning`, dans les 9 locales), en
  nommant l'exposition dans les journaux et en conseillant la rotation si ces
  journaux sont accessibles.
- Le jeton maître reste strictement moins puissant que le jeton greader déjà
  stocké : lecture seule, pas d'écriture ni de connexion.

**Règles non négociables** :

1. GET uniquement — seule méthode acceptée par FreshRSS pour cette action.
   Le type de retour de `buildActualizeRequest()` épingle `method: 'GET'`.
2. Aucun suivi de redirection : un rejet de FreshRSS se présente comme une 302
   vers la page de connexion ; la suivre transformerait un échec en faux succès.
3. Le jeton ne quitte jamais le backend : ni vers le navigateur, ni dans un
   journal applicatif. Comme il voyage désormais dans l'URL, **toute trace
   journalisant une URL doit être expurgée** — `redactUrl()` dans
   `server/routes/proxy.ts` remplace la valeur de `token` avant écriture, et
   `sanitizeError()` nettoie les messages d'erreur au point d'appel.

## Architecture

### Backend — route dédiée

`POST /api/servers/:id/actualize` et `GET /api/servers/:id/actualize`.

Une route dédiée plutôt que le proxy générique : le proxy prend sa cible du
client (`X-Proxy-Target`), or l'URL doit ici être construite **entièrement côté
serveur** à partir du jeton chiffré en base.

Comportement du POST :

1. Charge le serveur de l'utilisateur, déchiffre `refresh_token`.
   Absent → `409` avec un code exploitable par le client (`no_refresh_token`).
2. Un job est déjà en vol pour ce couple `(userId, serverId)` → renvoie l'état
   du job existant, **sans en lancer un second**.
3. Sinon, déclenche la requête GET vers FreshRSS **sans l'attendre**, marque le
   job `running`, et répond immédiatement.

`maxFeeds` vaut **1000** par défaut pour une relève déclenchée par le bouton : le
paramètre n'a pas de plafond côté FreshRSS, et le plancher de 20 minutes par flux
limite naturellement le travail réellement effectué. Le bouton **Tester** des
préférences utilise `maxFeeds=1`, pour vérifier le jeton sans lancer de relève
massive.

La valeur est réglable par l'exploitant via la variable d'environnement
**`FRIRSS_REFRESH_MAX_FEEDS`** (défaut `1000`), au même titre que la famille
`CACHE_*`. C'est un réglage d'exploitation, pas un réglage utilisateur : il sert
à étaler la première relève d'une très grosse bibliothèque, où tout relever d'un
coup tient plus de la rafale que du rafraîchissement. Valeur non entière ou
inférieure à 1 → repli silencieux sur le défaut. À documenter dans le tableau des
variables d'environnement du `CLAUDE.md`/README.

État suivi dans un registre **en mémoire**, clé `userId:serverId` :
`{ status: 'running' | 'done' | 'failed', startedAt, finishedAt, error }`.
Pas de table : un job qui survivrait à un redémarrage n'aurait aucun sens.

Propriété utile de ce découpage : si le proxy devant FreshRSS coupe la requête,
FreshRSS poursuit son travail côté serveur et le sondage voit quand même arriver
les articles.

Garde-fous : timeout sortant borné à 10 minutes ; un job marqué `failed` porte un
motif, jamais le contenu de la requête.

### Stockage du jeton

Nouvelle colonne `servers.refresh_token TEXT`, chiffrée par le même `encrypt()`
que `freshrss_token`. Migration **additive** via le helper `columnExists` déjà en
place — motif existant, aucune table modifiée.

L'API n'expose jamais la valeur : les endpoints de serveur renvoient un booléen
`hasRefreshToken`.

### Front — `refresh()` en deux temps

1. `hasRefreshToken` faux → comportement actuel, strictement inchangé.
2. Vrai → `POST …/actualize`, état `refreshing`.
3. Sondage toutes les 3 s : `syncCounts()` (existant) + état du job. Les
   compteurs montent et les nouveaux articles s'insèrent au fil de l'eau.
4. Fin de job, ou plafond de sécurité → `loadArticles()` final, puis bandeau avec
   le total réel. Le plafond du sondage est aligné sur le timeout sortant du
   backend (10 minutes) : le client ne doit jamais abandonner avant que le job ne
   soit résolu, sous peine d'afficher un résultat partiel comme définitif.

Le `RefreshBanner` gagne l'état « Relève en cours… N nouveaux ». Le problème
d'honnêteté disparaît de lui-même : « À jour » devient vrai, puisqu'une relève
aura réellement eu lieu.

### Configuration, aux trois endroits demandés

- **Première configuration** — après le login FreshRSS, une étape *optionnelle*
  « Relève des flux » : champ jeton, marche à suivre pour le créer dans le profil
  FreshRSS, bouton « Passer ». Mentionner que le champ n'apparaît côté FreshRSS
  que si la méthode d'authentification le justifie.
- **Préférences** — champ jeton dans l'onglet du serveur, avec un bouton
  **Tester** lançant un `maxFeeds=1` et rapportant franchement le résultat.
- **Invitation ponctuelle** — sans jeton, le bandeau propose *une fois*
  d'activer la relève, avec lien vers les préférences. Mémorisé dans les
  préférences utilisateur pour ne pas revenir.

Le champ de configuration **doit** énoncer la portée réelle du jeton (lecture de
tous les articles et de la liste d'abonnements, en plus de la relève), pas se
contenter de « collez votre jeton ».

## Découpage et tests

TDD, logique pure extraite conformément aux conventions du dépôt.

| Unité | Responsabilité | Tests |
|-------|----------------|-------|
| `src/lib/refreshPolling.ts` | machine d'état du sondage : `idle → running → done \| failed`, plafond de sécurité, agrégation du delta | sans réseau, aux limites |
| Route backend `actualize` | construction de la requête, unicité du job, états | jeton présent/absent, second clic, échec amont |
| `feedStore.refresh()` | aiguillage selon `hasRefreshToken` | **non-régression** : sans jeton, comportement identique à aujourd'hui |

Tests de sécurité explicites :

- la requête sortante est un **GET** et ne suit **aucune** redirection ;
- l'URL construite porte bien `c`, `a`, `user`, `token`, `maxFeeds` et `ajax`,
  correctement encodés (le jeton *doit* y être : c'est la seule forme acceptée) ;
- `redactUrl()` expurge la valeur de `token` de toute URL journalisée ;
- aucune réponse d'API ne contient la valeur du jeton.

Chaînes UI ajoutées aux **9 locales**.

## Hors périmètre

- **Relève d'un flux isolé.** FreshRSS le permet (`id`/`url`), mais cela ouvre un
  chantier d'interface distinct.
- **Déclenchement automatique à l'ouverture de l'app.** Abusif vis-à-vis des
  serveurs RSS, et le plancher de 20 minutes le rendrait le plus souvent inutile.
- **Configuration du cron de FreshRSS.** Relève de l'exploitation de l'instance,
  pas de FriRSS.

## Vérification

Gates habituels du dépôt, puis contrôle fonctionnel sur l'instance de
développement : jeton configuré, flux vidés côté FreshRSS, relève déclenchée
depuis FriRSS, articles apparaissant progressivement sans rechargement manuel.
Contrôle négatif : jeton retiré, le bouton doit retrouver exactement son
comportement actuel.

Contrôle de fuite : après une relève, les journaux **applicatifs de FriRSS** ne
doivent contenir aucune occurrence du jeton. Les journaux d'accès de FreshRSS,
eux, en contiendront une par relève — c'est attendu et documenté ci-dessus. Avec
`PROXY_REWRITES` configuré, aucun proxy public intermédiaire ne doit en voir
passer.
