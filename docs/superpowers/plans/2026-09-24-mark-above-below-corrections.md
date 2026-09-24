# Marquer lu au-dessus / en dessous — plan de correction

> **Pour les agents :** SOUS-SKILL REQUIS — `superpowers:subagent-driven-development`,
> tâche par tâche. Les étapes sont des cases à cocher (`- [ ]`).

**Pourquoi ce plan.** La revue finale du premier lot (`69d4584..2d49a9e`, neuf
commits, **non poussés**) a trouvé trois défauts bloquants, dont un qui invalide
l'hypothèse centrale de la conception. Ce plan les corrige.

**Le défaut central, vérifié dans la source FreshRSS 1.27.0 :**

```php
private static function markAllAsRead(string $streamId, string $olderThanId)
  → $entryDAO->markReadFeed($f_id, $olderThanId);
  → UPDATE `_entry` SET is_read=? WHERE id_feed=? AND is_read <> ? AND id <= ?
```

Le `ts` que nous envoyons est comparé à **l'identifiant d'entrée** — l'instant
d'insertion, en microsecondes — et non à la date de publication. Nous envoyions
une date de publication : selon les flux, l'action ne marquait **rien** (flux
importé ou rattrapé : identifiants récents, dates anciennes) ou **beaucoup trop**
(article sans date → `published` replié sur maintenant → tout le flux).

**La sortie, sans champ ni appel supplémentaire :** l'identifiant greader d'un
article **est** cet identifiant d'entrée, en hexadécimal.
`tag:google.com,2005:reader/item/00065a872a755226` vaut 1 788 386 439 680 550 µs,
soit le 2 septembre 2026. La borne se calcule donc depuis l'article cliqué.

**Décisions du propriétaire (2026-09-24) :**

1. Dans **Favoris** et **À lire plus tard**, les deux entrées **ne s'affichent
   pas** — même garde que le bouton « Tout lu » (`canMarkAllRead`).
2. Les deux entrées **respectent le réglage de confirmation existant**
   (« Confirmer avant de tout marquer comme lu », actif par défaut).

## Contraintes globales

- **Gates avant CHAQUE commit** : `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **Garde-fou fuite d'infra avant CHAQUE commit** (sortie vide attendue) :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- **Messages de commit** : conventionnels, anglais, neutres. **Jamais** de
  trailer `Co-Authored-By`, jamais de mention d'IA ni de la conversation.
- **Pas de push.**
- **TDD** : test d'abord, vu ROUGE, puis le code, puis VERT.
- **i18n** : toute chaîne d'interface dans les **dix** locales.
- **Rédaction** : commentaires de production et titres de tests en **français
  accentué**.
- **Branche** : `dev`. État de départ : `2d49a9e`, 1195 tests verts.

---

### Task 1 : la borne juste, calculée depuis l'article (module pur)

**Files:**
- Create: `src/lib/entryId.ts`
- Test: `src/lib/entryId.test.ts`
- Delete: `src/lib/relativeRead.ts`, `src/lib/relativeRead.test.ts`

**Interfaces:**
- Produit : `entryIdUsec(articleId: string): string | null`,
  `exclusiveOlderThanEntryId(articleId: string): string | null`,
  `isOlderEntry(a: string, b: string): boolean`.
- `src/lib/relativeRead.ts` disparaît : ses deux fonctions reposaient sur la
  date de publication, que le serveur ne regarde pas. Son seul appelant est
  l'action du store, réécrite en Task 3.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// src/lib/entryId.test.ts
import { describe, it, expect } from 'vitest';
import { entryIdUsec, exclusiveOlderThanEntryId, isOlderEntry } from './entryId';

// Identifiant réel relevé sur un compte FreshRSS : 1 788 386 439 680 550 µs,
// soit le 2 septembre 2026.
const ID = 'tag:google.com,2005:reader/item/00065a872a755226';
const PLUS_ANCIEN = 'tag:google.com,2005:reader/item/00065a09a4bb0ee4';

describe('entryIdUsec', () => {
  it('lit l’identifiant d’entrée caché dans l’identifiant greader', () => {
    expect(entryIdUsec(ID)).toBe('1788386439680550');
  });

  it('accepte un identifiant déjà décimal, tel que le rend stream/items/ids', () => {
    expect(entryIdUsec('1788386439680550')).toBe('1788386439680550');
  });

  it('rend null sur ce qui n’est pas un identifiant — pas une borne fantaisiste', () => {
    for (const mauvais of ['', 'tag:google.com,2005:reader/item/', 'n’importe quoi']) {
      expect(entryIdUsec(mauvais)).toBeNull();
    }
  });
});

describe('exclusiveOlderThanEntryId', () => {
  it('borne juste en dessous de l’article, pour ne pas l’inclure', () => {
    expect(exclusiveOlderThanEntryId(ID)).toBe('1788386439680549');
  });

  it('rend null quand l’identifiant est illisible', () => {
    expect(exclusiveOlderThanEntryId('inconnu')).toBeNull();
  });
});

describe('isOlderEntry', () => {
  it('compare sans passer par un nombre flottant — 16 chiffres ne tiennent pas dans un double', () => {
    expect(isOlderEntry(PLUS_ANCIEN, ID)).toBe(true);
    expect(isOlderEntry(ID, PLUS_ANCIEN)).toBe(false);
    expect(isOlderEntry(ID, ID)).toBe(false);
  });

  it('range un identifiant illisible comme « pas plus ancien » : dans le doute, on ne marque pas', () => {
    expect(isOlderEntry('inconnu', ID)).toBe(false);
    expect(isOlderEntry(ID, 'inconnu')).toBe(false);
  });
});
```

- [ ] **Étape 2 : voir les tests échouer**

Run: `npx vitest run src/lib/entryId.test.ts`
Expected: ÉCHEC — `Failed to resolve import "./entryId"`.

- [ ] **Étape 3 : écrire le module**

```ts
// src/lib/entryId.ts
/**
 * L'identifiant d'entrée FreshRSS caché dans l'identifiant greader d'un article.
 *
 * FreshRSS compare `ts` (mark-all-as-read) à l'`id` de l'entrée — l'instant où
 * il l'a INSÉRÉE, en microsecondes — et non à la date de publication :
 * `UPDATE _entry … WHERE id_feed=? AND is_read <> ? AND id <= ?`. Et il rend
 * cet id en hexadécimal dans l'identifiant greader
 * (`tag:google.com,2005:reader/item/00065a872a755226`). La borne d'un
 * « marquer en dessous » se calcule donc depuis l'article lui-même.
 *
 * Tout passe par des chaînes et `BigInt` : 16 chiffres décimaux dépassent la
 * précision d'un `number`, et une borne arrondie marquerait lus des articles
 * voisins de celui qu'on a cliqué.
 * Spec : docs/superpowers/specs/2026-09-24-mark-above-below-read-design.md
 */

const HEX = /^[0-9a-f]+$/i;
const DEC = /^[0-9]+$/;

/** L'identifiant d'entrée, en décimal, ou `null` si la forme est inconnue. */
export function entryIdUsec(articleId: string): string | null {
  const queue = articleId.includes('/') ? articleId.slice(articleId.lastIndexOf('/') + 1) : articleId;
  if (!queue) return null;
  if (DEC.test(queue) && queue.length >= 16) return queue;          // déjà décimal
  if (!HEX.test(queue)) return null;
  try {
    return BigInt(`0x${queue}`).toString();
  } catch {
    return null;
  }
}

/** Borne « strictement plus ancien que cet article », pour `ts`. */
export function exclusiveOlderThanEntryId(articleId: string): string | null {
  const usec = entryIdUsec(articleId);
  if (usec === null) return null;
  return (BigInt(usec) - 1n).toString();
}

/**
 * `a` a-t-il été inséré avant `b` ? Un identifiant illisible n'est jamais
 * « plus ancien » : dans le doute, on ne marque pas.
 */
export function isOlderEntry(a: string, b: string): boolean {
  const ua = entryIdUsec(a);
  const ub = entryIdUsec(b);
  if (ua === null || ub === null) return false;
  return BigInt(ua) < BigInt(ub);
}
```

- [ ] **Étape 4 : supprimer `relativeRead`**

```bash
git rm src/lib/relativeRead.ts src/lib/relativeRead.test.ts
```
Vérifier qu'il ne reste aucun appelant : `grep -rn "relativeRead\|exclusiveOlderThanUsec\|exclusiveNewerThanSec" src`
(le store en a encore : il est réécrit en Task 3 — si tu fais cette tâche
AVANT la Task 3, garde l'import cassé hors du commit en retirant d'abord la
Task 3 ; l'ordre d'exécution retenu est **Task 3 après Task 1 et 2**, donc
supprime les fichiers ici et laisse la Task 3 réparer l'appelant. Si le
typecheck échoue à cause de cet appelant, **ne commit pas** : enchaîne Task 2 et
Task 3 et committe les trois ensemble.)

- [ ] **Étape 5 : voir les tests passer**

Run: `npx vitest run src/lib/entryId.test.ts`
Expected: SUCCÈS, 7 tests.

- [ ] **Étape 6 : prouver que la borne mord**

Retirer le `- 1n` de `exclusiveOlderThanEntryId` : le test « borne juste en
dessous » doit ROUGIR. Le remettre. Rapporter les deux sorties.

- [ ] **Étape 7 : gates + garde-fou + commit** (message :
  `fix(read): bound a range on the entry id FreshRSS actually compares`)

---

### Task 2 : « au-dessus » sans le piège de `ot`

**Files:**
- Modify: `src/api/feeds.ts` (remplacer `itemIdsNewerThan`)
- Modify: `src/api/feeds.itemIds.test.ts`

**Interfaces:**
- Consomme : `isOlderEntry` (Task 1).
- Produit : `itemIdsNewerThanEntry(streamId: string, stopAtArticleId: string): Promise<string[]>`.

**Pourquoi :** `ot` pose un **OU** côté FreshRSS — `date >= ot` **ou**
`lastModified >= ot` — donc un vieux billet corrigé ce matin serait marqué lu.
Les identifiants étant rendus du plus récent au plus ancien, il suffit de
paginer et de s'arrêter à l'article cliqué. On passe aussi `xt` pour ignorer ce
qui est déjà lu : inutile de réécrire ce qui l'est déjà.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// à la place des tests de `itemIdsNewerThan` dans src/api/feeds.itemIds.test.ts
const ID = (hex: string) => `tag:google.com,2005:reader/item/${hex}`;

describe('itemIdsNewerThanEntry', () => {
  it('demande le flux, exclut les articles déjà lus, et ne pose aucune borne de date', async () => {
    get.mockResolvedValue({ data: { itemRefs: [], continuation: null } } as never);

    await itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'));

    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain('/stream/items/ids');
    expect(config.params.s).toBe('feed/21');
    expect(config.params.xt).toBe('user/-/state/com.google/read');
    expect(config.params).not.toHaveProperty('ot');
  });

  it('s’arrête à l’article cliqué et ne rend que ce qui est au-dessus', async () => {
    get.mockResolvedValue({
      data: {
        itemRefs: [{ id: '1788386439680600' }, { id: '1788386439680560' }, { id: '1788386439680550' }, { id: '1788386439680500' }],
        continuation: 'C1',
      },
    } as never);

    const ids = await itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'));

    expect(ids).toEqual(['1788386439680600', '1788386439680560']);
    expect(get).toHaveBeenCalledTimes(1); // inutile de demander la suite : elle est plus ancienne
  });

  it('suit la continuation tant que la page entière est plus récente', async () => {
    get
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '1788386439680600' }], continuation: 'C1' } } as never)
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '1788386439680550' }], continuation: null } } as never);

    const ids = await itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'));

    expect(ids).toEqual(['1788386439680600']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rend une liste vide quand l’identifiant de l’article est illisible', async () => {
    await expect(itemIdsNewerThanEntry('feed/21', 'inconnu')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
```

Garder les tests existants qui valent encore : celui de la page vide, celui de
la continuation qui ne progresse pas (la garde reste).

- [ ] **Étape 2 : voir les tests échouer** —
  Run: `npx vitest run src/api/feeds.itemIds.test.ts` → `itemIdsNewerThanEntry is not a function`.

- [ ] **Étape 3 : écrire la fonction** (remplace `itemIdsNewerThan`)

```ts
/**
 * Les identifiants des articles NON LUS insérés après celui qu'on a cliqué.
 *
 * Pas de `ot` : FreshRSS l'interprète comme « publié après OU modifié après »,
 * donc un vieux billet corrigé ce matin s'y glisserait. Les identifiants étant
 * rendus du plus récent au plus ancien, on s'arrête dès qu'on atteint l'article
 * cliqué — ce qui évite aussi de balayer tout le flux.
 */
export async function itemIdsNewerThanEntry(streamId: string, stopAtArticleId: string): Promise<string[]> {
  const stop = entryIdUsec(stopAtArticleId);
  if (stop === null) return [];
  const ids: string[] = [];
  const vues = new Set<string>();
  let continuation: string | null = null;
  for (;;) {
    const params: Record<string, string | number> = {
      output: 'json', n: 1000, s: streamId, xt: 'user/-/state/com.google/read',
    };
    if (continuation) params.c = continuation;
    const { data } = await client.get<{ itemRefs?: { id: string }[]; continuation?: string | null }>(
      `${BASE}/stream/items/ids`,
      { params },
    );
    for (const ref of data.itemRefs || []) {
      if (!isOlderEntry(stop, ref.id)) return ids; // atteint l'article cliqué, ou plus ancien
      ids.push(ref.id);
    }
    const suivante = data.continuation || null;
    if (suivante && vues.has(suivante)) return ids;
    if (suivante) vues.add(suivante);
    continuation = suivante;
    if (!continuation) return ids;
  }
}
```

- [ ] **Étape 4 : voir les tests passer** — Run: `npx vitest run src/api/feeds.itemIds.test.ts`.

- [ ] **Étape 5 : prouver que l'arrêt mord** — remplacer `return ids;` de la
  condition d'arrêt par `continue;` : le test « s'arrête à l'article cliqué »
  doit ROUGIR. Rapporter les deux sorties.

- [ ] **Étape 6 : gates + garde-fou + commit** (message :
  `fix(api): walk ids down to the clicked article instead of trusting ot`)

---

### Task 3 : l'action du store, corrigée

**Files:**
- Modify: `src/stores/feedStore.ts`
- Modify: `src/stores/feedStore.markRange.test.ts`
- Modify: `src/locales/*.json` (message d'échec)

**Interfaces:**
- Consomme : `exclusiveOlderThanEntryId`, `isOlderEntry` (Task 1),
  `itemIdsNewerThanEntry` (Task 2), `canMarkAllRead` (`src/lib/markAllRead.ts`),
  `resolveSearchStreamId`, `writeFailureNotice` (`src/lib/writeFailureNotice.ts`),
  `isNetworkFailure`.
- Produit : `markReadRelative(article, direction)` corrigée.

Six corrections, toutes issues de la revue finale :

1. **Périmètre (C1)** — le flux vient de `resolveSearchStreamId(selectedFeed, filter)`,
   et l'action **rend la main sans rien faire** si `!canMarkAllRead(filter)`.
2. **Borne (C2)** — `exclusiveOlderThanEntryId(article.id)` pour le serveur ;
   le prédicat local compare des identifiants d'entrée (`isOlderEntry`), plus
   jamais `published`. Si la borne est `null`, l'action ne part pas.
3. **Compteur d'écritures (I2)** — `readWritesInFlight++` avant, `--` dans un
   `finally`, comme `toggleRead`. Sans lui, un relevé périodique lancé pendant
   l'action rend des compteurs périmés et **fabrique une fausse pastille**.
4. **Retour en arrière (I1)** — ne jamais restaurer un instantané : recalculer
   sur la liste **telle qu'elle est** au moment de l'échec (`map` qui remet
   `read: false` sur les seuls articles que l'action avait basculés et qui n'ont
   pas été acceptés), pour ne pas défaire un ✓ posé entre-temps ni jeter une
   page arrivée depuis.
5. **Échec partiel (I5)** — les lots déjà acceptés **restent** lus ; seuls les
   lots non envoyés ou refusés reviennent.
6. **Message (I3)** — passer par `writeFailureNotice({ networkFailure, online })` :
   un refus ne s'annonce que si le serveur a répondu ; le vrai hors-ligne reste
   muet (le bandeau global le dit déjà).

Tests à écrire, en plus de ceux qui existent :
- « ne fait rien depuis Favoris ni depuis À lire plus tard » (un test par filtre,
  `markAllAsRead` et `itemIdsNewerThanEntry` jamais appelés) ;
- « borne le serveur sur l'identifiant d'entrée, pas sur la date de publication »
  (assertion sur la valeur exacte envoyée) ;
- « un ✓ posé pendant le vol survit au retour en arrière » ;
- « les lots acceptés restent lus quand le suivant échoue » ;
- « hors ligne, aucun toast n'accuse le serveur » ;
- « le relevé de compteurs est bien demandé après coup » (celui-ci manquait : la
  revue a retiré `syncCounts()` sans faire rougir un seul test).

- [ ] **Étape 1 : écrire les tests qui échouent**
- [ ] **Étape 2 : voir chaque test rouge, et rapporter la sortie**
- [ ] **Étape 3 : écrire le code**
- [ ] **Étape 4 : voir les tests passer**
- [ ] **Étape 5 : prouver la morsure de trois gardes** — retirer `canMarkAllRead`,
      puis `readWritesInFlight++`, puis le calcul de borne par identifiant : un
      test précis doit rougir à chaque fois. Rapporter les sorties.
- [ ] **Étape 6 : gates + garde-fou + commit** (message :
  `fix(read): scope, bound and unwind a range the way the rest of the app does`)

---

### Task 4 : le menu, la confirmation, et les documents

**Files:**
- Modify: `src/lib/articleMenu.ts`, `src/lib/articleMenu.test.ts`
- Modify: `src/components/ArticleList/ArticleContextMenu.tsx` et son test
- Modify: `src/components/ArticleList/ArticleList.tsx`
- Modify: `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`,
  `docs/superpowers/specs/2026-09-24-mark-above-below-read-design.md`

1. **Masquage (décision 1)** — `articleMenuItems(article, isReadLater, canMarkRange)`
   n'ajoute les deux entrées que si `canMarkRange` est vrai ; `ArticleList` passe
   `canMarkAllRead(filter)`. Tests : présentes en « Tous »/« Non lus », absentes
   en Favoris et À lire plus tard.
2. **Confirmation (décision 2)** — le menu réutilise `markAllReadAction(confirmMarkAllRead, enCours)` :
   au premier choix, l'entrée devient `articleList.confirm` (« Confirmer ? », clé
   déjà traduite dans les dix locales) et **le menu reste ouvert** ; le second
   choix agit et ferme. Quitter le menu annule. Tests : avec le réglage actif,
   un seul choix n'appelle rien ; deux choix appellent une fois.
3. **Documents** — `docs/FEATURES.md` : la portée (absente en Favoris / À lire
   plus tard), la borne (identifiant d'entrée, pas date de publication, avec le
   pourquoi), la confirmation, le comportement en cas d'échec partiel.
   `docs/RELEASE-NEXT.md` : corriger « sans confirmation, comme Tout lu » — c'est
   faux, `confirmMarkAllRead` vaut `true` par défaut. La **spec** est corrigée de
   la même main : ses sections « bornes » et « pas de confirmation » décrivent un
   monde qui n'existe pas, et un document faux est pire qu'un document absent.

- [ ] **Étape 1 : écrire les tests qui échouent**
- [ ] **Étape 2 : voir chaque test rouge**
- [ ] **Étape 3 : écrire le code**
- [ ] **Étape 4 : voir les tests passer, et la parité des dix locales**
- [ ] **Étape 5 : gates + garde-fou + commit** (message :
  `feat(menu): hide the range actions where they make no sense, and confirm them`)

---

## Reste au backlog, assumé

- Les traductions des huit locales non imposées, non relues par des locuteurs
  natifs.
- Aucun retour visuel pendant un « au-dessus » long (pagination + lots) ni
  verrou contre un second clic.
- Les articles publiés dans la même seconde ne sont plus un problème : la borne
  est désormais un identifiant, unique par article.
