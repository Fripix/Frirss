# Recherche ciblée (dans un flux / un groupe)

**Date :** 2026-08-16 · **Cible :** 1.3.5 (dev) · **Origine :** Reddit (liste, « important » #6)

## Problème
La recherche tape toujours `stream/contents/user/-/state/com.google/reading-list`
(= tous les flux), même dans un flux précis ou « À lire plus tard ».

## Solution
Rechercher dans le **stream de la vue courante**. FreshRSS respecte le scope du
stream avec `q` (vérifié : « Apple » dans `feed/megaflux` → uniquement
MacGeneration).

### Mécanique
- `searchItems(query, count, continuation, streamId)` : ajoute `streamId`
  (défaut reading-list), via `buildStreamPath`.
- `resolveSearchStreamId(selectedFeed, filter)` (pur, TDD) :
  - `readlater` → `READ_LATER_LABEL`
  - `starred` sans flux → stream *starred*
  - flux/catégorie sélectionné → `selectedFeed.id`
  - sinon → reading-list.
- Le store `search()` passe ce stream à `searchItems`.
- Champ de recherche : placeholder « Rechercher dans {périmètre} » (titre du flux
  / À lire plus tard / Favoris / Non lus / Tous les flux). i18n 9 langues.

## Hors périmètre
- Un bouton « chercher partout » depuis une vue restreinte (à ajouter plus tard
  si voulu). Par défaut : scope = vue courante.

## Vérification
- TDD `resolveSearchStreamId`.
- `:dev` : dans MacGeneration, chercher un terme → résultats de ce flux seulement ;
  idem « À lire plus tard ».
