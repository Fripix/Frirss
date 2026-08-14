# Confirmation optionnelle de « Tout marquer comme lu »

**Date :** 2026-08-15 · **Cible :** 1.3.4 (dev) · **Origine :** demande Reddit (« important »)

## Problème
« Tout marquer comme lu » exige toujours un 2ᵉ clic de confirmation. Utile contre
les clics accidentels, mais gênant pour qui vide souvent ses listes.

## Solution
Une préférence pour désactiver la confirmation.

- **Préférence** `confirmMarkAllRead` (booléen, **défaut `true`** = comportement
  actuel), persistée localStorage (`frirss_confirmMarkAllRead`) et **synchronisée**
  (ajout à `jsonKeys` + `UI_SYNC_KEYS` de uiStore).
- **Comportement** (`ArticleList.handleMarkAllRead`) : décision via helper pur
  `markAllReadAction(confirmEnabled, isConfirming)` →
  - `false, *` → `'mark'` (immédiat, pas de 2ᵉ clic)
  - `true, false` → `'ask'` (passe en état « Confirmer ? »)
  - `true, true` → `'mark'`
- **UI** : nouvel onglet **« Général »** dans les préférences, avec le toggle
  « Confirmer avant de tout marquer comme lu : On/Off ».
- **i18n** : fr + en (onglet + libellé + aide).

## Vérification
- TDD `markAllReadAction` (4 cas).
- Vérif navigateur sur `:dev` : onglet Général présent, toggle Off → un seul clic
  marque tout lu ; toggle On → confirmation en 2 clics.
