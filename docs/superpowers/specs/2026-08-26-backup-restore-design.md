# Sauvegarde et restauration — design

**Date** : 2026-08-26
**Statut** : approuvé (brainstorming)
**Origine** : élément de backlog « sauvegarde/restauration simple », jamais cadré
jusqu'ici. Objectif de l'utilisateur : pouvoir remonter FriRSS après un crash ou
un changement de serveur, à partir d'un fichier qu'on télécharge.

## Le constat

Il existe `scripts/backup-db.js` : un instantané atomique de la base, sûr même
serveur lancé. Il ne fait que la moitié du chemin.

1. **Il n'y a aucune restauration.** Une sauvegarde qu'on ne sait pas remonter
   n'est pas une sauvegarde.
2. **Il faut y penser, et être sur le NAS.** Rien dans l'interface ne propose de
   sauvegarder ; l'opération suppose un accès au conteneur.
3. **Rien ne dit ce que le fichier contient.** Or la base porte
   `settings.encryption_key`, la clé AES qui déchiffre les jetons FreshRSS de
   tous les utilisateurs.

## Ce qui contraint tout le reste

La base tient cinq tables, et leur contenu se range en trois niveaux :

| Niveau | Contenu | Nature |
|--------|---------|--------|
| 1 | `settings.encryption_key`, `settings.jwt_secret`, `settings.oidc_client_secret`, `sessions` | vrais secrets |
| 2 | `users.password_hash` (bcrypt), `servers.freshrss_token` et `refresh_token` (chiffrés) | dérivés d'identifiants |
| 3 | comptes, serveurs, préférences, réglages d'instance non secrets | configuration |

Il n'existe pas de sauvegarde à la fois complète et anodine :

- **sans la clé du niveau 1**, les jetons FreshRSS sont des octets morts et
  chaque utilisateur doit ressaisir son mot de passe d'API ;
- **avec elle**, le fichier donne accès à tous les comptes FreshRSS configurés.

Un hachage bcrypt n'est pas réversible, mais il reste **attaquable hors ligne**
au dictionnaire : un fichier contenant les hachages d'une famille est sensible
même sans clé.

### Le cas OIDC, qui se comporte bien

Rien de ce qui authentifie un utilisateur OIDC ne vit dans la base : la
confiance vient du fournisseur d'identité. Ce qu'il faut restaurer, c'est le
**lien** — `users.oidc_sub`, un identifiant opaque, pas un secret. Et même
perdu, `server/routes/auth.ts` rattrape par l'e-mail : un compte existant sans
`oidc_sub` est **adopté** à la première connexion SSO au lieu d'être dupliqué.

## La décision

**Sauvegarde complète, chiffrée, phrase de passe obligatoire.**

Complète parce que l'objectif est de remonter l'instance sans rien reconfigurer.
Chiffrée parce qu'un fichier complet en clair donnerait accès à tout. Obligatoire
parce qu'une case « chiffrer » facultative sur un fichier de cette nature n'est
pas un choix éclairé, c'est un piège.

**L'interface explique pourquoi**, à l'endroit où la question se pose — devant le
champ, pas dans la documentation. Elle dit aussi qu'une phrase de passe perdue
rend la sauvegarde définitivement inutilisable.

**Longueur minimale : 12 caractères.** Le fichier contient tout ; sa seule
protection est cette phrase. Accepter `1234` reviendrait à proposer un
chiffrement qui n'en est pas un.

## Le fichier

Enveloppe JSON, lisible juste assez pour être identifiée, charge utile chiffrée :

```json
{
  "format": "frirss-backup",
  "version": 1,
  "createdAt": "2026-08-26T12:00:00.000Z",
  "appVersion": "1.4.3",
  "kdf": { "algo": "scrypt", "N": 32768, "r": 8, "p": 1, "salt": "<base64>" },
  "cipher": "aes-256-gcm",
  "iv": "<base64>",
  "tag": "<base64>",
  "payload": "<base64 chiffré>"
}
```

L'en-tête en clair ne révèle rien d'utile et permet de distinguer trois échecs
qui se confondraient sinon : « ce n'est pas une sauvegarde FriRSS », « c'est une
version que je ne sais pas lire », « la phrase de passe est fausse ». Sans lui,
les trois rendent le même charabia.

Les paramètres de dérivation voyagent dans l'enveloppe : on pourra les durcir
sans rendre les anciennes sauvegardes illisibles.

**Chiffrement** : `scrypt` pour dériver la clé de la phrase de passe, puis
**AES-256-GCM** — le motif déjà en place dans `server/crypto.ts`. Aucune
dépendance nouvelle, `node:crypto` fournit les deux.

### Charge utile

- `users` — hachages bcrypt compris, ainsi que `oidc_sub`
- `servers` — jetons chiffrés, exploitables puisque la clé voyage avec
- `preferences`
- `settings` — `encryption_key`, `jwt_secret`, `oidc_client_secret` compris
- `environment` — instantané des variables d'environnement, **en lecture seule**

**L'instantané d'environnement est une liste blanche**, jamais `process.env` en
bloc : le conteneur peut porter des variables sans rapport avec FriRSS, et les
aspirer dans un fichier de sauvegarde serait un vol de secrets par accident.
Sont retenues, et elles seules : `FRIRSS_BASE_URL`, `FRIRSS_DATA_DIR`,
`FRIRSS_REFRESH_MAX_FEEDS`, `PORT`, `CORS_ORIGIN`, `PROXY_REWRITES`,
`PROXY_INTERNAL_HOSTS`, `REDIS_URL`, `CACHE_ARTICLES_PER_FEED`, `CACHE_TTL`,
`CACHE_SYNC_INTERVAL`, `CACHE_SYNC_ACTIVE_DAYS`, `CACHE_SYNC_PARALLEL_USERS`.
Une variable inconnue de cette liste n'entre pas dans le fichier, même si elle
commence par `FRIRSS_`.

**`sessions` est la seule table exclue** : des jetons porteurs qui expirent, dont
le pendant navigateur vit dans le `localStorage` de l'ancienne origine. Les
transporter allongerait la liste des secrets pour aucun bénéfice.

### Ce que la sauvegarde ne peut pas restaurer

Ce qui ne vit pas dans la base :

| Hors base | Conséquence |
|-----------|-------------|
| Variables d'environnement du conteneur | portées par le fichier compose ; l'instantané les **rappelle**, il ne les applique pas |
| URL de rappel enregistrée chez le fournisseur OIDC | dérivée de `FRIRSS_BASE_URL` ou de l'hôte de la requête (`server/oidc.ts`), jamais de la base. Domaine changé → à mettre à jour côté fournisseur |
| L'adresse de FreshRSS lui-même | les URL de serveur **sont** sauvegardées, mais si FreshRSS a déménagé, elles pointent sur l'ancienne. Aucune sauvegarde ne peut deviner ce déplacement |

## Les deux chemins de restauration

Tous deux partagent l'étape qui rend l'opération sûre : **déchiffrer, montrer,
puis remplacer.**

**L'aperçu** affiche la date de la sauvegarde, la version de FriRSS qui l'a
produite, le nombre de comptes et de serveurs, et l'instantané d'environnement
avec un moyen de le copier. Il est présenté **avant** le remplacement, parce
qu'après l'utilisateur sera déconnecté.

### Depuis Administration, instance en marche

Choisir le fichier, saisir la phrase de passe, lire l'aperçu, puis **une
confirmation délibérée : retaper son propre nom d'utilisateur**, pas cliquer
« OK ». Le nom d'utilisateur plutôt qu'un mot magique du genre `REMPLACER` :
il n'a pas à être traduit dans neuf langues, il est différent pour chacun,
donc impossible à taper par réflexe, et il rappelle au passage que le compte
avec lequel on est connecté ne survivra peut-être pas à l'opération.

Le remplacement est **intégral** — comptes, serveurs, préférences, réglages —
et se fait dans **une seule transaction SQLite**. Si quoi que ce soit échoue,
tout est annulé et l'instance reste exactement dans son état d'avant.

Ensuite la session meurt et l'utilisateur revient à l'écran de connexion, où il
entre les identifiants **de la sauvegarde**, qui ne sont pas nécessairement ceux
qu'il venait d'utiliser. L'interface le dit avant, pas après.

La fusion a été écartée : deux comptes de même nom, deux mots de passe, deux
serveurs par défaut. Il faudrait une politique de conflit par table, et le
résultat ne serait plus « l'instance que j'avais ».

### À l'installation neuve

`Login.tsx` force déjà `mode = 'register'` quand aucun compte n'existe, et
distingue ce cas par `isFirstUser`. Un troisième mode, `'restore'`, y est offert
**uniquement dans ce cas** : même aperçu, confirmation allégée puisqu'il n'y a
rien à écraser.

**Garde de sécurité, non négociable** : cette route ne peut pas exiger d'être
administrateur, puisqu'aucun compte n'existe encore. Elle doit donc **refuser
dès qu'un seul utilisateur existe** — `userCount()` (`server/db.ts`) est là pour
ça. Sans ce garde, n'importe qui remplace l'instance par la sienne.

## Découpage

```
server/backupCrypto.ts             sceller / ouvrir l'enveloppe — pur, sans base
server/backupCrypto.test.ts
server/backup.ts                   collecter depuis la base, appliquer à la base
server/backup.test.ts
server/routes/backup.ts            les routes
src/components/Preferences/admin/BackupBlock.tsx   export + restauration
src/api/backend.ts                 les appels client (fichier existant)
src/components/Login/Login.tsx     mode 'restore' au premier démarrage
```

`backupCrypto.ts` ne touche pas la base : c'est la partie qui mérite le plus de
tests, et la plus facile à tester.

**Une seule implémentation, montée deux fois** : sous `/api/admin/*` derrière le
garde administrateur, sous `/api/setup/*` derrière le garde « instance vierge ».
Écrire deux fois la logique de restauration serait le meilleur moyen de n'en
corriger qu'une le jour où un défaut apparaît.

`BackupBlock.tsx` vit dans un sous-dossier plutôt que dans `AdminTab.tsx`, qui
fait déjà 706 lignes. Le garde-fou `settingsCoverage.test.ts` sait descendre
dans les sous-dossiers depuis le 2026-08-26.

### Routes

| Méthode | Route | Rôle |
|---------|-------|------|
| POST | `/api/admin/backup` | produire l'enveloppe (POST, pour que la phrase de passe ne soit pas dans une URL) |
| POST | `/api/admin/restore/preview` | déchiffrer et résumer, sans rien écrire |
| POST | `/api/admin/restore` | appliquer |
| POST | `/api/setup/restore/preview` | idem, instance vierge |
| POST | `/api/setup/restore` | idem, instance vierge |

## Pièges connus

1. **`cachedKey` dans `server/crypto.ts`.** La clé de chiffrement est mise en
   cache pour la durée du processus. Restaurer une `encryption_key` différente
   sans vider ce cache fait échouer tous les déchiffrements **en silence** :
   `decrypt()` attrape l'erreur et renvoie `null`, ce qui se lit « pas de
   jeton ». Il faut exporter un `resetKeyCache()` et l'appeler dans la
   transaction de restauration.
2. **Le garde d'instance vierge** sur les routes `/api/setup/*` (ci-dessus).
3. **La phrase de passe transite en corps de requête.** Ne jamais la
   journaliser. Limiter la cadence des routes d'aperçu et de restauration —
   `authLimiter` existe — sans quoi le déchiffrement devient un oracle à essais
   illimités.
4. **`preferences.user_id` est `TEXT`, `users.id` est `INTEGER`.** Une
   conversion de type au passage et toutes les préférences s'orphelinent sans
   la moindre erreur.
5. **Sens des clés étrangères.** Purge et réinsertion dans l'ordre : sessions,
   préférences, serveurs, utilisateurs, réglages.
6. **Sauvegarde plus récente que l'instance.** Les migrations sont additives,
   donc ancien → récent passe ; l'inverse non. Refuser net si `version` dépasse
   ce que le build connaît, plutôt que d'écrire à moitié.
7. **L'instantané d'environnement contient des noms d'hôtes internes.**
   Acceptable dans un fichier chiffré, jamais dans le dépôt : valeurs fictives
   obligatoires dans les tests, garde-fou de fuite avant chaque commit. Et il
   se construit par **liste blanche** : `process.env` en bloc emporterait les
   secrets d'autres services partageant le conteneur.

## Tests

**D'abord, sans base — `server/backupCrypto.test.ts`.** Ce sont les cinq façons
dont un utilisateur rencontrera ce code un jour de panne :

- aller-retour scellement → ouverture, contenu identique ;
- phrase de passe fausse → erreur distincte ;
- charge utile altérée d'un octet → GCM refuse, erreur distincte ;
- `format` inconnu → erreur distincte ;
- `version` future → refus explicite, sans tentative de lecture.

**Ensuite, base en mémoire — `server/backup.test.ts` :**

- collecter, appliquer dans une base vierge, comparer table par table ;
- `sessions` absente de la charge utile ;
- échec provoqué en cours d'application → **rien** n'a bougé (transaction) ;
- garde d'instance vierge : refus dès qu'un compte existe ;
- `preferences` retrouve son propriétaire malgré la divergence de type.

Valeurs fictives uniquement : `example.com`, `10.0.0.1`.

`featuresDoc.test.ts` exigera que les cinq routes figurent dans
`docs/FEATURES.md`, et la prose de la section Sauvegarde devra être **réécrite**
dans le même commit : elle affirme aujourd'hui que tout est manuel.

## Trois facteurs de forme

Le bloc vit dans un panneau déjà éprouvé sur les trois formats. Points à
vérifier : le sélecteur de fichier et le champ de phrase de passe au doigt
(cibles de 44 pt), l'aperçu lisible sans débordement horizontal en portrait, et
la confirmation par saisie utilisable au clavier virtuel.

## i18n

Nouvelles chaînes dans **les neuf** locales : le bloc d'export, l'explication du
caractère obligatoire de la phrase de passe et de sa perte définitive, la règle
de longueur, l'aperçu, la confirmation, et les messages d'erreur distincts du
piège 6 et des trois échecs d'ouverture.

## Hors périmètre, délibérément

- **Sauvegardes automatiques ou planifiées.** Un chantier en soi : où écrire,
  quelle rétention, comment prévenir en cas d'échec.
- **Envoi vers un stockage distant.**
- **Export par utilisateur** — un utilisateur emportant ses seules préférences.
  Produit différent, moins urgent.
- **Restauration effective des variables d'environnement.** Elles sont lues au
  démarrage du processus ; les appliquer supposerait de les déplacer en base et
  retirerait au fichier compose son rôle de source de vérité.
- **`scripts/backup-db.js` reste** : il sert l'opérateur qui a un accès shell et
  veut un instantané brut, sans phrase de passe. Les deux ne se remplacent pas.
