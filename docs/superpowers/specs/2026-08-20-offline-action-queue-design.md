# File d'actions hors ligne — design

**Date** : 2026-08-20
**Statut** : approuvé (brainstorming)
**Origine** : constat de l'utilisateur — « en lisant des articles hors ligne, ils
restent non lus ».

## Le problème, vérifié dans le code

`toggleRead` (et ses jumeaux `toggleStar`, `toggleReadLater`,
`toggleArticleLabel`) fait une mise à jour optimiste, appelle l'API, puis
**annule tout en cas d'échec** (`// Rollback on failure`). Hors ligne l'appel
échoue systématiquement : l'article redevient non lu sous les yeux de
l'utilisateur, et l'action est perdue.

Le code suppose donc une connexion permanente, alors que l'application est par
ailleurs conçue pour la lecture hors ligne.

## Principe : distinguer les deux échecs

- **Échec faute de réseau** → l'action part **en file**, l'état local est
  **conservé**.
- **Échec métier** (le serveur répond, mais refuse : 4xx) → **rollback**, comme
  aujourd'hui. C'est un vrai refus, le mémoriser n'aurait aucun sens.

Cette distinction est le cœur du design : on ne met en file que ce qui a échoué
par absence de réseau.

## Périmètre

Actions **par article** uniquement : lu/non lu, favori, à lire plus tard,
étiquettes.

**Hors périmètre** : « Tout marquer comme lu » (opération en masse portant sur un
flux à un instant donné — la rejouer plus tard marquerait lus des articles
arrivés entre-temps), gestion des flux et des étiquettes, panneau détaillé des
actions en attente.

## La file

Un nouveau magasin `actions` dans la base IndexedDB **existante**
(`frirss-offline`, déjà versionnée). Chaque entrée porte : identifiant
d'article, type d'action, valeur cible, horodatage, nombre de tentatives.

**Fusion par clé `articleId + type`** : basculer dix fois « lu » sur le même
article ne laisse qu'**une** entrée, avec l'état final. Sans cela, une longue
session hors ligne accumulerait des centaines d'appels à rejouer.

Conséquence assumée : l'historique intermédiaire est perdu. Seul l'état final
compte, ce qui est le comportement attendu pour un état de lecture.

## Le rejeu

Déclenché à **deux moments** : au retour du réseau (événement `online`) et au
démarrage de l'application (une session peut avoir été fermée avec des actions
en attente).

Séquentiel, par lots bornés, pour ne pas saturer FreshRSS après une longue
coupure.

Chaque action est **idempotente** : marquer lu un article déjà lu est sans
conséquence. Le dernier état gagne — approprié pour un état de lecture
personnel, et cela évite toute machinerie de résolution de conflit.

## Échecs au rejeu

Trois tentatives espacées. Au-delà, l'action est **abandonnée** et comptée.

L'état local n'est **pas** corrigé de force : il se réalignera naturellement au
prochain chargement depuis le serveur. On évite ainsi de faire « sauter » un
article sous les yeux de l'utilisateur, tout en ne maintenant pas un mensonge
durable.

## Ce que voit l'utilisateur

Le bandeau hors ligne **existant** est enrichi — aucun nouvel élément
d'interface :

- Hors ligne avec des actions en attente → « Hors ligne — 3 actions en attente »
- Au retour du réseau, une fois la file vidée → « Synchronisé », brièvement
- Après abandon → « 2 actions n'ont pas pu être synchronisées »

L'objectif est de lever le doute : l'utilisateur doit savoir que rien n'est
perdu.

## TDD — logique pure extraite

- `mergeAction(queue, action)` : fusion par clé, remplacement de l'état,
  préservation de l'ordre.
- `isNetworkFailure(error)` : classe une erreur en « réseau » (→ file) ou
  « métier » (→ rollback).
- `shouldRetry(attempts)` : politique de réessai (trois tentatives).

Le reste (IndexedDB, écouteur `online`) est de l'orchestration, vérifiée dans le
navigateur.

## i18n

Toutes les nouvelles chaînes dans **les 9 locales**. La parité des clés est
vérifiée par un script d'audit avant livraison.

## Fichiers concernés (estimation)

- `src/lib/actionQueue.ts` — **nouveau** (+ tests) : les fonctions pures.
- `src/lib/offlineStore.ts` — magasin `actions` (migration additive).
- `src/stores/feedStore.ts` — les quatre actions : mise en file au lieu du
  rollback réseau ; rejeu.
- `src/components/OfflineBanner.tsx` — compteur, « Synchronisé », abandons.
- `src/App.tsx` — déclenchement du rejeu au démarrage et à l'événement `online`.
- `src/locales/*.json` (×9).
