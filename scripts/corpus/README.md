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

# Ajouter le contenu du flux aux pages déjà capturées (ne capture rien)
npx tsx scripts/corpus/capture.mts --feeds feeds.txt --out <corpus> --backfill [--from-xml <dossier|fichier.xml>]

# Comparer deux versions de l'extracteur
npx tsx scripts/corpus/compare.mts --corpus <corpus> --base <ref|chemin> --head <ref|chemin> \
  [--accepted <corpus>/accepted.json] [--report rapport.json] [--only <motif>] [--jobs 4] [--timeout 15000] \
  [--oracle-strict]
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

Avec chaque page, la capture enregistre le **contenu de son item dans le flux**
dans `<corpus>/feed/<même nom que la page>` : `content:encoded` ou `content`
Atom, sinon `description` / `summary` (le plus long des deux quand le flux
donne les deux). CDATA déballé, HTML échappé décodé, texte brut mis en HTML.
Un item sans contenu (flux qui ne donne que titre et lien : Hugging Face,
Node.js) ne laisse pas de fichier.

`--backfill` relit les flux de `feeds.txt` et remplit `feedFile` pour les pages
déjà capturées qui n'en ont pas, quand leur item est encore dans le flux ;
`--from-xml` ajoute des flux enregistrés plus tôt, pour les items qui en sont
sortis. Appariement par `url`, puis `finalUrl` : hôte sans `www.`, chemin sans
barre finale, requête sans `utm_*`, lien d'origine FeedBurner, liens
`alternate` et `guid` permalien. Le backfill n'écrit que `feed/` et le champ
`feedFile` : il copie l'index dans `index.jsonl.bak`, puis l'ajoute en dernier
champ de chaque ligne concernée, dans le style de la ligne ; toute autre ligne
reste à l'octet près.

## Formats

**`feeds.txt`** — une URL de flux par ligne, `#` en tête de ligne = commentaire.

**`<corpus>/index.jsonl`** — une ligne JSON par tentative :

```json
{"file":"0123456789abcdef.html","url":"https://example.com/a","finalUrl":"https://example.com/a/","feed":"https://example.com/feed","capturedAt":"2026-11-07T08:00:00.000Z","status":200,"bytes":123456}
```

`file` = 16 premiers caractères du SHA-1 de `url`, dans `<corpus>/pages/`.
`feedFile` (facultatif) = le contenu du flux de la page, dans `<corpus>/feed/`.
Un échec n'a pas de `file` ; son `status` est le code HTTP, ou `timeout`,
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

Tout cela ne voit que les pertes **relatives à la base** : un texte que la base
perdait déjà reste invisible. D'où la mesure suivante.

### Mesure absolue : l'oracle du flux

**Pourquoi.** Sur le blog de Docker, l'extraction rendait les cartes « articles
liés » à la place de l'article : 8 articles sur 10 perdus en entier (10 sur 10
en 1.8.0). La comparaison entre versions ne l'a jamais vu, puisque la base le
perdait déjà. Le flux, lui, dit ce que l'article contient.

**Quoi.** Pour chaque page qui a un `feedFile`, le texte du flux est découpé
comme un extrait (phrases et fragments, mêmes seuils), puis on écarte :

- les **fins de flux** : « The post X appeared first on Y » (et ses formes
  française, allemande, espagnole, italienne), « Read more », « Continue
  reading », « Lire la suite », « Next article: » / « Previous article: » ;
- les **retraits acceptés** (`accepted.json`, mêmes règles par hôte) ;
- ce qui est **absent du texte visible de la page** brute (en-tête et
  `noscript` exclus) : un extracteur ne peut pas rendre ce que la page n'a pas.
  Le paragraphe du flux réservé aux abonnés, une ligne tronquée sans « … ».

Reste l'oracle : chaque phrase (ou fragment) doit figurer dans le titre ou le
texte de l'extrait. Une phrase que le flux coupe par « … » ou « […] » se compare
comme un début de phrase. Les entités nommées que le décodage de base ignore
(`&rarr;`) sont décodées des deux côtés. Un flux **résumé** reste un oracle
valable : on mesure seulement ce qu'il contient.

**Rapport.** Le détail par page (régressions, puis les phrases manquantes de la
tête), puis :

```
oracle du flux (base) : N pages couvertes, M pages incomplètes, P phrases manquantes (fragments F)
oracle du flux (tête) : …
```

Une page **couverte** a au moins une phrase ou un fragment attendu ; elle est
**incomplète** s'il lui manque une phrase. `--report` porte le détail complet
(`pages[].oracle`, `totals.oracle`).

**Échec.** La tête manque une phrase du flux que la base rendait (régression).
Avec `--oracle-strict`, la tête manque une phrase du flux tout court. Les
fragments régressés sont signalés, sans bloquer.

**Limites.**

- Un flux peut porter ce que la page affiche **hors de l'article** : liens
  « à lire aussi » de next.ink, signature et navigation de go.dev, appel « Pour
  nous soutenir… » de Frandroid. Le filtre de présence sur la page ne les
  écarte pas, puisqu'ils y sont : ils comptent comme manquants. Un retrait
  accepté par hôte les écarte, comme une perte acceptée.
- Un flux peut porter ce que la page **n'affiche pas** (contenu réservé, texte
  rendu en JavaScript) : il est écarté par le filtre, donc invisible à la
  mesure, y compris si l'extracteur devait le rendre.
- Le flux ne couvre que les pages dont l'item y est encore (ou qu'on a gardé),
  et il ne dit rien des images.

## Codes de sortie

| Code | Sens |
|---|---|
| 0 | Aucune perte non acceptée, aucun `null` nouveau, aucune image perdue |
| 1 | Au moins une perte non acceptée, un `null` nouveau, une exception nouvelle ou une image perdue ; une phrase du flux que la tête manque et que la base rendait (avec `--oracle-strict` : toute phrase du flux manquante) |
| 2 | L'outil lui-même a échoué (argument, ref introuvable, extracteur qui ne se charge pas) |

Logique pure testée dans `lib.test.ts` et `feedOracle.test.ts` (`npx vitest run scripts/corpus`).
