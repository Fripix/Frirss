# Recherche côté client — conception

**Date** : 2026-09-23
**État** : validé par le propriétaire, prêt pour le plan d'implémentation

---

## Le problème

La recherche de FriRSS ne filtre rien, et ne l'a jamais fait.

`searchItems` envoie `q=<requête>` à l'API Google Reader de FreshRSS. **Cette API
n'a pas de paramètre de recherche.** Dans `p/api/greader.php`,
`streamContentsFilters` n'accepte que `xt`, `it`, `n`, `r`, `ot`, `nt`, `c`, `s`
et `output` ; le `FreshRSS_BooleanSearch` qu'il construit n'est rempli qu'avec
des bornes de dates. Vérifié sur les versions 1.20.2, 1.23.1, 1.24.3, 1.26.0 et
1.27.0 : aucune ne lit `q`. Ce n'est donc pas une régression, c'est une absence
de toujours.

Preuves recueillies le 2026-09-23 sur l'instance de dev :

- L'app envoie bien la requête — `q=` est présent dans la cible du proxy
  (constaté en interceptant `XMLHttpRequest.setRequestHeader`).
- Le proxy ne perd pas les paramètres : une URL publique de test renvoyée en
  écho à travers `/api/proxy` reçoit bien son paramètre.
- FreshRSS répond sans filtrer : `q=zzzznotarealword` rend les vingt articles
  demandés, sur `stream/contents` comme sur `stream/items/ids`, et avec la
  syntaxe `intitle:`. Même résultat avec un paramètre anti-cache, donc le cache
  Redis n'y est pour rien (`cacheKey` hache l'URL complète, `q` compris).
- FriRSS ne filtre nulle part côté client : `search()` affiche ce que le serveur
  renvoie.

La recherche de l'interface web de FreshRSS, elle, fonctionne : elle passe par
le chemin interne de FreshRSS, pas par l'API greader.

`README.md` et la section « Recherche » de `docs/FEATURES.md` décrivent
aujourd'hui une fonctionnalité qui n'existe pas. Un inventaire faux est pire
qu'un inventaire absent.

## Ce qu'on construit

Le filtrage passe **côté client**, dans le périmètre de la vue courante, **sans
limite fixe** : on balaye tous les articles du périmètre et on garde ceux qui
correspondent.

Mesures faites sur le compte de dev, qui rendent l'approche viable :

| Mesure | Valeur |
|---|---|
| Archive complète (tous flux, lus compris) | 10 025 articles |
| Page maximale acceptée par l'API | `n=1000` — 1 000 articles en 830 ms, 2,07 Mo |
| Balayage complet | ~11 requêtes, ~21 Mo, ~10 s |
| Un flux seul | 1 requête, instantané |
| Plafond du proxy | 600 req/min — jamais approché |
| Texte par article | ≈1 160 caractères en moyenne (le contenu vient avec la liste) |

Chercher dans le texte ne coûte donc rien de plus que chercher dans les titres :
le contenu est déjà dans la charge utile.

## Décisions

1. **Corpus fouillé : tous les articles du périmètre, lus compris**, même quand
   le filtre « Non lus » est actif. Retrouver un article déjà lu est le premier
   usage d'une recherche.
2. **Le corpus balayé est gardé pour la session**, par périmètre, cinq minutes :
   affiner une requête ne repaye pas le réseau.
3. **Correspondance** : tous les mots de la requête présents dans le titre ou le
   texte, insensible à la casse et aux accents, HTML retiré et entités décodées
   avant comparaison. Pas d'opérateurs, pas de score de pertinence.
4. **Affichage au fil de l'eau** pendant le balayage, avec une ligne d'état
   (« N articles parcourus · M résultats ») et un bouton Arrêter.
5. **Beaucoup de résultats** : tri par date décroissante, tranches de 50
   complétées au défilement — le scroll infini existant, débranché du réseau.

## Architecture

### `src/lib/searchMatch.ts` (pur)

```ts
export function normalizeForSearch(text: string): string;   // minuscules + NFD sans diacritiques
export function stripHtml(html: string): string;            // balises retirées, entités décodées
export function parseQuery(query: string): string[];        // mots normalisés, vides et doublons écartés
export function articleHaystack(article: Article): string;  // titre + texte, normalisés une fois
export function matchesTerms(haystack: string, terms: readonly string[]): boolean;
```

Toutes les règles de correspondance vivent ici, sans I/O ni store. Le haystack
est calculé **une seule fois par article**, au moment du balayage, jamais à
chaque frappe.

### `src/api/feeds.ts`

```ts
export function fetchStreamPage(
  streamId: string, count: number, continuation: string | null
): Promise<GReaderStream>;
```

`searchItems` et son `q` disparaissent : c'est ce paramètre qui a entretenu
l'illusion.

### `src/lib/searchCorpus.ts` (pur)

Clé de périmètre dérivée de `resolveSearchStreamId` (déjà en place : flux,
catégorie, favoris, à lire plus tard, tous les flux), fraîcheur (TTL cinq
minutes), et la décision « réutiliser ou rebalayer ». Testable sans réseau.

### `src/stores/feedStore.ts` (orchestration)

`search(query)` boucle sur `fetchStreamPage` par tranches de 1 000 en suivant la
continuation — le balayage est séquentiel par nature, chaque page portant la
continuation de la suivante —, filtre chaque tranche au passage, pousse les
correspondances dans `searchResults`, tient `searchScan { scanned, running,
done, error, continuation }`, et s'arrête sur `stopSearch()`, au changement de
vue ou de serveur.

Un seul corpus est gardé à la fois : le dernier périmètre.

`searchResults` porte **toutes** les correspondances ; `articles` — la liste que
le composant rend déjà — en reçoit la tranche visible. Le composant continue donc
de lire une seule source, comme aujourd'hui.

### `src/components/ArticleList/`

La ligne d'état (compteur, Arrêter, Réessayer) et la pagination locale par
tranches de 50 sur `searchResults`.

## Comportement

- **Déclenchement** : validation, ou 500 ms après la dernière frappe. Tant que le
  corpus du périmètre est frais, affiner ne touche plus au réseau. Affiner
  pendant un balayage applique aussitôt les nouveaux mots à ce qui est déjà
  parcouru, et le balayage continue avec eux.
- **Périmètre** : celui de la vue au moment de la recherche. Changer de flux
  annule le balayage et referme la recherche, comme aujourd'hui.
- **Filtre Non lus ignoré** : les résultats mêlent lus et non lus ; chaque ligne
  porte déjà son état.
- **Ordre** : date décroissante, l'ordre naturel du flux.
- **Ligne d'état** : pendant, « 3 000 articles parcourus · 7 résultats » +
  Arrêter ; terminée, elle disparaît ; vide **et terminée**, « Aucun résultat » —
  jamais avant la fin, c'est tout l'enjeu du compteur ; interrompue,
  « balayage interrompu · N articles parcourus », résultats conservés.
- **Inchangé** : recherches récentes, pastille masquée pendant une recherche,
  marquage au défilement éteint pendant une recherche.

## Cas limites

- **Hors ligne** : pas de balayage. On filtre ce qui est en mémoire et ce que le
  cache hors ligne détient pour ce périmètre, et la ligne d'état le dit —
  « résultats parmi les articles disponibles hors ligne ». Une recherche qui
  prétendrait avoir tout vu serait pire que pas de recherche.
- **Coupure en plein balayage** : résultats conservés, état « interrompu —
  réseau », et **Réessayer reprend à la continuation en cours**.
- **429 du proxy** : traité comme une coupure, avec son propre message.
- **401 amont** : un 401 de FreshRSS ne ferme pas la session FriRSS — la
  distinction existe (`isBackendAuthFailure`), le balayage n'y touche pas.
- **Changement de serveur** : balayage annulé, corpus vidé — ses articles
  décrivent un autre monde (même garde que dans `syncCounts`).
- **Écritures pendant une recherche** : cocher lu, favori ou « à lire plus tard »
  depuis un résultat met à jour **l'article dans le corpus** en même temps que la
  ligne. Sans ça, la recherche suivante ressortirait l'ancien état. La ligne ne
  quitte pas la liste : on est en recherche, pas dans la vue Non lus.
- **Doublons** : un flux qui bouge pendant le balayage peut livrer deux fois le
  même article — déduplication par identifiant.
- **Purge du corpus** : TTL cinq minutes, changement de vue, de serveur, ou
  déconnexion.

## Tests

Écrits avant le code ; chaque garde-fou doit être vu rouge sans sa garde.

- **`searchMatch`** : accents dans les deux sens, casse, plusieurs mots dans le
  désordre, un mot absent qui exclut, balises retirées (« href », « img » ne
  ramènent personne), entités décodées (`l&#39;été` trouvé par « été »).
- **`searchCorpus`** : clé par périmètre, expiration, invalidation vue/serveur,
  réutiliser vs rebalayer.
- **`feedStore`** (fausse fonction de page) : pagination jusqu'à épuisement,
  arrêt manuel, reprise après échec à la bonne continuation, affinage en cours de
  balayage, déduplication, annulation au changement de serveur, corpus mis à jour
  par une écriture locale.
- **Composant** : compteur pendant le balayage, « Aucun résultat » seulement une
  fois terminé, bouton Arrêter, pagination locale par 50.

## Documentation et traductions

- **`docs/FEATURES.md`** : section Recherche réécrite — le balayage, le corpus,
  le périmètre, la limite réelle, et le fait que l'API greader n'a pas de
  paramètre de recherche, pour que personne ne « rétablisse » le `q`.
- **`README.md`** : la puce qui promet une recherche côté serveur est corrigée.
- **`docs/RELEASE-NEXT.md`** : entrée franche — la recherche ne filtrait rien.
- **Traductions** : ligne d'état (avec pluriels), Arrêter, Réessayer, trois
  messages d'échec (hors ligne, réseau, trop de requêtes) — dix locales,
  `_few`/`_many` compris.

## Risque assumé

Garder le corpus en mémoire, sur « Tous les flux », c'est de l'ordre de **30 à
40 Mo** pour 10 000 articles. Confortable sur ordinateur, à surveiller sur
téléphone, où le navigateur peut décharger un onglet gourmand laissé en
arrière-plan. On commence simple — corpus entier, purgé à cinq minutes — et **on
mesure sur le téléphone du propriétaire pendant les tests**. Si ça coince, on ne
garde que le texte normalisé et les articles correspondants, ce qui divise la
facture par trois.

## Hors périmètre

- Index persistant (IndexedDB) mis à jour en delta : le bon chantier le jour où
  la recherche depuis le téléphone devient fréquente, pas celui-ci.
- Opérateurs (`"expression exacte"`, `-exclusion`) et classement par pertinence.
- Patch amont pour donner un `q` à l'API greader de FreshRSS : souhaitable,
  indépendant, et dépendant d'un cycle de release qui n'est pas le nôtre.
