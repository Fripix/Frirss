# 1.7.1 — en préparation

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

_(rien pour l'instant)_

## Corrections et améliorations

- **Chinois : le statut des résumés et traductions IA se lit avec la virgule
  pleine chasse « ， »** au lieu d'une virgule latine en dur (en-tête du
  panneau, annonce aux lecteurs d'écran, bandeau de traduction). Nouvelle clé
  `ai.separator` dans les dix locales.
- **Lecteurs d'écran : l'annonce d'un résumé dit aussi la bascule de
  fournisseur** (« X indisponible »), celle du résumé comme celle de sa
  traduction. L'en-tête visible la montrait déjà ; l'annonce la taisait.

## Sous le capot

- **Dépendances : body-parser 2.4.0 et qs 6.16.1** (embarqués par Express,
  donc présents dans l'image : avis DoS GHSA-27r3-jxmh-p828 et
  GHSA-6pq8-jhm2-2vcw) ; serialize-javascript 7.1.4 (outillage de build
  seulement). `npm audit` à zéro. Le DoS de body-parser touchait bien le
  `express.json` global ; qs n'est pas atteint (Express 5 lit les requêtes
  avec son parseur `simple`, aucun `urlencoded`).
- **qs épinglé en 6.16.1 par `overrides`** : la 6.17.0 (publiée le jour même
  de la mise à jour) n'ajoute rien de sécuritaire à la 6.16.1, qui porte le
  correctif. Épinglage de prudence, **à retirer au cycle suivant**.
- body-parser 2.4.0 décompresse désormais les corps `Content-Encoding: zstd`
  (avant : 415). Même limite de 5 Mo après décompression que gzip/br ; le
  proxy ne retransmet pas `Content-Encoding`.

## Actions requises à la mise à jour

_(aucune)_

## Documentation

- **README : FriRSS n'embarque aucune IA**, il se branche sur le modèle de
  votre choix (déjà visible sur `main`).
