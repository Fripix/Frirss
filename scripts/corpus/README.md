# Corpus de non-régression de l'extraction

**But :** l'extraction d'articles (`server/extract.ts`) ne doit **jamais perdre
de texte d'article**. Laisser une publicité est acceptable ; perdre une phrase ne
l'est pas. Les tests unitaires ne voient que les formes de page qu'on a pensé à
écrire : cet outil rejoue deux versions de l'extracteur sur des centaines de
vraies pages capturées et signale tout ce que la nouvelle version perd.

> **Règle : une perte non acceptée bloque le commit d'une règle d'extraction.**
> Toute modification de `server/extract.ts` (ou de ce qu'il importe) passe par
> `compare.mts` contre la version précédente avant d'être commitée. Une perte se
> corrige, ou se déclare dans `accepted.json` avec sa raison si le texte perdu
> est un parasite (bandeau, formulaire, publicité).

Le corpus vit **hors du dépôt** : les pages appartiennent à leurs éditeurs.

## Commandes

```sh
# Capturer (le corpus grandit à chaque passage)
npx tsx scripts/corpus/capture.mts --feeds feeds.txt --out <corpus> [--per-feed 8] [--max-age-days 30]

# Comparer deux versions de l'extracteur
npx tsx scripts/corpus/compare.mts --corpus <corpus> --base <ref|chemin> --head <ref|chemin> \
  [--accepted <corpus>/accepted.json] [--report rapport.json] [--only <motif>] [--jobs 4] [--timeout 15000]
```

Avant de commiter une règle : `--base HEAD --head server/extract.ts` (la copie de
travail contre le dernier commit). Pour mesurer un cycle : `--base vX.Y.Z --head dev`.

- `--base` / `--head` : une **ref git** (tag, branche, sha, `HEAD~1`) est extraite
  par `git archive <ref> server package.json` dans un dossier temporaire, avec le
  `node_modules` du dépôt ; un **chemin** vers un `extract.ts` (ou un dossier qui
  contient `server/extract.ts`) est pris tel quel.
- Chaque version tourne dans ses propres processus enfants (`--jobs` par
  version). Une page qui dépasse `--timeout` est comptée en **délai**, pas en perte.
- `--only` : ne compare que les pages dont l'URL ou le fichier contient le motif.

### Capture

Pour chaque flux : liens des articles (RSS `item > link`, Atom
`entry > link[rel=alternate]`, `guid` permalien en dernier recours), les
`--per-feed` plus récents qui ne sont pas encore dans l'index et pas plus vieux
que `--max-age-days`. Chaque page : User-Agent de navigateur, une seconde au moins
entre deux requêtes vers un même hôte, 2 Mo et 20 s au plus, redirections
suivies. Une page capturée n'est jamais recapturée ; un échec est journalisé et
retenté au passage suivant.

## Formats

**`feeds.txt`** — une URL de flux par ligne, `#` en tête de ligne = commentaire.

**`<corpus>/index.jsonl`** — une ligne JSON par tentative :

```json
{"file":"0123456789abcdef.html","url":"https://example.com/a","finalUrl":"https://example.com/a/","feed":"https://example.com/feed","capturedAt":"2026-11-07T08:00:00.000Z","status":200,"bytes":123456}
```

`file` = 16 premiers caractères du SHA-1 de `url`, dans `<corpus>/pages/`. Un
échec n'a pas de `file` ; son `status` est le code HTTP, ou `timeout`,
`too-large`, `not-html`, `error`. L'extraction reçoit `finalUrl`, sinon `url`.

**`<corpus>/accepted.json`** — retraits acceptés, un tableau :

```json
[{ "pattern": "Abonnez-vous à notre newsletter", "reason": "formulaire d'inscription", "scope": "example.com" }]
```

`pattern` est une sous-chaîne (insensible à la casse et à la ponctuation) ou une
expression `/…/drapeaux`. `scope` (facultatif) limite la règle à un hôte et à ses
sous-domaines. Une phrase perdue qui correspond est classée « acceptée » ; la
règle s'applique aussi au `src` d'une image perdue. `reason` est obligatoire.

## Ce qui est mesuré

Le texte visible de chaque extrait (balises retirées, entités décodées, blancs
normalisés) est découpé en **phrases** : ponctuation forte (`. ! ? … 。 ！ ？ ؟`)
et fins de bloc (`p`, `li`, `h1`–`h6`, `td`, `blockquote`, `figcaption`…). Une
phrase de la base d'au moins 25 caractères (8 pour une écriture sans espaces :
chinois, japonais, thaï) est **perdue** si sa forme normalisée (minuscules,
ponctuation et blancs réduits) n'apparaît plus dans le texte de la tête.

Les **fragments courts** (de 12 caractères jusqu'à ce seuil : une ligne de
liste, un intertitre court) sont suivis à part : au-delà de 60 caractères de
fragments perdus non acceptés, la page échoue. Sans ce compte, une garde qui
perdait les paliers d'une page de dons (« Every little bit helps »…) passait le
corpus. Un mot isolé (« Partager », « Lire aussi ») n'est pas un fragment.

Aussi relevés : `null` d'un seul côté, chute de longueur de plus de 20 %, images
dont le `src` de base a disparu (les `data:` exclus), titre changé, phrases
gagnées, doublons (une phrase plus fréquente en tête qu'en base).

L'outil ne voit que les pertes **relatives à la base** : un texte que la base
perdait déjà reste invisible.

## Codes de sortie

| Code | Sens |
|---|---|
| 0 | Aucune perte non acceptée, aucun `null` nouveau, aucune image perdue |
| 1 | Au moins une perte non acceptée, un `null` nouveau, une exception nouvelle ou une image perdue |
| 2 | L'outil lui-même a échoué (argument, ref introuvable, extracteur qui ne se charge pas) |

Logique pure testée dans `lib.test.ts` (`npx vitest run scripts/corpus`).
