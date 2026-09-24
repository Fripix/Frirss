# Marquer lu au-dessus / en dessous — conception

**Date** : 2026-09-24
**Demande** : issue #15 (torinkan, 2026-09-22)
**État** : validé par le propriétaire, prêt pour le plan d'implémentation

> **Mise à jour (tâche 4)** : deux décisions ci-dessous ont changé pendant
> l'implémentation et sont corrigées dans ce document plutôt que laissées
> fausses. La borne s'est révélée être l'**identifiant d'entrée**, pas
> l'horodatage envisagé ici (`src/lib/entryId.ts`, pas de `relativeRead.ts`) —
> un horodatage se compare à `published`, alors que FreshRSS compare `ts` à
> l'`id` d'insertion. Et la confirmation, écartée à la conception, a été
> ajoutée à la revue finale : les deux entrées respectent désormais le réglage
> « Confirmer avant de tout marquer comme lu » (`confirmMarkAllRead`,
> `uiStore`), comme le bouton « Tout lu ».

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
3. ~~**Pas de confirmation.** L'action part au clic, comme les autres entrées
   du menu.~~ **Corrigé (tâche 4)** : les deux entrées respectent le réglage
   existant « Confirmer avant de tout marquer comme lu »
   (`confirmMarkAllRead`, `uiStore`, actif par défaut), via la même fonction
   pure que le bouton « Tout lu » (`markAllReadAction`,
   `src/lib/markAllRead.ts`). Premier clic : l'entrée devient
   `articleList.confirm` sans agir ni fermer le menu ; second clic : l'action
   part et le menu se ferme. C'est irréversible dans les deux cas (voir plus
   bas) — la confirmation ne change rien à ça, elle réduit seulement le risque
   du clic accidentel.
4. **Deux entrées à plat**, pas de sous-menu, avec flèches :
   **« ↓ Tout lu en dessous »** et **« ↑ Tout lu au-dessus »**.
   En anglais, les mots de la demande : « Mark below as read » / « Mark above as
   read ».

## Ce que « irréversible » veut dire ici

Pour « en dessous », FreshRSS marque tout ce qui précède une borne : nous ne lui
donnons pas la liste des articles touchés, et il ne nous la rend pas. Il n'y a
donc **aucun moyen honnête d'annuler**, ni de dire combien d'articles ont
changé. C'est le même marché que « Tout lu », qui n'a pas d'annulation non plus.
L'interface ne promettra donc rien de tel.

> **Corrigé (tâche 4)** : cette borne n'est **pas** un horodatage comme envisagé
> ici, mais l'**identifiant d'entrée** de l'article cliqué
> (`src/lib/entryId.ts`) — FreshRSS compare `ts` à l'`id` d'insertion de
> l'entrée, pas à `published`. Une borne de date se serait trompée sur tout
> flux dont l'ordre d'insertion diverge de l'ordre de publication (import en
> masse, republication).

## Architecture

### `src/lib/articleMenu.ts` (pur, déjà testé)

Deux `ArticleMenuKind` de plus — `markBelowRead`, `markAboveRead` — insérés
**après** `toggleRead`, avec leurs clés i18n. Toujours présentes dans les vues
où elles ont un sens : la position d'une ligne dans la liste chargée ne dit pas
si le flux contient quelque chose au-dessus ou en dessous, donc les masquer
selon l'index mentirait une fois sur deux (masquage par **vue**, voir plus
bas — pas par index).

### `src/lib/entryId.ts` (pur, nouveau)

> **Corrigé (tâche 4)** : ce module s'appelait `relativeRead.ts` à la
> conception, avec des conversions d'horodatage (`exclusiveOlderThanUsec`,
> `exclusiveNewerThanSec`) — abandonnées en cours d'implémentation au profit de
> l'identifiant d'entrée, voir plus haut. Ce qui suit décrit le module tel
> qu'il existe.

L'identifiant d'entrée FreshRSS caché dans l'identifiant greader d'un article
(hexadécimal côté `.../reader/item/<hex>`, décimal nu côté
`stream/items/ids`) — tout en `BigInt` et chaînes, seize chiffres décimaux
dépassant la précision d'un `number` :

```ts
/** L'identifiant d'entrée, en décimal, ou `null` si la forme est inconnue. */
export function entryIdUsec(articleId: string): string | null;
/** Borne exclusive « en dessous » : un cran sous l'entrée cliquée. */
export function exclusiveOlderThanEntryId(articleId: string): string | null;
/** `a` a-t-il été inséré avant `b` ? Un id illisible n'est jamais « plus ancien ». */
export function isOlderEntry(a: string, b: string): boolean;
```

Chacune retire une unité pour que **l'article cliqué ne soit pas inclus** : il
garde son état, c'est ce qu'on attend d'un « en dessous ».

### `src/api/feeds.ts`

- **En dessous** : `markAllAsRead(streamId, ts)` — la fonction existe déjà,
  c'est celle du bouton « Tout lu » ; `ts` vient d'`exclusiveOlderThanEntryId`.
  Un seul appel.
- **Au-dessus** : pas d'équivalent. Nouvelle fonction
  `itemIdsNewerThanEntry(streamId, stopAtArticleId)` qui lit
  `/stream/items/ids?s=<stream>&n=1000` et **suit la continuation jusqu'à
  l'article cliqué** (`isOlderEntry`), pas jusqu'à épuisement d'une borne de
  date — la promesse « chargé ou non » vaut dans les deux sens, et une page
  d'identifiants ne pèse que quelques dizaines de kilo-octets. Puis
  `markAsRead(ids)` **par lots de 100** : `editTag` accepte déjà un tableau,
  mais une URL d'un millier de paramètres `i=` n'est pas raisonnable.

### `src/stores/feedStore.ts`

Une action : `markReadRelative(article: Article, direction: 'above' | 'below')`.

- Le stream vient de la vue courante, par la même règle que `markAllAsRead`
  (`selectedFeed?.id ?? reading-list`).
- Mise à jour optimiste des lignes affichées du bon côté de la borne
  (l'identifiant d'entrée de l'article cliqué).
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

> **Ajouté (tâche 4)** : les entrées n'apparaissent que si `canMarkRange`
> (`canMarkAllRead(filter)`) est vrai — absentes en Favoris et À lire plus
> tard plutôt que présentes sans effet — et réutilisent `markAllReadAction`
> pour la confirmation (voir plus haut).

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
  l'état lu/favori de l'article — et absentes quand `canMarkRange` est faux
  (tâche 4).
- **`entryId`** (`src/lib/entryId.test.ts`, remplace `relativeRead` envisagé
  ici) : conversions hexadécimal→décimal, et surtout **l'exclusion** — un
  article ne doit pas être dans sa propre sélection. Prouvé par une variante
  qui retire le décalage et fait rougir le test.
- **`feedStore`** (API simulée, `feedStore.markRange.test.ts`) : « en dessous »
  fait **un seul** appel avec la bonne borne ; « au-dessus » relève les
  identifiants puis marque par lots de 100 ; l'article cliqué n'est dans aucun
  lot ; le corpus est vidé ; les compteurs sont resynchronisés ; un échec rend
  les lignes à leur état.
- **Composant** : les deux entrées sont rendues et appellent l'action avec la
  bonne direction ; masquées quand `canMarkRange` est faux ; la confirmation
  respecte `confirmMarkAllRead` (tâche 4).

## Documentation et traductions

`docs/FEATURES.md` (section du menu contextuel), `docs/RELEASE-NEXT.md`, et deux
clés dans les **dix** locales.

## Hors périmètre

- L'annulation : impossible honnêtement pour « en dessous », et une annulation
  qui ne marcherait que dans un sens serait pire que rien.
- Le sous-menu de la capture : deux entrées ne le justifient pas.
- ~~Une confirmation : écartée par le propriétaire.~~ **Corrigé (tâche 4)** :
  ajoutée, via le réglage existant plutôt qu'un mécanisme propre — voir la
  décision 3.
- Un compte d'articles touchés : le serveur ne le donne pas.
