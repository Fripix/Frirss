# Vue agrégée par catégorie

**Date :** 2026-08-14 · **Cible :** 1.3.4 (dev) · **Origine :** demande Reddit (récurrente)

## Problème

Dans la sidebar, on ne peut ouvrir que « Tous les articles » ou un flux unique.
Impossible de voir, d'un clic, **tous les articles de tous les flux d'une
catégorie**. L'interface native de FreshRSS le permet.

## Solution

Traiter une catégorie comme un flux sélectionnable : ouvrir le flux
`user/-/label/<catégorie>` via l'API Google Reader (agrégation **côté
serveur**, pas de regroupement client).

### Données
- `cat.id` (construit depuis `sub.categories[0].id`) est déjà l'identifiant de
  flux `user/-/label/…`.
- `fetchArticleStream` passe `selectedFeed.id` à `getStreamContents`, et
  `buildStreamPath` gère les flux `user/-/label/…`. Donc pagination, cache
  (mem/Redis/IndexedDB via `viewKey`), filtre lu/non-lu et « tout marquer lu »
  fonctionnent sans code serveur supplémentaire.

### Store
- Nouvelle action `selectCategory(cat: FeedCategory)` : construit un
  `{ id: cat.id, title: cat.label }` synthétique et délègue à `selectView`
  (qui applique la préférence « non-lu seulement » propre à la clé).
- `selectedFeed` porte alors la catégorie. Le code ne lit que `.id`/`.title` →
  circule proprement. Chaque article garde le nom de sa vraie source.

### Sidebar (interaction : « Nom ouvre, chevron plie »)
- **Chevron** = zone cliquable dédiée → `toggleCategoryCollapsed` (stopPropagation).
- **Nom** → `selectCategory(cat)` (ouvre la vue agrégée).
- Ligne surlignée quand `selectedFeed?.id === cat.id`.
- Drag & drop (mode Organiser) et pli/dépli conservés.

### Robustesse
- L'en-tête de la liste d'articles / ReadingPane ne doit pas planter quand
  `selectedFeed` n'est pas un vrai flux : recherche de favicon rendue gracieuse
  (nom de catégorie affiché, pas d'icône si introuvable).

## Hors périmètre (MVP)
- Compteur de non-lus à côté des catégories (l'API le fournit ; à ajouter
  ensuite si voulu).

## Vérification
- Test de contrat store : `selectCategory` → `getStreamContents('user/-/label/…')`
  demandé + `selectedFeed` positionné.
- Navigateur sur `:dev` : clic nom = articles agrégés, chevron = pli, surlignage.
