# Filtre « Non lus » : par flux ou pour tous les flux — design

**Date** : 2026-09-10
**Statut** : approuvé (brainstorming)
**Origine** : discussion #13, « Global "unread" filter by click the "unread"
button ». Snake883 active « Non lus » sur un flux, change de flux, et doit le
réactiver. Il le fait pour chacun de ses flux.

## Le constat

**Le filtre a été global, puis rendu par flux, délibérément.** Le commit
`6c19c36` (2026-07-31) l'explique : un seul drapeau global faisait qu'activer
« Non lus » sur un flux l'activait partout. Il vit depuis dans
`uiStore.unreadOnlyByFeed`, une table `{ [id du flux ou de l'étiquette]: booléen }`
où la clé `''` désigne la vue d'accueil « tous les flux ».

Snake883 demande l'inverse de cette décision. **Les deux besoins existent** : on
ne revient pas en arrière, on laisse choisir la portée.

## Ce qui change

### 1. Un réglage de portée, dans Préférences → Général

**Filtre Non lus** — contrôle segmenté à deux choix, placé sous « Marquer lu au
défilement » :

- **Par flux** (défaut) — chaque flux garde son propre choix.
- **Tous les flux** — le bouton Non lus de la liste s'applique partout : flux,
  catégories, étiquettes et vue d'accueil.

Pas dans l'onglet Flux : il ne contient que la gestion des serveurs et des
catégories. Général porte déjà les réglages de lecture voisins
(`confirmMarkAllRead`, `markReadOnScroll`).

Le balisage reprend celui du « Mode d'authentification »
(`AdminTab.tsx`, `role="radiogroup"`, boutons simples) : un clic est toujours
pris en compte, contrairement à une radio native imbriquée dans un label.

### 2. La règle de résolution

Une seule fonction pure décide si une vue s'ouvre filtrée :

```
unreadOnlyFor(clé, { scope, all, byFeed })
  scope === 'all'  → all
  scope === 'feed' → byFeed[clé] ?? all
```

- `scope` : `'feed' | 'all'`, défaut `'feed'`.
- `all` : booléen, défaut `false` — l'état global, et le point de départ des
  flux sans choix propre.
- `byFeed` : `unreadOnlyByFeed`, inchangé dans sa forme.

**Non-régression, par construction.** Tant que le mode global n'a jamais servi,
`all` vaut `false`, et `byFeed[clé] ?? false` rend exactement ce que rend
aujourd'hui `unreadOnlyByFeed[clé] ? 'unread' : 'all'` — pour `undefined`,
`true` et `false`. Un test l'impose sur les trois valeurs.

### 3. L'écriture

`setUnreadFilter(on)` (le bouton Non lus de l'en-tête, dans ses trois variantes
de mise en page, et l'action de l'état vide) :

- `scope === 'feed'` → `setFeedUnreadOnly(clé, on)`, comme aujourd'hui ;
- `scope === 'all'` → `all = on`. `byFeed` n'est pas touché.

**Conséquence assumée** : en mode « Tous les flux », le bouton de l'état vide
« Tout est lu » (qui désactive le filtre pour montrer tous les articles) le
désactive partout. C'est le sens même du mode.

### 4. Les changements de portée

Changer de portée **ne recharge jamais la vue affichée**.

- **Par flux → Tous les flux** : `all` prend le choix enregistré de la vue
  affichée (`unreadOnlyFor(clé courante)` en portée `feed`). Rien ne bascule à
  l'écran. `byFeed` n'est pas touché.
- **Tous les flux → Par flux** : **le dernier état est conservé**. `byFeed` est
  vidé, `all` reste tel quel : chaque flux repart de l'état global du moment, et
  les clics suivants sur le bouton Non lus enregistrent à nouveau des choix par
  flux.
  ⚠️ **Les choix par flux antérieurs au passage en mode global sont perdus**, et
  la suppression est synchronisée sur tous les appareils. C'est la décision du
  propriétaire : ils ne doivent pas ressurgir.
- Choisir la portée déjà active ne fait rien.

Les deux transitions vivent dans une fonction pure,
`switchUnreadScope(prefs, vers, cléCourante) → prefs`.

### 5. Synchronisation

`unreadOnlyScope` et `unreadOnlyAll` rejoignent `unreadOnlyByFeed` dans
`UI_SYNC_KEYS` et dans les clés JSON d'`applyServerPrefs` (persistance
`frirss_unreadOnlyScope`, `frirss_unreadOnlyAll`). `applyServerPrefs` applique
toutes les clés en un seul `set` : un autre appareil ne voit jamais la portée
nouvelle avec l'ancienne table.

Une portée inconnue (valeur venue d'une version future) se normalise en
`'feed'`, comme `offlineImagePreset` et `rowActions` le font déjà.

## Ce qui ne bouge pas

- **La règle « le ✓ retire la ligne sous Non lus »** (issue #10) : elle lit
  `feedStore.filter`, l'état dérivé, et sa spec interdit de se brancher sur
  `unreadOnlyByFeed`. Aucune dépendance au nouveau réglage.
- **Les entrées fixes** Non lus, Favoris, À lire plus tard (barre latérale et
  palette de commandes) : elles passent un filtre explicite à `selectView`.
- **La reprise à l'ouverture** (`App.tsx`, `saved.filter` explicite).
- **Le cache mémoire des vues** : `viewKey` ne connaît que le flux et le filtre.
- **La disposition par flux** (`effectiveLayout`) et `hideReadFeeds`.
- **`settingsCoverage.test.ts`** : il gèle les 232 réglages existants, le relevé
  ne doit pas bouger.

## Points de lecture remplacés

Les quatre lectures directes passent par `unreadOnlyFor()` :

| Site | Rôle |
|---|---|
| `src/stores/feedStore.ts` — état initial `filter` | vue d'accueil au démarrage |
| `src/stores/feedStore.ts` — `selectView` sans filtre | navigation flux / catégorie / étiquette |
| `src/stores/feedStore.ts` — `prefetchView` | préchargement : doit chauffer la bonne vue |
| `src/App.tsx` — après `hydratePrefs()` | vue d'accueil une fois les préférences reçues |

Et l'unique écriture, `setUnreadFilter`, choisit sa cible selon la portée.

## Tests

Logique pure d'abord, dans `src/lib/unreadScope.ts`, testée avant d'être écrite :

- `unreadOnlyFor` — portée `feed` avec `all = false` : équivalence stricte avec
  l'expression actuelle pour `undefined`, `true`, `false` ; portée `feed` avec
  `all = true` : un flux sans choix hérite, un flux avec choix le garde ; portée
  `all` : la table est ignorée.
- `switchUnreadScope` — vers `all` : `all` prend le choix de la clé courante, la
  table est intacte ; vers `feed` : la table est vidée, `all` conservé ; même
  portée : objet inchangé.

Dans les stores :

- `setUnreadFilter` en portée `all` écrit `all` et ne touche pas la table ;
- `selectView` en portée `all` ouvre filtré un flux qui avait `false` ;
- les tests existants de `uiStore.test.ts` et `feedStore.test.ts` restent verts
  **sans modification** : ce sont eux, la non-régression du mode par flux ;
- la liste des clés synchronisées du test `uiStore` inclut les deux nouvelles.

Vérification visuelle du contrôle segmenté à **320 px**, sur tablette et sur
desktop, dans un thème clair et un sombre.

## Fichiers touchés

| Fichier | Rôle |
|---|---|
| `src/lib/unreadScope.ts` (nouveau) | `unreadOnlyFor`, `switchUnreadScope` + tests |
| `src/stores/uiStore.ts` | deux préférences, action de portée, synchronisation |
| `src/stores/feedStore.ts` | trois lectures + `setUnreadFilter` |
| `src/App.tsx` | lecture après hydratation |
| `src/components/Preferences/GeneralTab.tsx` | le contrôle segmenté |
| `src/locales/*.json` | libellé, aide et deux choix, dans les **10** locales |
| `docs/FEATURES.md` | Liste d'articles et Préférences — obligatoire, même commit |

## Hors périmètre

Le clic droit sur un article (issue #11) et le rafraîchissement automatique de la
liste (discussion #14) font l'objet de leurs propres cycles. Le bouton Non lus
lui-même, son icône et sa place dans l'en-tête ne changent pas.
