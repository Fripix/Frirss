# Marquer lu au-dessus / en dessous — conception

**Date** : 2026-09-24
**Demande** : issue #15 (torinkan, 2026-09-22)
**État** : validé par le propriétaire, prêt pour le plan d'implémentation

---

## Le besoin

Un clic droit sur un article, puis « tout ce qui est en dessous devient lu » —
ou au-dessus. La capture jointe à l'issue montre un autre lecteur où ces deux
actions vivent dans un sous-menu « Mark as read ».

FriRSS a déjà le menu contextuel (1.4.11) et le bouton « Tout lu » de la barre
de liste. Il manque le geste intermédiaire : vider ce qui précède un article
sans vider le flux entier.

## Décisions

1. **Portée temporelle** : tout ce qui est plus ancien (ou plus récent) que
   l'article cliqué **dans le flux, chargé ou non**. Pas seulement les lignes
   affichées : deux clics au même endroit doivent faire la même chose, quel que
   soit ce que le scroll infini a rapporté.
2. **Portée de vue** : la **vue courante**, comme « Tout lu » — le flux, la
   catégorie, ou tous les flux. Aucune notion nouvelle à apprendre.
3. **Pas de confirmation.** L'action part au clic, comme les autres entrées du
   menu. Le propriétaire a tranché en connaissant le prix : c'est irréversible
   (voir plus bas).
4. **Deux entrées à plat**, pas de sous-menu, avec flèches :
   **« ↓ Tout lu en dessous »** et **« ↑ Tout lu au-dessus »**.
   En anglais, les mots de la demande : « Mark below as read » / « Mark above as
   read ».

## Ce que « irréversible » veut dire ici

Pour « en dessous », FreshRSS marque tout ce qui précède un horodatage : nous ne
lui donnons pas la liste des articles touchés, et il ne nous la rend pas. Il n'y
a donc **aucun moyen honnête d'annuler**, ni de dire combien d'articles ont
changé. C'est le même marché que « Tout lu », qui n'a pas d'annulation non plus.
L'interface ne promettra donc rien de tel.

## Architecture

### `src/lib/articleMenu.ts` (pur, déjà testé)

Deux `ArticleMenuKind` de plus — `markBelowRead`, `markAboveRead` — insérés
**après** `toggleRead`, avec leurs clés i18n. Toujours présentes : la position
d'une ligne dans la liste chargée ne dit pas si le flux contient quelque chose
au-dessus ou en dessous, donc les masquer selon l'index mentirait une fois sur
deux.

### `src/lib/relativeRead.ts` (pur, nouveau)

Les conversions d'horodatage, parce que les trois unités en jeu sont un piège
classique :

```ts
/** `published` est en millisecondes ; l'API attend des microsecondes. */
export function exclusiveOlderThanUsec(publishedMs: number): string;
/** `ot` (borne basse) est en SECONDES, et exclut l'article cliqué. */
export function exclusiveNewerThanSec(publishedMs: number): number;
```

Chacune retire une unité pour que **l'article cliqué ne soit pas inclus** : il
garde son état, c'est ce qu'on attend d'un « en dessous ».

### `src/api/feeds.ts`

- **En dessous** : `markAllAsRead(streamId, timestampUsec)` — la fonction existe
  déjà, c'est celle du bouton « Tout lu ». Un seul appel.
- **Au-dessus** : pas d'équivalent. Nouvelle fonction
  `itemIdsNewerThan(streamId, sinceSec)` qui lit
  `/stream/items/ids?s=<stream>&ot=<sinceSec>&n=1000` et **suit la continuation
  jusqu'à épuisement** — la promesse « chargé ou non » vaut dans les deux sens,
  et une page d'identifiants ne pèse que quelques dizaines de kilo-octets. Puis
  `markAsRead(ids)` **par lots de 100** : `editTag` accepte déjà un tableau,
  mais une URL d'un millier de paramètres `i=` n'est pas raisonnable.

### `src/stores/feedStore.ts`

Une action : `markReadRelative(article: Article, direction: 'above' | 'below')`.

- Le stream vient de la vue courante, par la même règle que `markAllAsRead`
  (`selectedFeed?.id ?? reading-list`).
- Mise à jour optimiste des lignes affichées du bon côté de l'horodatage.
- **Compteurs** : le nombre réel d'articles touchés est inconnu (côté serveur,
  au-delà de ce qui est chargé). On ne devine pas : `syncCounts()` est appelé à
  la fin et le serveur donne le vrai chiffre. Une baisse n'est pas une arrivée,
  la pastille n'en verra donc rien.
- **Corpus de recherche** : `dropSearchCorpus()`, comme `markAllAsRead` — trop
  d'articles changent pour les répercuter un par un.
- **Échec** : les lignes reviennent à leur état d'origine et un toast le dit.
  Pas de file hors ligne : `markAllAsRead` n'en a pas non plus, et rejouer plus
  tard un marquage de masse daté serait pire que de ne rien faire.

### `src/components/ArticleList/ArticleContextMenu.tsx`

Les deux entrées, avec leurs flèches ↓ ↑. Les lignes de menu font déjà 44 px au
doigt et la feuille mobile n'a besoin d'aucun motif nouveau — c'est tout
l'intérêt d'avoir écarté le sous-menu.

## Cas limites

- **L'article cliqué n'est jamais touché** (les deux bornes l'excluent).
- **Vue « Non lus »** : les lignes marquées disparaissent de la liste, comme
  après un ✓. C'est le comportement existant, il n'est pas modifié.
- **Favoris / À lire plus tard** : l'action marque lu sans retirer l'étoile ni
  l'étiquette — marquer lu et ranger sont deux choses différentes.
- **Recherche en cours** : les entrées restent disponibles ; l'action s'applique
  au **flux de la vue**, pas aux résultats affichés, et le corpus est vidé.
  (Le menu s'ouvre depuis une ligne de résultat comme depuis une ligne normale.)
- **Rien au-dessus / en dessous** : l'appel part quand même et ne change rien.
  Aucun message : annoncer « 0 article » pour un geste sans effet serait du
  bruit.

## Tests

- **`articleMenu`** : les deux entrées présentes, à leur place, quel que soit
  l'état lu/favori de l'article.
- **`relativeRead`** : conversions ms→µs et ms→s, et surtout **l'exclusion** —
  un article daté à `T` ne doit pas être dans sa propre sélection. Prouvé par
  une variante qui retire le décalage et fait rougir le test.
- **`feedStore`** (API simulée) : « en dessous » fait **un seul** appel avec le
  bon horodatage ; « au-dessus » relève les identifiants puis marque par lots de
  100 ; l'article cliqué n'est dans aucun lot ; le corpus est vidé ; les
  compteurs sont resynchronisés ; un échec rend les lignes à leur état.
- **Composant** : les deux entrées sont rendues et appellent l'action avec la
  bonne direction.

## Documentation et traductions

`docs/FEATURES.md` (section du menu contextuel), `docs/RELEASE-NEXT.md`, et deux
clés dans les **dix** locales.

## Hors périmètre

- L'annulation : impossible honnêtement pour « en dessous », et une annulation
  qui ne marcherait que dans un sens serait pire que rien.
- Le sous-menu de la capture : deux entrées ne le justifient pas.
- Une confirmation : écartée par le propriétaire.
- Un compte d'articles touchés : le serveur ne le donne pas.
