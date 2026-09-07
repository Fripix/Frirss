# 1.4.11 — en préparation

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

- **Le menu d'un flux s'ouvre enfin au doigt.** Un appui long sur un flux dans
  la barre latérale ouvre le même menu que le clic droit : renommer, ouvrir le
  site, extraction automatique, se désabonner. Sur téléphone et tablette, ces
  quatre actions n'étaient jusqu'ici accessibles par aucun geste — le bouton ⋯
  n'apparaît qu'au survol d'une souris.
- **Et ce menu ne s'ouvre plus hors de l'écran.** Il s'ancrait au bord droit de
  la ligne sans jamais être ramené dans la fenêtre : sur un téléphone, il
  s'ouvrait en dehors, ce qui donnait l'impression que rien ne se passait. Le
  clic droit près du bord d'une fenêtre étroite était touché de la même façon.
  Une tape à côté du menu le referme désormais aussi au doigt.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
