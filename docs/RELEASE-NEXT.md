# 1.4.12 — en préparation

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

- **Une pastille signale les nouveaux articles.** Quand de nouveaux articles
  arrivent dans la vue affichée, « ↑ N nouveaux articles » apparaît en haut de
  la liste ; un clic les charge. La liste ne change jamais d'elle-même.
  Désactivable dans Préférences → Général. Demandé dans la discussion #14.

## Corrections et améliorations

- **La recherche filtre enfin.** Elle ne filtrait rien : FriRSS envoyait un
  paramètre `q` que l'API Google Reader de FreshRSS n'a jamais lu — vérifié sur
  les versions 1.20.2, 1.23.1, 1.24.3, 1.26.0 et 1.27.0 — et le serveur
  renvoyait le flux entier. Un
  terme inexistant ramenait quand même tous les articles. Le filtrage se fait
  désormais dans le navigateur : FriRSS balaye le périmètre de la vue courante
  (flux, catégorie, ou tous les flux), articles lus compris, affiche les
  correspondances au fur et à mesure avec un compteur et un bouton pour
  arrêter, et ne dit « aucun résultat » qu'une fois le balayage terminé. Les
  accents et la casse sont ignorés, tous les mots de la requête sont exigés.
  Hors ligne, la recherche fouille ce que l'appareil détient et le dit.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
