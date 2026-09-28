# 1.5.0 — en préparation

Journal des changements du cycle en cours, tenu au fil de l'eau. Il alimente les
notes de la release GitHub et les corrections du README, puis se vide une fois
la release publiée.

> **À tenir à jour au moment du commit, pas à la fin du cycle.** Pour la 1.4.3,
> six correctifs manquaient à l'appel : le journal avait été rempli pour les
> gros morceaux et oublié pendant les finitions. Ils n'ont été retrouvés qu'en
> relisant les 57 commits. Contre-vérification utile avant de publier : differ
> `src/locales/en.json` contre le tag précédent — toute chaîne d'interface
> ajoutée ou modifiée doit correspondre à une entrée écrite ici.
>
> **Les commits sans chaîne d'interface échappent à cette contre-vérification.**
> Pour la 1.4.12, le menu du clic droit passé aux icônes et groupes, et le
> correctif de la feuille du bas sur iOS, manquaient tous deux au journal : ni
> l'un ni l'autre n'avait touché `en.json`. Relire aussi `git log`.

## Fonctionnalités

- **Les résultats de recherche disent pourquoi ils sont là.** Le terme cherché
  est surligné dans le titre et le résumé ; quand il ne figure dans ni l'un ni
  l'autre — la recherche fouille le corps entier des articles, que la liste
  n'affiche pas — le résumé cède la place à l'extrait du corps qui a fait
  sortir l'article.

## Corrections et améliorations

- **« Tout marquer comme lu » demande par une boîte de dialogue** (issue #17,
  signalée par @alasdair64) au lieu de changer le bouton en « Confirmer ? » :
  ce second état tombait sous le curseur, si bien qu'un double-clic le validait
  — et le bouton, voisin de « Non lus » et « Favoris », se lisait comme un
  filtre. La boîte annonce le nombre d'articles et la vue concernée. Le réglage
  « Confirmer avant de tout marquer comme lu » la gouverne toujours : désactivé,
  un clic agit immédiatement, comme avant.
- **On peut revenir en arrière après un « tout marquer comme lu »** : un bandeau
  « Annuler » rend non lus exactement les articles qui l'étaient, tant qu'ils ne
  dépassent pas un millier — au-delà, la boîte prévient que l'action sera
  définitive.

- **La barre d'état de la recherche reste affichée une fois le balayage
  terminé** et annonce le nombre de résultats — « lus compris » quand la vue
  filtre les non lus. Elle disparaissait : plus rien ne distinguait alors une
  liste de résultats d'une liste ordinaire, au point de faire croire que la
  recherche ne se lançait pas.
- **La loupe de la recherche envoie vraiment la recherche.** Elle n'était
  qu'une icône : la recherche ne partait qu'en validant au clavier, et sur les
  claviers logiciels où cette validation ne soumet pas le formulaire, elle
  restait inatteignable.
- **Extraction d'article : les images et les liens relatifs ne cassent plus**
  quand le navigateur extrait lui-même la page (le repli, quand la route
  serveur n'a pas pu répondre). La CSP refusait le `<base>` posé pour résoudre
  ces URLs, qui pointaient alors vers FriRSS au lieu du site d'origine — 404
  sur les images, liens qui ramenaient dans l'application.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(aucune)_

## Documentation

_(rien pour l'instant)_
