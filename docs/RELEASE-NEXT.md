# 1.4.4 — en préparation

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

- **Sécurité — le jeton FreshRSS ne peut plus partir chez un tiers.** Le proxy
  décidait d'attacher le jeton en comparant la cible à l'URL du serveur par
  simple préfixe de chaîne : `https://serveur.tld.tiers.tld/` et
  `https://serveur.tld@tiers.tld/` passaient tous deux le contrôle, alors que
  ni l'un ni l'autre n'est le serveur. Les URL d'images d'articles et de
  favicons venant du contenu des flux, un flux hostile suffisait à faire
  envoyer le jeton — un accès complet au compte FreshRSS — vers son propre
  domaine. La comparaison porte désormais sur l'origine analysée, chemin
  compris.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
