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

- **Marquer lu tout ce qui précède — ou suit — un article.** Le menu d'un
  article (clic droit, appui long, touche Menu) propose « Tout lu au-dessus »
  et « Tout lu en dessous » : tous les articles plus anciens, ou plus récents,
  de la vue courante passent lus — y compris ceux que la liste n'a pas encore
  chargés. Ces deux entrées respectent le réglage « Confirmer avant de tout
  marquer comme lu » (désactivé par défaut — qui l'a explicitement activé
  garde son choix), comme « Tout lu » : réglage actif, un premier clic
  demande confirmation et un second agit ; réglage éteint (le défaut), un
  seul clic suffit. Aucune des deux n'a d'annulation, comme « Tout lu ».
  Elles n'apparaissent pas dans Favoris ni À lire plus tard : ce ne sont pas
  des flux qu'on vide, ce sont des sélections transversales. L'article
  cliqué, lui, n'est jamais touché. Demandé dans l'issue #15.

- **« Confirmer avant de tout marquer comme lu » est désormais désactivé par
  défaut.** « Tout lu » et les deux marquages de plage agissent donc au
  premier clic, sans confirmation, pour qui n'a jamais touché ce réglage
  (Préférences → Général). Qui l'avait explicitement activé garde son choix —
  seule la valeur par défaut change.

## Corrections et améliorations

- **La recherche filtre enfin.** Elle ne filtrait rien : FriRSS envoyait un
  paramètre `q` que l'API Google Reader de FreshRSS n'a jamais lu — vérifié sur
  les versions 1.20.2, 1.23.1, 1.24.3, 1.26.0 et 1.27.0 — et le serveur
  renvoyait le flux entier. Un terme inexistant ramenait quand même tous les
  articles. Le filtrage se fait
  désormais dans le navigateur : FriRSS balaye le périmètre de la vue courante
  (flux, catégorie, ou tous les flux), articles lus compris, affiche les
  correspondances au fur et à mesure avec un compteur et un bouton pour
  arrêter, et ne dit « aucun résultat » qu'une fois le balayage terminé. Les
  accents et la casse sont ignorés, tous les mots de la requête sont exigés.
  Hors ligne, la recherche fouille ce que l'appareil détient et le dit.
  **Changement de comportement** : changer de flux, de filtre ou de catégorie
  referme désormais la recherche, au lieu de laisser la boîte remplie au-dessus
  d'une autre vue.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
