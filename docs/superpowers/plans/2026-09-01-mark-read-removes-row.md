# Le ✓ retire la ligne sous « Non lus » — plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les
> étapes utilisent des cases à cocher (`- [ ]`).

**Objectif** : cliquer le ✓ d'un article retire sa ligne de la liste quand la
vue est filtrée sur les non-lus, et le ✓ devient disponible en affichage
compact.

**Architecture** : une fonction pure décide du retrait (`shouldLeaveList`) ;
`toggleRead` l'interroge **après** la confirmation du serveur et retire la ligne
le cas échéant. Le marquage au défilement, seul appelant implicite de
`toggleRead`, se signale par une option et ne retire jamais rien.

**Pile** : TypeScript strict, React 19, Zustand 5, Vitest.

**Spec** : `docs/superpowers/specs/2026-09-01-mark-read-removes-row-design.md`

## Contraintes globales

- **Le retrait suit la confirmation du serveur, jamais l'écriture optimiste.**
  Une ligne retirée avant confirmation ne peut pas être remise par le rollback,
  qui ne fait qu'un `.map()`.
- **Condition de retrait** : transition non lu → lu **et**
  `feedStore.filter === 'unread'`. Se brancher sur `feedStore.filter`, jamais
  sur `uiStore.unreadOnlyByFeed` dont il est dérivé.
- **Un écrivain implicite ne retire jamais** : le marquage au défilement passe
  `{ implicit: true }`.
- **`docs/FEATURES.md` est mis à jour dans le même commit** que le changement
  qu'il décrit. Non négociable dans ce dépôt.
- **Gates avant chaque commit** :
  `npm run typecheck && npm run lint && npx vitest run && npm run build`
- **Garde-fou fuite d'infra avant chaque commit**, et en lire la sortie :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- **Messages de commit** : anglais, style conventionnel, **jamais** de trailer
  `Co-Authored-By` ni de mention d'assistant.
- **Aucune chaîne d'interface nouvelle n'est attendue** : `articleRow.markRead`
  et `articleRow.markUnread` existent déjà dans les 9 locales (vérifié). Si
  l'implémentation en fait naître une, elle va dans les **neuf**.
- Travailler sur `dev`. Pousser après la dernière tâche, puis vérifier **les
  deux** workflows (`CI` et `Publish image`).

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/lib/removeOnRead.ts` *(nouveau)* | `shouldLeaveList()` — la décision, sans dépendance au store |
| `src/lib/removeOnRead.test.ts` *(nouveau)* | Sa table de vérité |
| `src/stores/feedStore.ts` | `toggleRead` applique la décision après confirmation |
| `src/stores/feedStore.test.ts` | Comportement du store + correction d'un commentaire devenu faux |
| `src/components/ArticleList/ArticleList.tsx` | `MarkReadButton` en compact ; le site d'appel du défilement se déclare implicite |
| `docs/FEATURES.md` | Inventaire, même commit |
| `docs/RELEASE-NEXT.md` | Journal du cycle |

---

### Tâche 1 : la décision de retrait, en logique pure

**Fichiers :**
- Créer : `src/lib/removeOnRead.ts`
- Test : `src/lib/removeOnRead.test.ts`

**Interfaces :**
- Consomme : `Filter` depuis `src/types/index.ts`
  (`'all' | 'unread' | 'starred' | 'readlater'`)
- Produit : `shouldLeaveList(opts: { becameRead: boolean; filter: Filter; implicit: boolean }): boolean`

- [ ] **Étape 1 — Écrire le test qui échoue**

Créer `src/lib/removeOnRead.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { shouldLeaveList } from './removeOnRead';

const base = { becameRead: true, filter: 'unread' as const, implicit: false };

describe('shouldLeaveList', () => {
  it('retire la ligne quand un geste explicite marque lu sous le filtre non-lus', () => {
    expect(shouldLeaveList(base)).toBe(true);
  });

  it('ne retire rien quand on marque NON lu', () => {
    // `toggleRead` est une bascule : elle sert aussi à remettre en non-lu,
    // et cette transition n'a aucune raison de faire disparaître la ligne.
    expect(shouldLeaveList({ ...base, becameRead: false })).toBe(false);
  });

  it('ne retire rien hors du filtre non-lus', () => {
    // La vue Favoris et la vue À lire plus tard montrent délibérément des
    // articles lus : y faire disparaître une ligne serait incompréhensible.
    for (const filter of ['all', 'starred', 'readlater'] as const) {
      expect(shouldLeaveList({ ...base, filter }), filter).toBe(false);
    }
  });

  it('ne retire rien pour une écriture implicite', () => {
    // Le marquage au défilement décide à la place de l'utilisateur. Retirer
    // ces lignes ferait s'effondrer la liste en continu pendant qu'il défile.
    expect(shouldLeaveList({ ...base, implicit: true })).toBe(false);
  });
});
```

- [ ] **Étape 2 — Lancer le test et le voir échouer**

```bash
npx vitest run src/lib/removeOnRead.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./removeOnRead"`.

- [ ] **Étape 3 — Écrire l'implémentation minimale**

Créer `src/lib/removeOnRead.ts` :

```ts
import type { Filter } from '../types';

/**
 * Une ligne doit-elle quitter la liste après avoir été marquée lue ?
 *
 * La règle porte sur le GESTE, pas sur l'état. Ouvrir un article le marque lu
 * (`selectArticle`), mais sa ligne doit rester : elle disparaîtrait pendant
 * qu'on le lit. Seule une mise à l'écart explicite — le ✓ d'une ligne, le
 * balayage vers la gauche — retire.
 *
 * `implicit` distingue le marquage au défilement, seul écrivain que
 * l'utilisateur ne commande pas.
 *
 * L'appelant ne doit invoquer cette fonction qu'APRÈS confirmation du serveur :
 * le rollback de `toggleRead` ne fait qu'un `.map()` et serait incapable de
 * remettre une ligne déjà retirée.
 */
export function shouldLeaveList(opts: {
  becameRead: boolean;
  filter: Filter;
  implicit: boolean;
}): boolean {
  if (!opts.becameRead) return false;
  if (opts.implicit) return false;
  return opts.filter === 'unread';
}
```

- [ ] **Étape 4 — Lancer le test et le voir passer**

```bash
npx vitest run src/lib/removeOnRead.test.ts
```

Attendu : PASS, 4 tests.

- [ ] **Étape 5 — Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

Sortie vide attendue.

```bash
git add src/lib/removeOnRead.ts src/lib/removeOnRead.test.ts
git commit -m "feat(list): decide when a row leaves the unread view"
```

---

### Tâche 2 : `toggleRead` applique le retrait

**Fichiers :**
- Modifier : `src/stores/feedStore.ts` (déclaration ~ligne 304, implémentation
  ~ligne 841, commentaire de `toggleStar` ~ligne 889)
- Modifier : `src/components/ArticleList/ArticleList.tsx` (~ligne 339, le site
  d'appel du marquage au défilement)
- Modifier : `src/stores/feedStore.test.ts` (nouveaux tests + commentaire
  devenu faux ~ligne 450)
- Modifier : `docs/FEATURES.md`

**Interfaces :**
- Consomme : `shouldLeaveList` (Tâche 1)
- Produit : `toggleRead(article: Article, opts?: { implicit?: boolean }): Promise<void>`
  — les appelants existants restent valides, l'option est facultative et vaut
  `false` par défaut.

- [ ] **Étape 1 — Écrire les tests qui échouent**

Ajouter à la fin de `src/stores/feedStore.test.ts` :

```ts
describe('feedStore.toggleRead — retrait de la ligne sous le filtre non-lus', () => {
  const row = (id: string): Article =>
    ({ id, read: false, starred: false, sourceId: 'feed/1', title: id } as Article);

  beforeEach(() => {
    vi.mocked(api.markAsRead).mockReset();
    vi.mocked(api.markAsRead).mockResolvedValue(undefined);
    vi.mocked(api.markAsUnread).mockReset();
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined);
    useFeedStore.setState({
      articles: [row('a0'), row('a1'), row('a2')],
      selectedArticle: null,
      filter: 'unread',
    });
  });

  it('retire la ligne une fois le serveur confirmé', async () => {
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a2']);
  });

  it('garde la ligne quand le serveur refuse', async () => {
    // Le rollback ne fait qu'un `.map()` : une ligne déjà retirée serait
    // irrécupérable, et l'article disparaîtrait de l'écran en restant non lu
    // côté FreshRSS. C'est le bug déjà payé sur `toggleStar`.
    vi.mocked(api.markAsRead).mockRejectedValueOnce({ response: { status: 403 } });
    await useFeedStore.getState().toggleRead(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(false);
  });

  it('garde la ligne hors ligne, l’action étant seulement mise en file', async () => {
    vi.mocked(api.markAsRead).mockRejectedValueOnce(new Error('Network Error'));
    await useFeedStore.getState().toggleRead(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(true);
  });

  it('ne retire rien hors du filtre non-lus', async () => {
    useFeedStore.setState({ filter: 'all' });
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
  });

  it('ne retire rien pour une écriture implicite (marquage au défilement)', async () => {
    await useFeedStore.getState().toggleRead(row('a1'), { implicit: true });
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(true);
  });

  it('ne retire PAS la ligne d’un article simplement ouvert', async () => {
    // Le garde-fou central de cette fonctionnalité. `selectArticle` marque lu
    // sans passer par `toggleRead` : si l'implémentation se branchait sur
    // l'état « devenu lu » plutôt que sur le geste, la ligne de l'article
    // qu'on vient d'ouvrir disparaîtrait pendant qu'on le lit. Ce test doit
    // échouer dans ce cas.
    useFeedStore.getState().selectArticle(row('a1'));
    await new Promise((r) => setTimeout(r, 0));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(true);
  });

  it('ne retire rien quand on remet un article en non-lu', async () => {
    useFeedStore.setState({ articles: [row('a0'), { ...row('a1'), read: true }, row('a2')] });
    await useFeedStore.getState().toggleRead({ ...row('a1'), read: true });
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
  });
});
```

- [ ] **Étape 2 — Lancer les tests et les voir échouer**

```bash
npx vitest run src/stores/feedStore.test.ts -t "retrait de la ligne"
```

Attendu : ÉCHEC. Le premier test échoue sur
`expected [ 'a0', 'a1', 'a2' ] to deeply equal [ 'a0', 'a2' ]` — la ligne n'est
pas encore retirée.

- [ ] **Étape 3 — Déclarer l'option dans le type du store**

Dans `src/stores/feedStore.ts`, remplacer la déclaration (~ligne 304) :

```ts
  toggleRead: (article: Article) => Promise<void>;
```

par :

```ts
  toggleRead: (article: Article, opts?: { implicit?: boolean }) => Promise<void>;
```

- [ ] **Étape 4 — Appliquer le retrait après confirmation**

Dans `src/stores/feedStore.ts`, remplacer la signature de l'implémentation
(~ligne 841) :

```ts
  toggleRead: async (article) => {
```

par :

```ts
  toggleRead: async (article, opts) => {
```

Puis, dans le même `toggleRead`, remplacer le bloc `try` (~lignes 856-861) :

```ts
    try {
      if (newRead) {
        await markAsRead(article.id);
      } else {
        await markAsUnread(article.id);
      }
    } catch (err) {
```

par :

```ts
    try {
      if (newRead) {
        await markAsRead(article.id);
      } else {
        await markAsUnread(article.id);
      }
      // Le retrait vient APRÈS la confirmation, jamais avant : le rollback
      // ci-dessous ne fait qu'un `.map()` et ne saurait pas remettre une ligne
      // déjà sortie de la liste.
      if (shouldLeaveList({
        becameRead: newRead,
        filter: get().filter,
        implicit: opts?.implicit ?? false,
      })) {
        set((state) => ({ articles: state.articles.filter((a) => a.id !== article.id) }));
        persistCurrentView(get);
      }
    } catch (err) {
```

Ajouter l'import en tête de `src/stores/feedStore.ts`, auprès des autres imports
de `../lib/` :

```ts
import { shouldLeaveList } from '../lib/removeOnRead';
```

- [ ] **Étape 5 — Déclarer le marquage au défilement comme implicite**

Dans `src/components/ArticleList/ArticleList.tsx` (~ligne 339), remplacer :

```ts
            if (fresh && !fresh.read) useFeedStore.getState().toggleRead(fresh);
```

par :

```ts
            // Implicite : c'est le défilement qui décide, pas l'utilisateur.
            // Sans ce drapeau, la liste s'effondrerait sous lui pendant qu'il
            // fait défiler.
            if (fresh && !fresh.read) useFeedStore.getState().toggleRead(fresh, { implicit: true });
```

- [ ] **Étape 6 — Lancer les tests et les voir passer**

```bash
npx vitest run src/stores/feedStore.test.ts
```

Attendu : PASS, 42 tests (35 existants + 7 nouveaux).

- [ ] **Étape 7 — Corriger les deux commentaires devenus faux**

Ils justifient le comportement de `toggleStar` **par** celui de `toggleRead`.
Ce changement rend la phrase fausse : la laisser serait pire que ne rien écrire.

Dans `src/stores/feedStore.ts` (~ligne 886), remplacer :

```ts
    // Retirer le favori depuis la vue Favoris NE SORT PAS l'article de la
    // liste. C'est l'alignement sur les quatre autres sites d'écriture :
    // marquer lu depuis la vue Non lus laisse la ligne, et `silentRefresh`
    // réinsère même l'article en cours de lecture pour qu'il ne s'évapore pas.
    // La vue se réconcilie au rechargement, jamais sous les yeux du lecteur.
```

par :

```ts
    // Retirer le favori depuis la vue Favoris NE SORT PAS l'article de la
    // liste ; la vue se réconcilie au rechargement.
    //
    // Depuis 2026-09-01, `toggleRead` retire la ligne sous le filtre non-lus
    // (issue #10) : l'alignement invoqué ici ne tient donc plus, et c'est
    // assumé. La règle n'est pas « tous les sites d'écriture se ressemblent »
    // mais « une mise à l'écart explicite retire, sous le filtre qu'elle
    // concerne ». Personne n'a demandé ce comportement pour les favoris, et
    // l'y étendre coûterait le même soin : retrait après confirmation
    // seulement, sans quoi le rollback ci-dessous — un simple `.map()` —
    // laisserait l'article hors de l'écran tout en le gardant favori.
```

Dans `src/stores/feedStore.test.ts` (~lignes 449-453), remplacer :

```ts
  // Retirer le favori ne SORT PLUS l'article de la liste. C'est ce que font
  // déjà `toggleRead` (marquer lu depuis la vue Non lus laisse la ligne) et
  // `toggleReadLater` ; la vue se réconcilie au rechargement. Deux vues sœurs
  // qui se comportaient différemment, sans qu'aucune décision ne l'ait jamais
  // établi — le retrait venait du commit initial.
```

par :

```ts
  // Retirer le favori ne SORT PLUS l'article de la liste ; la vue se
  // réconcilie au rechargement. Le retrait venait du commit initial, sans
  // qu'aucune décision ne l'ait jamais établi.
  //
  // `toggleRead` retire désormais la ligne sous le filtre non-lus (issue #10),
  // sur un geste explicite et après confirmation du serveur. Les deux vues
  // divergent donc à nouveau — cette fois par décision, pas par accident.
```

- [ ] **Étape 8 — Mettre `docs/FEATURES.md` à jour**

Dans la section décrivant la liste d'articles, ajouter :

```markdown
- **Le ✓ retire la ligne sous le filtre « Non lus »** (issue #10, 2026-09-01).
  La décision est prise par `shouldLeaveList()` (`src/lib/removeOnRead.ts`) et
  appliquée par `toggleRead` **après confirmation du serveur**.
  - **Le geste compte, pas l'état.** Ouvrir un article le marque lu
    (`selectArticle`) mais laisse sa ligne : elle disparaîtrait pendant qu'on
    le lit. Le marquage au défilement, seul écrivain implicite, passe
    `{ implicit: true }` et ne retire rien — sans quoi la liste s'effondrerait
    en continu sous le lecteur.
  - **Piège** : ne jamais retirer avant la réponse du serveur. Le rollback de
    `toggleRead` n'est qu'un `.map()` : il ne sait pas remettre une ligne
    partie. C'est le bug déjà payé sur `toggleStar`, où l'article disparaissait
    de l'écran en restant favori côté FreshRSS.
  - **Écarté** : réglage optionnel, bandeau « Annuler » (il ne rattrapait pas
    le cas invoqué), uniformisation des hauteurs de ligne. Détail et raisons
    dans `docs/superpowers/specs/2026-09-01-mark-read-removes-row-design.md`.
```

- [ ] **Étape 9 — Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

Sortie vide attendue.

```bash
git add src/stores/feedStore.ts src/stores/feedStore.test.ts src/components/ArticleList/ArticleList.tsx docs/FEATURES.md
git commit -m "feat(list): marking an article read removes its row from the unread view"
```

---

### Tâche 3 : le ✓ en affichage compact

**Fichiers :**
- Modifier : `src/components/ArticleList/ArticleList.tsx` (~ligne 1263, branche
  `viewMode === 'compact'` de `ArticleRow`)
- Modifier : `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`

**Interfaces :**
- Consomme : `MarkReadButton({ read: boolean, onClick: (e: ReactMouseEvent) => void })`
  depuis `./ArticleActions` — déjà importé en tête du fichier, et déjà utilisé
  par la branche non-compacte. `onToggleRead` est déjà dans les props de
  `ArticleRow` : rien à câbler en amont.

- [ ] **Étape 1 — Ajouter le bouton**

Dans `src/components/ArticleList/ArticleList.tsx`, dans la branche
`viewMode === 'compact'`, remplacer :

```tsx
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} article={article} />
        <StarButton starred={article.starred} onClick={onToggleStar} article={article} />
      </div>
```

par :

```tsx
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} article={article} />
        <StarButton starred={article.starred} onClick={onToggleStar} article={article} />
        <MarkReadButton read={article.read} onClick={onToggleRead} />
      </div>
```

Le ✓ reste en dernier, comme dans la ligne non-compacte.

- [ ] **Étape 2 — Vérifier dans le navigateur, pas seulement en test**

Démarrer l'aperçu (jamais via Bash) et vérifier à l'œil, en affichage compact :
le ✓ apparaît sur chaque ligne, il ne déborde pas à largeur réduite, et cliquer
dessus n'ouvre pas l'article — `onToggleRead` porte déjà `e.stopPropagation()`
au site d'appel (`ArticleList.tsx:111`).

Vérifier les **trois** facteurs de forme : bureau, tablette, téléphone. La règle
du dépôt impose les trois avant d'annoncer que c'est terminé.

Vérifier aussi le retrait de bout en bout : filtre « Non lus », clic sur le ✓,
la ligne disparaît ; puis en filtre « Tout lu », clic sur le ✓, la ligne reste.

- [ ] **Étape 3 — Mettre `docs/FEATURES.md` à jour**

Dans la description de l'affichage compact, ajouter :

```markdown
- **Les trois actions y sont désormais complètes** : à lire plus tard, favori,
  et ✓ (2026-09-01, demandé avec l'issue #10). Le ✓ y manquait alors qu'il
  existait dans la ligne normale et la vue grille. Les lignes compactes ayant
  toutes la même hauteur, le ✓ suivant se place exactement où était le
  précédent : on enchaîne les marquages sans bouger la souris.
```

- [ ] **Étape 4 — Renseigner `docs/RELEASE-NEXT.md`**

Sous « Corrections et améliorations » :

```markdown
- **Marquer un article lu le fait sortir de la liste « Non lus ».** Cliquer le ✓
  d'une ligne n'avait aucun effet visible sous le filtre dont c'était pourtant
  le sujet. La ligne disparaît maintenant, une fois le serveur confirmé — hors
  ligne ou sur un refus, elle reste. Ouvrir un article ne retire pas sa ligne,
  et le marquage au défilement non plus. (issue #10)
- **Le ✓ arrive dans l'affichage compact**, où il manquait alors qu'il existait
  dans les autres dispositions.
```

- [ ] **Étape 5 — Gates, garde-fou, commit, push**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

Sortie vide attendue.

```bash
git add src/components/ArticleList/ArticleList.tsx docs/FEATURES.md docs/RELEASE-NEXT.md
git commit -m "feat(list): offer the read toggle in the compact layout"
git push origin dev
```

- [ ] **Étape 6 — Vérifier les deux workflows**

```bash
gh run list --branch dev --limit 2
```

`CI` **et** `Publish image` doivent être verts. Le garde-fou fuite tourne dans
`CI` avant lint et tests : un `CI` rouge ne signifie pas forcément que le code
est cassé.
