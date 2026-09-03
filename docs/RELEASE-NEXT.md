# 1.4.9 — en préparation

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

- **Deux vulnérabilités corrigées dans une dépendance du serveur.** `qs`, la
  bibliothèque qu'Express utilise pour analyser les paramètres d'URL, portait
  deux avis de sévérité moyenne : un contournement de sa limite de taille de
  tableau, et un déni de service. Passée en 6.16.0. C'est la seule
  vulnérabilité que l'image publiée portait — les autres remontées par `npm
  audit` vivent dans les dépendances de développement et ne sont jamais
  embarquées.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
