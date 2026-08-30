# 1.4.5 — en préparation

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

- **Le focus clavier est enfin visible.** Un anneau `:focus-visible` global :
  l'interface comptait 137 boutons pour 4 anneaux de focus, tous sur l'écran de
  connexion. Naviguer au clavier hors des raccourcis dédiés était impossible.
- **iOS ne zoome plus sur les champs de saisie.** La règle qui les forçait à
  16 px perdait contre les classes utilitaires : mesuré à 14 px sur l'écran de
  connexion, sur tous les champs sauf celui de la recherche, qui avait son
  contournement à lui.
- **Le texte des boutons pleins est lisible.** Le blanc était écrit en dur sur
  l'accent et sur la couleur de danger, deux couleurs que l'utilisateur choisit ;
  sur l'accent menthe par défaut, cela donnait 1,9:1. L'encre est maintenant
  calculée à partir de la couleur de fond. Idem pour les pastilles d'étiquette,
  qui pouvaient écrire leur nom en blanc sur un fond jaune.
- **Les articles non lus se repèrent dans la liste.** Une barre à gauche de la
  ligne, dans les modes Standard et Aperçu, où l'état non-lu ne tenait qu'à la
  graisse du titre et à sa nuance de gris.
- **Le texte d'un article ne s'étale plus sur toute la largeur** en mode Focus :
  la colonne de lecture est plafonnée et centrée.
- **Les champs de saisie atteignent 44 px au doigt**, comme les boutons.
- **Les surbrillances de glisser-déposer suivent le thème.** Trois d'entre elles
  étaient en orange codé en dur — l'accent d'une ancienne version.
- **Les boutons à icône seule ont un nom** pour les lecteurs d'écran, en plus de
  leur infobulle, que le tactile n'affiche jamais.
- **« Mouvement réduit » est respecté partout**, y compris par les deux
  transitions de navigation mobile, dont les durées échappaient au CSS.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

Aucune.

## Documentation

_(rien pour l'instant)_
