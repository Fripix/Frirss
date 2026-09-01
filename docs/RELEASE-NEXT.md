# 1.4.6 — en préparation

Journal des changements du cycle en cours, tenu au fil de l'eau. Il alimente les
notes de la release GitHub et les corrections du README, puis se vide une fois
la release publiée.

> **À tenir à jour au moment du commit, pas à la fin du cycle.** Pour la 1.4.3,
> six correctifs manquaient à l'appel : le journal avait été rempli pour les
> gros morceaux et oublié pendant les finitions. Ils n'ont été retrouvés qu'en
> relisant les 57 commits. Contre-vérification utile avant de publier : differ
> `src/locales/en.json` contre le tag précédent — toute chaîne d'interface
> ajoutée ou modifiée doit correspondre à une entrée écrite ici.

## Fonctionnalités

_(rien pour l'instant)_

## Corrections et améliorations

- **Connexion à un FreshRSS auto-hébergé : l'écran dit enfin pourquoi elle
  échoue.** Une instance sur une IP privée est refusée par la garde anti-SSRF,
  qui répond `403 Target host not allowed` — mais l'écran affichait « connexion
  au serveur impossible » et taisait la cause comme la solution. Il nomme
  maintenant le blocage et la variable qui le lève, `PROXY_INTERNAL_HOSTS`.
  Vaut pour la première connexion comme pour l'ajout d'un serveur depuis les
  préférences. (issue #8)
- **Un mot de passe d'API refusé ne se présente plus comme une panne de
  serveur.** FreshRSS répond 401 quand le mot de passe d'API est faux — ou
  quand aucun n'a jamais été défini — et l'écran annonçait « connexion au
  serveur impossible ». Il dit maintenant que les identifiants ont été refusés
  et rappelle que ce mot de passe se définit à part de celui du compte. Les 401
  venant de FriRSS lui-même (session expirée) restent exclus de ce diagnostic.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

- **README** : l'installation prévient que la plupart des FreshRSS
  auto-hébergés vivent sur une adresse privée, montre la ligne
  `PROXY_INTERNAL_HOSTS` à ajouter, explique pourquoi le refus existe et donne
  la signature à chercher dans le journal (`POST /api/proxy 403`). La ligne du
  tableau de configuration dit désormais quand la variable est nécessaire.
