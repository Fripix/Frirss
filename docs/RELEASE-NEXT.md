# 1.4.8 — en préparation

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

- **Passer à l'article suivant ne fait plus sauter le texte.** Sur un flux à
  extraction automatique, FriRSS préchargeait le texte des articles suivants
  mais pas leurs images : elles n'arrivaient qu'une fois l'article ouvert, et
  poussaient le texte vers le bas (très visible sur iPhone, en PWA). Le
  préchargement réchauffe désormais aussi les images du corps, et porte sur les
  **dix** articles suivants au lieu de cinq. Il obéit au réglage « images hors
  ligne » : sur « aucune », rien n'est téléchargé.
- **Changer de flux pendant un chargement ne mélange plus les listes.** Quand
  une page du scroll infini arrivait après un changement de flux, ses articles
  étaient ajoutés à la liste affichée — celle d'un autre flux — et le mélange
  était enregistré dans le cache de la vue quittée : il revenait tel quel au
  rechargement suivant, y compris hors ligne. La page est désormais jetée si
  la vue a changé entre-temps.
- **Le scroll infini d'une recherche reste dans la recherche.** Descendre au
  bas d'une liste de résultats chargeait la suite du **flux**, pas celle de la
  requête : des articles sans rapport s'ajoutaient sous une boîte de recherche
  toujours remplie. La pagination poursuit désormais la recherche, dans le même
  périmètre (flux, catégorie, favoris, à lire plus tard).

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
