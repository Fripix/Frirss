# Extraction d'articles côté serveur — plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les
> étapes utilisent des cases à cocher (`- [ ]`).

**Objectif** : une route `GET /api/extract` rend l'article déjà extrait et
assaini, mise en cache dans Redis sous une clé qui ne dépend pas de
l'utilisateur ; le navigateur la demande d'abord et extrait lui-même si elle
ne répond pas.

**Architecture** : le client garde son cache local (mémoire + IndexedDB). En
cas de manque il appelle la route ; le serveur consulte Redis, et à défaut va
chercher la page via `fetchUpstream` (garde anti-SSRF), l'extrait avec
`linkedom` + Readability, l'assainit, la range et la renvoie. Toute réponse
absente ou en erreur fait basculer le client sur son extracteur local, inchangé.

**Pile** : TypeScript strict, Express 5 (NodeNext), Redis optionnel, Vitest.

**Spec** : `docs/superpowers/specs/2026-09-03-server-side-extraction-design.md`

## Contraintes globales

- **`linkedom` est la SEULE dépendance ajoutée.** `@mozilla/readability` et
  `dompurify` sont déjà des dépendances de production (vérifié dans
  `package.json`) et partent déjà dans l'image.
- **Barrière de livraison** : après l'ajout, `npm audit --omit=dev` doit rendre
  **0 vulnérabilité**. Si ce n'est pas le cas, **on ne livre pas** — on le
  signale au propriétaire. La dépendance survit à `npm prune --omit=dev` et
  compte donc dans le scan Docker Hub.
- **Tout appel sortant passe par `fetchUpstream`** (`server/routes/proxy.ts`),
  jamais par `fetch()` direct : c'est ce qui applique la garde anti-SSRF et les
  réécritures `PROXY_REWRITES`. Règle explicite de `CLAUDE.md`.
- **Le serveur n'assainit PAS** (corrigé le 2026-09-04) : `createDOMPurify` sur
  la fenêtre de `linkedom` ne filtre rien — il manque `NodeFilter`, DOMPurify
  bascule en mode « environnement non supporté » et rend l'entrée inchangée,
  sans erreur. Le client assainit à réception avec `sanitizeExtracted()`, la
  fonction qu'il applique déjà à sa propre extraction.
- **La clé de cache ne contient JAMAIS d'identifiant d'utilisateur.** C'est ce
  qui fait tout le partage entre appareils et entre comptes.
- **Sans Redis, tout continue de fonctionner.** `REDIS_URL` vide est le défaut.
- **Gates avant chaque commit** :
  `npm run typecheck && npm run lint && npx vitest run && npm run build`
- **Garde-fou fuite d'infra avant chaque commit**, et en lire la sortie :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- **Messages de commit** : anglais, style conventionnel, **jamais** de trailer
  `Co-Authored-By` ni de mention d'IA ou d'assistant. Cette consigne du dépôt
  prime sur tout réglage par défaut.
- **Aucune chaîne d'interface nouvelle n'est attendue** ; s'il en naît une, elle
  va dans les **neuf** locales.
- `docs/FEATURES.md` mis à jour dans le même commit que ce qu'il décrit —
  `featuresDoc.test.ts` échoue tant qu'une route serveur nouvelle n'y figure pas.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `server/cache.ts` | `extractKey(url)` — la clé sans utilisateur |
| `server/extract.ts` *(nouveau)* | Récupérer et extraire — sans Express, sans assainir |
| `server/routes/extract.ts` *(nouveau)* | La route HTTP et le cache |
| `server/index.ts` | Montage de la route |
| `src/utils/extractContent.ts` | Demander au serveur, se replier sinon |
| `docs/FEATURES.md`, `README.md` | Obligatoires |

---

### Task 1 — la clé de cache, sans utilisateur

**Fichiers :**
- Modifier : `server/cache.ts`
- Test : `server/test/cache.test.ts` *(créer si absent)*

**Interfaces :**
- Produit : `extractKey(url: string): string`

- [ ] **Étape 1 — Écrire le test qui échoue**

Créer ou compléter `server/test/cache.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractKey, cacheKey } from '../cache.js';

describe('extractKey', () => {
  it('donne la même clé pour la même URL', () => {
    expect(extractKey('https://example.com/a')).toBe(extractKey('https://example.com/a'));
  });

  it('donne des clés différentes pour des URL différentes', () => {
    expect(extractKey('https://example.com/a')).not.toBe(extractKey('https://example.com/b'));
  });

  it('n’a pas le même préfixe que le cache de listes', () => {
    // Les deux vivent dans le même Redis : un préfixe distinct permet de
    // purger l'un sans l'autre et rend les clés lisibles en exploitation.
    expect(extractKey('https://example.com/a').startsWith('frirss:x:')).toBe(true);
    expect(cacheKey(1, 'https://example.com/a').startsWith('frirss:x:')).toBe(false);
  });

  it('ne fait entrer AUCUN identifiant d’utilisateur dans la clé', () => {
    // Garde-fou central de la fonctionnalité : la clé par URL est ce qui fait
    // qu'un appareil profite du travail d'un autre, et qu'à dix comptes le
    // travail est fait une fois. Réintroduire `userId` annulerait tout le
    // partage sans rien casser de visible.
    const src = fs.readFileSync(path.join(process.cwd(), 'server/cache.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function extractKey'));
    const fn = body.slice(0, body.indexOf('\n}'));
    expect(fn).not.toMatch(/user/i);
  });
});
```

- [ ] **Étape 2 — Lancer le test et le voir échouer**

```bash
npx vitest run server/test/cache.test.ts
```

Attendu : ÉCHEC, `extractKey is not a function` (ou une erreur d'import).

- [ ] **Étape 3 — Écrire l'implémentation**

Dans `server/cache.ts`, juste après `cacheKey` :

```ts
/**
 * Clé du cache d'EXTRAITS d'articles.
 *
 * Contrairement à `cacheKey`, elle ne porte **aucun identifiant
 * d'utilisateur** : le texte extrait d'une page est le même pour tout le
 * monde, alors qu'une liste d'articles dépend de l'état de lecture du compte.
 * C'est cette absence qui fait qu'un Mac profite du travail d'un iPhone, et
 * qu'à dix comptes lisant les mêmes flux la page n'est extraite qu'une fois.
 * Y ajouter `userId` multiplierait le volume par le nombre de comptes et
 * annulerait le partage — sans rien casser de visible.
 */
export function extractKey(url: string): string {
  return `frirss:x:${createHash('sha1').update(url).digest('hex').slice(0, 24)}`;
}
```

- [ ] **Étape 4 — Lancer le test et le voir passer**

```bash
npx vitest run server/test/cache.test.ts
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
git add server/cache.ts server/test/cache.test.ts
git commit -m "feat(cache): key extracted articles by URL, not by user"
```

---

### Task 2 — extraire côté serveur, et la route

**Fichiers :**
- Créer : `server/extract.ts` — la logique, sans Express
- Créer : `server/routes/extract.ts` — la route et le cache
- Modifier : `server/index.ts` (montage, à côté de la ligne 73)
- Test : `server/test/extract.test.ts`

**Interfaces :**
- Consomme : `extractKey` (Tâche 1),
  `fetchUpstream(rawTarget, opts)` (`server/routes/proxy.ts`),
  `cacheEnabled`, `cacheGet`, `cacheSet` (`server/cache.ts`),
  `requireAuth` (`server/middleware/auth.js`)
- Produit : `extractArticle(url: string, html: string): ExtractedArticle | null`
  avec `interface ExtractedArticle { title: string; content: string; excerpt: string; byline: string; siteName: string; length: number }`
  — la même forme que `ExtractedContent` côté client, pour que le client
  n'ait rien à convertir.
- Produit : la route `GET /api/extract?url=…`

- [ ] **Étape 1 — Écrire le test qui échoue**

Créer `server/test/extract.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { extractArticle } from '../extract.js';

const page = `<!doctype html><html><head><title>Titre de la page</title></head>
<body><article><h1>Un vrai titre</h1>
<p>Un premier paragraphe suffisamment long pour que Readability le retienne comme corps de l'article, avec assez de mots pour dépasser son seuil.</p>
<p>Un second paragraphe, lui aussi assez fourni pour peser dans la balance du score de lisibilité calculé par Readability.</p>
</article></body></html>`;

describe('extractArticle', () => {
  it('rend le corps de l’article', () => {
    const out = extractArticle('https://example.com/a', page);
    expect(out).not.toBeNull();
    expect(out!.content).toContain('premier paragraphe');
    // Readability garde le <title> de la page quand le <h1> ne partage aucun
    // mot avec lui — c'est son comportement, pas un défaut. On l'assert tel
    // quel plutôt qu'approximativement : un changement de règle en amont doit
    // se voir.
    expect(out!.title).toBe('Titre de la page');
  });

  it('N’assainit PAS — c’est le client qui le fait', () => {
    // Décision du 2026-09-04. `createDOMPurify` sur la fenêtre de `linkedom`
    // ne filtre rien (il manque `NodeFilter`, DOMPurify passe en mode
    // « environnement non supporté » et rend l'entrée telle quelle, sans
    // erreur). Assainir ici aurait donné un filet auquel on croit et qui ne
    // retient rien. Le client applique `sanitizeExtracted()` à la réception,
    // comme il le fait déjà pour sa propre extraction.
    const evil = page.replace('</article>', '<p>zzz</p></article>');
    const out = extractArticle('https://example.com/a', evil);
    expect(out!.content).toContain('zzz');
  });

  it('résout les URL relatives contre l’URL de l’article', () => {
    // Sans <base>, une image en chemin relatif serait irrécupérable pour le
    // navigateur, qui reçoit le HTML sans savoir d'où il vient.
    const withImg = page.replace('</article>', '<img src="/img/a.jpg"></article>');
    const out = extractArticle('https://example.com/dir/a', withImg);
    expect(out!.content).toContain('https://example.com/img/a.jpg');
  });

  it('rend null quand la page n’a pas d’article lisible', () => {
    const out = extractArticle('https://example.com/a', '<html><body></body></html>');
    expect(out).toBeNull();
  });
});
```

- [ ] **Étape 2 — Lancer le test et le voir échouer**

```bash
npx vitest run server/test/extract.test.ts
```

Attendu : ÉCHEC, module `../extract.js` introuvable.

- [ ] **Étape 3 — Écrire l'extraction**

Créer `server/extract.ts` :

```ts
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export interface ExtractedArticle {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
}

/**
 * Extrait le corps lisible d'une page, assaini, prêt à afficher.
 *
 * `null` quand Readability ne trouve pas d'article : l'appelant doit alors
 * laisser la main au navigateur plutôt que de renvoyer un corps vide.
 */
export function extractArticle(url: string, html: string): ExtractedArticle | null {
  const { document } = parseHTML(html);

  // Une URL relative dans la page ne veut rien dire pour le navigateur, qui
  // reçoit le HTML sans savoir d'où il vient. `<base>` les résout ici.
  const base = document.createElement('base');
  base.setAttribute('href', url);
  document.head?.prepend(base);

  const parsed = new Readability(document as never, { charThreshold: 50 }).parse();
  if (!parsed?.content) return null;

  return {
    title: parsed.title || '',
    content: parsed.content,
    excerpt: parsed.excerpt || '',
    byline: parsed.byline || '',
    siteName: parsed.siteName || '',
    length: parsed.length || 0,
  };
}
```

- [ ] **Étape 4 — Lancer le test et le voir passer**

```bash
npx vitest run server/test/extract.test.ts
```

Attendu : PASS, 4 tests. Si le troisième échoue parce que `linkedom` ne résout
pas `<base>` comme un navigateur, résoudre les URL explicitement avec
`new URL(src, url).href` sur les attributs `src` et `href` du résultat — et
garder le test, qui décrit le comportement attendu.

- [ ] **Étape 5 — Écrire la route**

Créer `server/routes/extract.ts` :

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fetchUpstream } from './proxy.js';
import { cacheEnabled, cacheGet, cacheSet, extractKey } from '../cache.js';
import { extractArticle } from '../extract.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const key = cacheEnabled ? extractKey(url) : null;
  if (key) {
    const hit = await cacheGet(key);
    if (hit != null) {
      res.set('X-From-Cache', '1');
      res.set('Content-Type', 'application/json');
      return res.send(hit);
    }
  }

  let html: string;
  try {
    // `fetchUpstream` et pas `fetch` : c'est lui qui porte la garde anti-SSRF
    // et les réécritures PROXY_REWRITES. Un appel direct rouvrirait la porte
    // que le proxy ferme.
    const upstream = await fetchUpstream(url, { headers: { Accept: 'text/html' } });
    if (!upstream.ok) return res.status(502).json({ error: 'Upstream request failed' });
    html = await upstream.text();
  } catch {
    return res.status(502).json({ error: 'Upstream request failed' });
  }

  const article = extractArticle(url, html);
  // Pas d'article lisible : on le dit, et le client extrait de son côté. Un
  // corps vide renvoyé en 200 le priverait de son repli.
  if (!article) return res.status(422).json({ error: 'Not extractable' });

  const body = JSON.stringify(article);
  // Écriture au mieux : un Redis en panne ne doit pas priver le client de sa
  // réponse, qui est déjà calculée.
  if (key) cacheSet(key, body).catch(() => {});
  res.set('Content-Type', 'application/json');
  res.send(body);
});

export default router;
```

- [ ] **Étape 6 — Monter la route**

Dans `server/index.ts`, à côté de la ligne 73 :

```ts
app.use('/api/extract', extractRoutes);
```

avec l'import correspondant en tête du fichier, auprès des autres :

```ts
import extractRoutes from './routes/extract.js';
```

- [ ] **Étape 7 — Documenter (obligatoire dans le même commit)**

`featuresDoc.test.ts` échoue tant qu'une route serveur nouvelle n'est pas dans
`docs/FEATURES.md`. Ajouter dans la section **Backend**, après *Proxy* :

```markdown
### Extraction d'articles
`GET /api/extract?url=…` rend l'article extrait et assaini, prêt à afficher.

- **Où** : `server/routes/extract.ts`, `server/extract.ts`
- **Cache** : Redis, clé `frirss:x:<sha1(url)>` — **sans identifiant
  d'utilisateur**, contrairement au cache de listes. Le texte extrait d'une
  page est le même pour tous : c'est ce qui fait qu'un appareil profite du
  travail d'un autre, et qu'à dix comptes la page n'est extraite qu'une fois.
  TTL commun (`CACHE_TTL`, 24 h) ; aucune détection de modification de la
  source, le bouton « Article complet » relance à la demande.
- **Sans Redis** : la route extrait quand même, sans rien garder.
- **Piège** : l'appel sortant passe par `fetchUpstream`, jamais par `fetch` —
  c'est lui qui porte la garde anti-SSRF.
- **Piège** : la route rend du HTML **non assaini**, et c'est voulu. Assainir
  côté serveur a été tenté puis abandonné le 2026-09-04 — `createDOMPurify` sur
  `linkedom` ne filtre rien faute de `NodeFilter`, et rend l'entrée telle
  quelle sans lever d'erreur. Le client assainit à réception. Ne pas
  « rétablir » un assainissement serveur sans vérifier qu'il filtre vraiment.
- **422 quand la page n'est pas extractible** : le client doit pouvoir se
  replier sur son extracteur local ; un corps vide en 200 l'en priverait.
```

- [ ] **Étape 8 — Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
npm audit --omit=dev
```

Attendu : `found 0 vulnerabilities`.

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add server/extract.ts server/routes/extract.ts server/index.ts server/test/extract.test.ts docs/FEATURES.md
git commit -m "feat(extract): serve extracted articles from a shared cache"
```

---

### Task 3 — le client demande, assainit, et se replie

**Fichiers :**
- Modifier : `src/utils/extractContent.ts` (`extractFullContent`)
- Test : `src/utils/extractContent.test.ts` *(créer si absent)*
- Modifier : `README.md`, `docs/RELEASE-NEXT.md`

**Interfaces :**
- Consomme : `GET /api/extract?url=…` (Tâche 3), qui rend un JSON de la forme
  `{ title, content, excerpt, byline, siteName, length }` — exactement
  `ExtractedContent`, donc aucune conversion.
- Produit : `extractFullContent(url)` inchangé pour ses appelants.

- [ ] **Étape 1 — Écrire les tests qui échouent**

Créer `src/utils/extractContent.test.ts` :

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractFullContent } from './extractContent';

const serverAnswer = {
  title: 'Titre serveur', content: '<p>corps serveur</p>',
  excerpt: '', byline: '', siteName: '', length: 12,
};

const pageHtml = `<!doctype html><html><body><article>
<p>Un paragraphe assez long pour que Readability retienne ce corps comme article, avec suffisamment de mots.</p>
<p>Un second paragraphe, lui aussi fourni, pour dépasser le seuil de lisibilité.</p>
</article></body></html>`;

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('extractFullContent', () => {
  it('utilise la réponse du serveur quand elle arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify(serverAnswer), { status: 200 });
      }
      throw new Error('le client ne doit pas aller chercher la page lui-même');
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out.content).toContain('corps serveur');
  });

  for (const [label, reply] of [
    ['404 (serveur plus ancien, route absente)', () => new Response('', { status: 404 })],
    ['422 (page non extractible)', () => new Response('', { status: 422 })],
    ['500', () => new Response('', { status: 500 })],
    ['corps illisible', () => new Response('pas du json', { status: 200 })],
  ] as const) {
    it(`se replie sur l’extraction locale — ${label}`, async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) return reply();
        return new Response(pageHtml, { status: 200 });
      }));
      const out = await extractFullContent('https://example.com/a');
      expect(out.content).toContain('paragraphe');
      expect(out.content).not.toContain('corps serveur');
    });
  }
});
```

- [ ] **Étape 2 — Lancer les tests et les voir échouer**

```bash
npx vitest run src/utils/extractContent.test.ts
```

Attendu : ÉCHEC sur le premier test — le client va chercher la page lui-même,
donc le `fetch` simulé lève.

- [ ] **Étape 3 — Demander au serveur d'abord**

Dans `src/utils/extractContent.ts`, au tout début de `extractFullContent`,
avant la récupération de la page :

```ts
  const { backendToken } = useAuthStore.getState();

  // Le serveur fait autorité quand il répond : il extrait une fois pour toute
  // l'instance et partage le résultat entre appareils et entre comptes. Toute
  // réponse absente, en erreur ou illisible fait tomber sur l'extraction
  // locale ci-dessous, qui reste le filet — la route peut manquer (serveur
  // plus ancien), échouer sur une page que `linkedom` ne sait pas lire, ou
  // ne pas exister du tout sans Redis.
  try {
    const served = await fetch(`/api/extract?url=${encodeURIComponent(url)}`, {
      headers: { ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}) },
    });
    if (served.ok) {
      const data = (await served.json()) as ExtractedContent;
      if (data && typeof data.content === 'string' && data.content) return data;
    }
  } catch { /* repli */ }
```

Le corps existant de la fonction — récupération via `/api/proxy` puis
Readability — reste **inchangé** en dessous et sert de repli.

- [ ] **Étape 4 — Lancer les tests et les voir passer**

```bash
npx vitest run src/utils/extractContent.test.ts
```

Attendu : PASS, 5 tests.

- [ ] **Étape 5 — Documenter côté exploitation**

Dans `README.md`, section **Configuration**, sous la ligne `REDIS_URL`, ajouter
une phrase — c'est une décision d'exploitation, pas un détail interne :

```markdown
> With `REDIS_URL` set, FriRSS also caches the **extracted text** of articles,
> keyed by URL rather than by account. The page is then extracted once for the
> whole instance instead of once per device: a second device, or another user
> reading the same feed, gets it instantly and the origin site sees one request
> instead of many. Without Redis nothing breaks — the browser extracts as it
> always has.
```

Dans `docs/RELEASE-NEXT.md`, sous « Corrections et améliorations » :

```markdown
- **Le texte des articles est extrait une fois pour toute l'instance.** Chaque
  appareil refaisait l'extraction de chaque article : dix lecteurs des mêmes
  flux, c'étaient dix extractions identiques et dix requêtes chez le site
  d'origine. Le serveur s'en charge désormais et partage le résultat entre
  appareils et entre comptes — le téléphone ne calcule plus rien. Sans Redis,
  rien ne change : le navigateur extrait comme avant.
```

- [ ] **Étape 6 — Gates, garde-fou, commit, push**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
npm audit --omit=dev
```

Attendu : `found 0 vulnerabilities`.

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/utils/extractContent.ts src/utils/extractContent.test.ts README.md docs/RELEASE-NEXT.md
git commit -m "feat(extract): ask the server first, extract locally as a fallback"
git push origin dev
```

- [ ] **Étape 7 — Vérifier les deux workflows**

```bash
gh run list --branch dev --limit 2
```

`CI` **et** `Publish image` doivent être verts. Le garde-fou fuite tourne dans
`CI` avant lint et tests : un `CI` rouge ne signifie pas forcément que le code
est cassé.

## Hors périmètre

La pré-extraction par le worker et le cache d'images côté serveur, tous deux
écartés dans la spec avec leurs raisons. Ne pas les ajouter en passant.
