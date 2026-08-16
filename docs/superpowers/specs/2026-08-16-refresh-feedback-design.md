# Retour visuel après un rafraîchissement

**Date :** 2026-08-16 · **Cible :** 1.3.5 (dev) · **Origine :** Reddit (liste, « important » #5)

## Problème
Après le bouton « Rafraîchir », aucun indice visuel : combien de nouveaux
articles, et où.

## Solution
Comparer les compteurs non-lus **avant/après** le refresh :
- **Bandeau** en haut « X nouveaux articles » (ou « À jour » si 0), auto-effacé
  après ~4 s (style `OfflineBanner`).
- **Surlignage sidebar** : les flux ayant reçu du nouveau **pulsent** brièvement.

### Mécanique
- Helper pur `computeRefreshDelta(before, after)` → `{ totalNew, newByFeed }` :
  ne compte que les clés `feed/…`, deltas positifs uniquement.
- Store : `refreshResult: { totalNew, newByFeed, at } | null` + `clearRefreshResult()`.
  `refresh()` capture `before = unreadCounts` avant `loadSubscriptions`, puis
  calcule le delta après et pose `refreshResult`.
- `RefreshBanner` (monté comme OfflineBanner) lit `refreshResult`, affiche le
  total, et déclenche l'auto-effacement (timer).
- `FeedItem` : si `refreshResult.newByFeed[feed.id] > 0` → classe de pulse.
- i18n dans **les 9 langues** (pluriel via i18next `count`).

## Vérification
- TDD `computeRefreshDelta` (nouveaux, décroissance ignorée, clés non-flux
  ignorées, flux nouvellement apparu).
- `:dev` : rafraîchir → bandeau « X nouveaux articles » + flux concernés qui pulsent.
