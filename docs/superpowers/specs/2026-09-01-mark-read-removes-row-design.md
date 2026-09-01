# Le ✓ retire la ligne sous « Non lus » — design

**Date** : 2026-09-01
**Statut** : approuvé (brainstorming)
**Origine** : issue #10, « Read items still appear when Unread filter is used ».
Snake883, en 1.4.6, filtre sur les non-lus, clique le ✓ d'une ligne, et l'article
reste affiché. Il demande qu'il disparaisse. Une seconde demande, formulée en
discussion, s'y ajoute : le ✓ manque en affichage compact.

## Le constat

**Ce n'est pas un défaut, c'est une décision consignée.** `feedStore.ts` la
documente : « marquer lu depuis la vue Non lus laisse la ligne, et
`silentRefresh` réinsère même l'article en cours de lecture pour qu'il ne
s'évapore pas. La vue se réconcilie au rechargement, jamais sous les yeux du
lecteur. » C'est cohérent sur les cinq sites d'écriture — retirer un favori
depuis la vue Favoris ne sort pas non plus l'article de la liste.

Mais cette règle a été écrite pour protéger la **lecture**, pas pour neutraliser
un geste de mise à l'écart. Cliquer le ✓ d'une ligne qu'on ne lit pas n'a qu'une
seule intention : « j'en ai fini avec celui-là ». Que la ligne reste rend ce
geste sans effet visible, sous un filtre dont c'est précisément le sujet.

**La distinction n'est pas à inventer, elle est déjà dans le code.** Lire un
article passe par `selectArticle`, pas par `toggleRead` — un commentaire de
`feedStore.ts` le souligne, c'est le chemin qui doit survivre hors ligne. Le ✓,
lui, appelle `toggleRead`. Deux chemins, deux intentions.

## Ce qui change

### 1. Le ✓ retire la ligne quand la vue est filtrée « Non lus »

Comportement par défaut, pas une option.

Le retrait suit la **confirmation du serveur**, jamais l'écriture optimiste.
Cette contrainte n'est pas négociable et elle est chèrement acquise : le retrait
optimiste existait au commit initial, sans décision consignée, et rendait le
rollback impossible. Un refus du serveur faisait disparaître l'article de
l'écran alors qu'il restait en favori côté FreshRSS — avec un compteur
correctement restauré annonçant « 1 favori » au-dessus d'une liste vide. On ne
retire pas une ligne qu'on ne saura pas remettre.

Le retrait ne se déclenche que sur la **transition non lu → lu**, et seulement
quand `feedStore.filter === 'unread'`. C'est l'état dérivé qui fait foi, pas
`unreadOnlyByFeed` dont il est calculé : les deux existent, et se brancher sur
le mauvais donnerait un comportement différent selon la vue. Les vues Favoris
et À lire plus tard portent d'autres valeurs de `Filter` et ne retirent donc
jamais rien. `toggleRead` est une bascule : marquer *non lu* ne retire rien.

Hors ligne, l'écriture est mise en file et rejouée plus tard
(`enqueueAction`). Sans confirmation, pas de retrait : la ligne reste, et la vue
se réconcilie au rechargement comme aujourd'hui.

### 2. Le ✓ dans l'affichage compact

`MarkReadButton` existe déjà (`ArticleActions.tsx`) et est rendu dans la ligne
normale et dans la vue grille (`ArticleCard.tsx`). Il ne manque que dans la
branche compacte de `ArticleRow`, qui ne porte aujourd'hui que
`ReadLaterButton` et `StarButton`. C'est un branchement, pas un composant à
écrire.

En compact, les lignes ont toutes la même hauteur. Le ✓ de la ligne suivante
vient donc se placer exactement là où était le précédent : enchaîner les clics
marque les articles l'un après l'autre sans bouger la souris.

## Ce qui ne retire rien, et pourquoi

- **Ouvrir un article.** `selectArticle` marque lu sans condition ni réglage. Si
  le retrait se déclenchait sur l'état plutôt que sur le geste, la ligne de
  l'article qu'on vient d'ouvrir disparaîtrait pendant qu'on le lit — le sol qui
  bouge au pire moment.
- **Le marquage au défilement** (`ArticleList.tsx`, via `markReadOnScroll`).
  C'est le seul appel *implicite* à `toggleRead` : le système décide, pas
  l'utilisateur. Retirer ces lignes ferait s'effondrer la liste en continu
  pendant qu'on défile.
- **Le raccourci clavier et la bascule du volet de lecture.** ⚠️ **Le
  raisonnement d'origine de cette spec était FAUX**, et il est corrigé ici
  plutôt que masqué. Il disait : « aucune règle spéciale n'est nécessaire :
  l'article sélectionné est déjà lu, donc ces gestes produisent une transition
  lu → *non lu*, qui ne retire rien par construction. » Ce n'est vrai que du
  **premier** appui. La bascule est une bascule : un deuxième appui repasse
  l'article en lu, et cette transition-là est bien non-lu → lu sur l'article
  ouvert. Sans garde, sa ligne partait pendant qu'il restait affiché à
  l'écran — `selectNextArticle` ne le retrouvait plus (`findIndex` → -1, puis
  `articles[0]`) et sautait en tête de liste, et le suivant/précédent du
  mobile devenait inerte. L'implémentation a donc dû ajouter un critère
  `selected` à `shouldLeaveList` (`src/lib/removeOnRead.ts`) : **la ligne de
  l'article ouvert ne part jamais**. C'est le même invariant que
  `silentRefresh` entretient déjà en réinsérant l'article en cours de lecture.

En pratique, deux gestes déclenchent le retrait : le ✓ d'une ligne non
sélectionnée, et le balayage vers la gauche sur mobile — le même geste au
doigt. « Non sélectionnée » est une condition à part entière, pas une
observation : voir le paragraphe précédent.

## Écarté, et pourquoi

Ces refus valent d'être consignés : chacun a été proposé, examiné, puis retiré.

**Un réglage optionnel plutôt qu'un défaut.** Une option ne tranche pas un doute
de conception, elle le préserve. Personne n'a demandé de choix : Snake883 a
demandé un comportement.

**« Retirer aussi au départ »** — la ligne de l'article ouvert disparaîtrait au
passage au suivant, pour une vue toujours propre. Séduisant sur le papier,
incertain à l'œil, et demandé par personne. À rouvrir seulement si l'usage le
réclame.

**Un bandeau « Annuler ».** Proposé pour rattraper le clic à côté — le deuxième
clic d'une rafale qui atterrit ailleurs parce que la liste a remonté. Il ne
couvre pas ce cas : l'action accidentelle serait un favori, un « à lire plus
tard » ou une ouverture, jamais un « marqué lu » erroné. Un bandeau « Article
marqué lu — Annuler » n'aurait rien rattrapé.

**Uniformiser les hauteurs de ligne.** Le titre est le seul élément non borné
(`line-clamp-2` couvre déjà le résumé) ; le figer à deux lignes alignerait les ✓
et supprimerait le clic à côté. Écarté : ça change l'aspect de la liste pour
tout le monde, bien au-delà de cette demande, et coûte environ un article par
écran. Le cas ne se produit pas en compact, et l'utilisateur s'adapte ailleurs.

## Tests

Logique pure d'abord, dans `src/lib/`, testée avant d'être écrite :

- `shouldLeaveList()` — vraie sur non lu → lu **et** `filter === 'unread'` ;
  fausse sur lu → non lu, fausse sous `all`, `starred` et `readlater`, fausse
  sans confirmation serveur.
- Le retrait ne concerne jamais l'article ouvert par `selectArticle` : le test
  doit échouer si l'implémentation se branche sur l'état plutôt que sur le geste.

Garde-fou existant à surveiller : `settingsCoverage.test.ts` gèle 232 réglages —
ce travail n'en ajoute ni n'en retire aucun, le relevé ne doit pas bouger.

## Fichiers touchés

| Fichier | Rôle |
|---|---|
| `src/lib/removeOnRead.ts` (nouveau) | `shouldLeaveList()`, logique pure + tests |
| `src/stores/feedStore.ts` | `toggleRead` retire après confirmation |
| `src/components/ArticleList/ArticleList.tsx` | `MarkReadButton` en compact |
| `docs/FEATURES.md` | Obligatoire, même commit |

Aucune chaîne d'interface nouvelle n'est prévue : le bouton et son libellé
existent déjà. Si l'implémentation en fait naître une, elle va dans les **neuf**
locales.

## Hors périmètre

L'ordre des trois boutons (étoile, à lire plus tard, ✓) ne change pas. Le
comportement du filtre lui-même, la réconciliation au rechargement et le
marquage au défilement ne sont pas touchés.
