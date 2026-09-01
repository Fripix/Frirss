# 1.4.7 — en préparation

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

- **Marquer un article lu le fait sortir de la liste « Non lus ».** Cliquer le ✓
  d'une ligne n'avait aucun effet visible sous le filtre dont c'était pourtant
  le sujet. La ligne disparaît maintenant, une fois le serveur confirmé — hors
  ligne ou sur un refus, elle reste. Ouvrir un article ne retire pas sa ligne,
  et le marquage au défilement non plus — celle de l'article ouvert ne part
  jamais, pour que suivant/précédent continuent de fonctionner. La liste
  enchaîne les pages suivantes au fil des retraits, et n'annonce « tout est
  lu » que lorsqu'il ne reste vraiment plus rien à charger. (issue #10)
- **Le ✓ arrive dans l'affichage compact**, où il manquait alors qu'il existait
  dans les autres dispositions.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
