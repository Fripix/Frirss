# Ouvrir un article à sa source depuis la liste — design

**Date** : 2026-09-04
**Statut** : approuvé (brainstorming)
**Origine** : issue #11, « Open article/feed in new source tab ». Snake883 lit
une partie de ses flux directement à la source — Reddit, notamment — et
voudrait pouvoir y aller sans passer par FriRSS, depuis un clic droit et/ou une
icône, pour l'article **et** pour le flux.

## Le constat

**La demande sur le flux est déjà satisfaite.** Un clic droit sur un flux dans
la barre latérale ouvre « Ouvrir le site » (`sidebar.openSite`), et
`src/lib/feedSiteUrl.ts` n'est pas naïf : il gère les flux dont le `htmlUrl`
pointe sur le RSS lui-même, auquel cas « ouvrir le site » téléchargerait du XML
brut. Il retombe alors sur l'origine d'un article du flux. Rien à faire ici,
sinon le faire savoir — la case « j'ai vérifié que FriRSS ne le fait pas déjà »
était cochée, donc la fonctionnalité existe mais reste introuvable.

**La demande sur l'article existe à moitié.** Le volet de lecture porte déjà
« Ouvrir l'original » : bouton de barre d'outils, titre cliquable, entrée du
menu mobile, et le raccourci `O`. Mais tout cela suppose l'article **ouvert** —
donc sélectionné, donc marqué lu et affiché. C'est exactement ce que Snake883
cherche à éviter : il veut partir à la source *depuis la liste*.

Il manque donc une seule chose, et elle est précise : déclencher l'ouverture
externe depuis une ligne, sans ouvrir l'article dans FriRSS.

## Ce qui change

### 1. Une quatrième icône dans la barre d'actions d'une ligne

Le carré à flèche sortante — **le même glyphe que « Ouvrir le site »** —, placé
**juste avant le ✓**. Même verbe, même signe : l'icône porte l'action (« ouvrir
ailleurs »), le contexte porte l'objet (un article ici, un flux dans la barre
latérale). Snake883 retrouve le même symbole pour ses deux demandes.

Un clic fait trois choses, dans cet ordre :

1. **arrête la propagation** — sans quoi la ligne se sélectionnerait et
   l'article s'ouvrirait dans FriRSS, précisément ce qu'on veut éviter. C'est
   le patron déjà en place pour les trois autres boutons
   (`onToggleStar={(e) => { e.stopPropagation(); … }}`) ;
2. **ouvre l'URL source dans un nouvel onglet** ;
3. **marque l'article comme lu — seulement s'il ne l'était pas.**

Le troisième point n'est pas une bascule, et la distinction est structurante :
`toggleRead` appliqué à un article déjà lu le repasserait en **non lu**. Le
bouton appelle donc le marquage sous condition, jamais la bascule.

**Conséquence assumée** : sous le filtre « Non lus », marquer lu retire la ligne
(issue #10, `shouldLeaveList`). Un clic ouvre donc un onglet **et** fait
disparaître la ligne sous le curseur. C'est cohérent avec l'intention — on a
traité l'article ailleurs — mais c'est visible, et c'est voulu.

Hors ligne, l'ouverture échoue côté navigateur ; le marquage part en file
d'attente comme n'importe quelle écriture (`enqueueAction`). Aucun traitement
particulier n'est prévu : afficher un avertissement supposerait de deviner ce
que l'utilisateur voulait.

### 2. Une barre d'actions unifiée

C'est le cœur du travail, et ce qui protège la suite.

Les trois boutons sont aujourd'hui écrits **trois fois** — et les trois modes ne
sont pas au même niveau :

| Mode | Conteneur dédié | Disposition | Écartement | Visibilité |
|---|---|---|---|---|
| Normale (`ArticleList.tsx`) | oui | verticale, alignée en haut | 4 px | toujours |
| Grille (`ArticleCard.tsx`) | oui (`.article-card__actions`) | horizontale | 2 px | au survol ; **toujours au doigt** (`@media (hover: none)`) |
| **Compacte** (`ArticleList.tsx`) | **aucun** | horizontale | **12 px hérités de la ligne** | toujours |

En compact, les boutons ne sont pas groupés : ce sont des enfants directs de la
ligne, au même titre que le titre et l'heure, donc leur écartement est le
`gap-3` de la ligne. D'où l'impression qu'ils flottent.

On extrait **un seul composant**, utilisé par les trois modes, qui rend un
nombre d'emplacements **fixe**. Chaque mode garde sa disposition ; seul le
groupement et l'écartement deviennent les siens.

**Deux comportements opposés, selon la cause de l'absence — et c'est la
subtilité de cette conception :**

- **Article sans URL source** → l'emplacement est **réservé, vide**. La
  variation est d'une ligne à l'autre : sans réservation, le ✓ danserait dans
  la colonne. La ligne compacte réserve déjà la place de la pastille « non lu »
  pour cette raison exacte, avec le commentaire *« Always reserve space for the
  unread dot to avoid alignment shift »*. On étend une règle du projet, on n'en
  invente pas une.
- **Icône masquée par réglage** → l'emplacement **disparaît**. Le choix vaut
  pour toute la liste : rien ne danse, et garder un trou permanent serait
  absurde.

Quand les deux se présentent — l'icône « ouvrir » est masquée par réglage *et*
l'article n'a pas d'URL —, **le réglage l'emporte** : l'emplacement disparaît. Le
réservé n'existe que pour absorber une variation d'une ligne à l'autre ; si
l'icône est masquée partout, il n'y a plus rien à absorber.

**Un ordre unique, partout** : `⭐ ⏰ ↗ ✓`. Un composant partagé impose un seul
ordre, et la ligne compacte est aujourd'hui la seule à inverser l'étoile et
« à lire plus tard ». Elle s'aligne donc sur les deux autres. L'alternative — un
paramètre d'ordre — figerait une divergence que personne n'a choisie. Le ✓ reste
en dernier : la spec de l'issue #10 note qu'en compact, le ✓ de la ligne
suivante tombe exactement là où était le précédent, ce qui permet d'enchaîner
les clics sans bouger la souris. Insérer avant lui préserve cette propriété.

### 3. `openExternal()`, avec `noopener`

Le projet se protège du *reverse tabnabbing* : `sanitizeHtml.ts` installe un
crochet qui ajoute `rel="noopener noreferrer"` à tout lien d'article ouvrant un
nouvel onglet. Mais les deux endroits qui ouvrent une URL **par script** ne le
font pas :

```
src/hooks/useKeyboardNav.ts      window.open(article.url, '_blank')   ← raccourci O
src/components/Sidebar/Sidebar.tsx   window.open(url, '_blank')       ← « Ouvrir le site »
```

Contrairement à `<a target="_blank">`, pour lequel les navigateurs impliquent
`noopener`, **`window.open` ne l'implique pas** : la page ouverte garde une
référence `window.opener` vers FriRSS et peut le rediriger. Le garde-fou
existant couvre le contenu des flux, pas nos propres appels.

Une fonction `openExternal(url)` dans `src/lib/`, testée, pose `noopener`. Trois
appelants : la nouvelle icône, le raccourci `O`, « Ouvrir le site ». Le défaut
disparaît partout et ne peut pas revenir par un quatrième appel écrit à la main.

### 4. Quatre réglages de visibilité

Un interrupteur par icône — étoile, à lire plus tard, ouvrir à la source,
marquer lu —, dans **Préférences → Général**, toutes visibles par défaut
(comportement actuel). Le patron existe : `showFavicons` dans `uiStore`, un
booléen persisté en `localStorage`.

Le réglage vaut pour **les trois modes à la fois**. Une icône masquée l'est
partout : c'est un choix sur le vocabulaire de l'interface, pas sur une vue.

Il ne concerne **que la barre d'actions d'une ligne**. Le volet de lecture garde
ses propres boutons, quels que soient ces quatre réglages : masquer le ✓ de la
liste ne doit pas retirer le moyen de marquer lu l'article qu'on est en train de
lire.

Masquer les quatre est permis — la ligne n'a alors plus d'actions, et c'est un
choix légitime sur un téléphone, où le balayage couvre déjà lu et à lire plus
tard. Rien n'est perdu : le volet de lecture, les raccourcis clavier et les
gestes restent.

**Ce n'est pas la piste d'options en tête de liste** (source, favicons,
séparateurs de dates, barre). Celle-ci ne change pas : elle règle ce que la
ligne *affiche* du contenu, là où ces interrupteurs règlent quels *outils*
l'interface propose. Décision explicite du propriétaire.

## Écarté, et pourquoi

Chacun de ces refus a été examiné avant d'être écarté.

**Un menu contextuel FriRSS au clic droit.** L'issue le propose en premier. Mais
un clic droit sur une ligne affiche aujourd'hui le menu **natif du navigateur**,
qui offre déjà « Ouvrir dans un nouvel onglet », « Copier le lien », la
traduction, les extensions — capture à l'appui. Le remplacer, c'est retirer plus
que ce qu'on ajoute. Et il n'a pas d'équivalent au doigt : sur mobile, l'appui
long sert déjà au classement en catégorie, et le balayage à lu / à lire plus
tard. Une icône marche partout, sur les trois facteurs de forme et dans les
trois modes — c'est le choix du propriétaire, et c'est le bon.

**Faire du titre un vrai `<a href>`.** Séduisant : on obtiendrait le ⌘-clic, le
clic milieu et le menu natif enrichi, sans rien inventer. Écarté parce que les
lignes sont **déjà glissables** vers une catégorie, et que les ancres le sont
nativement : le conflit serait à démêler pour un gain que l'icône apporte déjà.

**Mettre les interrupteurs dans la piste d'options.** Refusé par le
propriétaire : cette piste ne doit pas changer.

**Aligner l'ordre du compact dans un commit séparé.** L'ordre avait été mis hors
périmètre lors de l'issue #10. Mais le composant partagé force la question — la
traiter à part reviendrait à livrer sciemment un paramètre d'ordre inutile.

## Tests

Logique pure d'abord, dans `src/lib/`, testée avant d'être écrite :

- **Les emplacements** — un article sans URL rend un emplacement réservé, jamais
  un bouton ; un article avec URL rend le bouton. Un réglage désactivé retire
  l'emplacement au lieu de le réserver. Un test par cas : c'est la distinction
  centrale de cette conception, et rien d'autre ne la protège.
- **La règle de lecture** — non lu → lu ; **déjà lu → inchangé**. Le test doit
  échouer si quelqu'un rebranche `toggleRead` : la bascule repasserait l'article
  en non lu, à l'inverse de l'intention.
- **`openExternal`** — `noopener` présent. Le test doit échouer si on le retire,
  sans quoi le correctif ne tient qu'à la vigilance du prochain lecteur.
- **L'ordre** — `⭐ ⏰ ↗ ✓`, identique dans les trois modes. C'est ce qui
  empêche la divergence du compact de revenir.

Garde-fous existants à surveiller :

- `settingsCoverage.test.ts` fige `settings-baseline.json` à **232 clés** et
  vérifie qu'aucune ne disparaît. Les quatre réglages neufs **n'y entrent pas** :
  ce relevé est un inventaire d'avant refonte, et son `toHaveLength(232)`
  interdit justement qu'on le rallonge. Rien ne doit rougir.
- `featuresDoc.test.ts` exige que toute famille de traductions nouvelle figure
  dans `docs/FEATURES.md`.

## Fichiers touchés

| Fichier | Rôle |
|---|---|
| `src/lib/openExternal.ts` *(nouveau)* | Ouverture externe avec `noopener`, + tests |
| `src/lib/rowActions.ts` *(nouveau)* | Quels emplacements, réservés ou retirés, + tests |
| `src/components/ArticleList/ArticleActions.tsx` | Le bouton, et la barre unifiée |
| `src/components/ArticleList/ArticleList.tsx` | Les deux modes y branchent la barre |
| `src/components/ArticleList/ArticleCard.tsx` | La grille y branche la barre |
| `src/hooks/useKeyboardNav.ts` | Le raccourci `O` passe par `openExternal` |
| `src/components/Sidebar/Sidebar.tsx` | « Ouvrir le site » passe par `openExternal` |
| `src/stores/uiStore.ts` | Quatre booléens persistés |
| `src/components/Preferences/GeneralTab.tsx` | Quatre interrupteurs |
| `src/locales/*.json` | **Les neuf** locales |
| `docs/FEATURES.md`, `docs/RELEASE-NEXT.md` | Obligatoires, même commit |

Chaînes d'interface nouvelles : le libellé du bouton (`articleRow.openSource`),
le titre du groupe de réglages et ses quatre libellés. **Dans les neuf locales**,
parité vérifiée avant livraison.

## Hors périmètre

**Le volet de lecture.** Il porte déjà « Ouvrir l'original » et le raccourci `O` ;
rien à y ajouter.

**Le menu contextuel d'un flux.** « Ouvrir le site » existe et répond à la
seconde moitié de l'issue. Seul son appel change, pour passer par
`openExternal`.

**La découvrabilité de « Ouvrir le site ».** Snake883 ne l'a pas trouvée alors
qu'elle existe — le README ne la mentionne probablement pas. C'est un vrai
constat, mais il relève de la documentation, pas de cette conception.
