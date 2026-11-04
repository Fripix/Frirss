# Barres personnalisables sur desktop — conception

*2026-11-04. Statut : validé par le propriétaire le 2026-11-04 ; rien n'est construit.*

## Intention

Rendre FriRSS plus personnalisable, pour l'expérience, pas pour corriger une
gêne : chacun choisit quels boutons il voit dans les barres d'outils du
**format desktop**. Trois conditions posées par le propriétaire :
**faisable, maintenable, et jamais de mise en page cassée**.

## Décisions du propriétaire

- Le réglage se fait **depuis les Préférences**, avec des **interrupteurs
  regroupés par zone**. Pas de mode « personnaliser » sur l'interface.
- **Desktop seulement** pour cette fois. Tablette et téléphone restent
  inchangés. Les ouvrir plus tard est souhaité (voir « Suite possible »).
- **Filet de secours = la palette de commandes** (Ctrl/⌘ K). Pas de menu
  « Plus » sur desktop.
- **Zones modifiables** :
  1. **Barre de la liste** : Rechercher, Non lus, Aléatoire, Favoris, Tout lu,
     la piste d'options, la densité, Liste / Côte à côte / Grille, **et la barre
     entière**.
  2. **Barre du volet de lecture** : ses boutons.
  3. **Barre des raccourcis** en bas de l'écran.
- **Non modifiables** : l'en-tête et le pied de la barre latérale.
- **Déjà masquables, inchangés** : la barre des serveurs (`topbarVisible`) et
  les icônes des lignes (`rowActions`).
- **Barre de la liste masquée en entier** : la liste commence tout en haut,
  rien au-dessus — titre de la vue et compteur compris. Le propriétaire
  ajustera à l'usage si besoin.
  - *Choix de conception, pour ne rendre aucune fonction inatteignable* : la
    **zone de recherche** (champ, recherches récentes, bandeau « recherche
    active » et sa croix) vit dans cet en-tête. Barre masquée, elle **apparaît
    quand une recherche est ouverte** (depuis la palette ou `f`) et disparaît
    à sa fermeture. L'en-tête est donc découpé en deux blocs : la barre
    (masquable) et la zone de recherche (affichée tant qu'elle est active).

## Objectifs, non-objectifs, anti-objectifs

- **Objectif** : un utilisateur desktop masque les boutons qu'il n'utilise pas
  et retrouve leur fonction dans la palette.
- **Non-objectifs** : réordonner les boutons ; personnaliser tablette ou
  téléphone ; toucher à la barre latérale ; changer l'apparence d'un bouton.
- **Anti-objectifs** (échec même si « ça marche ») :
  - une fonction devenue **inatteignable** parce que son bouton est masqué ;
  - une barre **déformée** : séparateur orphelin, trou, bouton qui saute
    d'un côté à l'autre, barre vide qui garde sa hauteur ;
  - un bouton ajouté plus tard qui **échappe** au réglage ou disparaît chez
    quelqu'un sans qu'il l'ait décoché ;
  - une différence visible pour quelqu'un qui ne touche à rien.

## Contraintes

- **Tout visible par défaut.**
- **« Desktop » = le format retenu par `useBreakpoint()`** (≥ 1024 px, ou
  format forcé sur desktop), pas l'appareil physique. Sur tablette et
  téléphone, les réglages sont ignorés : tout reste affiché.
- **Synchronisés entre appareils** comme les autres préférences logiques
  (`UI_SYNC_KEYS`), et sauvegardés avec elles. *(Choix de conception :
  ce sont des choix de goût, pas de géométrie.)*
- **Une seule clé de stockage**, un objet, comme `rowActions` : une seule entrée
  dans `UI_SYNC_KEYS`, dans la liste des clés JSON de `applyServerPrefs`, et
  dans la sauvegarde.
- **Complétion des clés manquantes** (piège déjà connu de `rowActions`) : un
  appareil resté sur une version antérieure synchronise un objet auquel il
  manque les boutons ajoutés depuis ; une clé absente vaut **visible**, jamais
  masqué. La normalisation tourne au chargement **et** à `applyServerPrefs`.
- **Dix locales** pour chaque libellé (parité vérifiée).
- **Inventaire** : `docs/FEATURES.md` mis à jour dans le même commit.

## La règle qui rend ça sûr et maintenable

### Un registre unique

Un module pur (proposition : `src/lib/toolbarItems.ts`) déclare **chaque
élément masquable une fois** : son identifiant, sa zone, sa clé de libellé, et
**la commande de palette qui le remplace**. Les Préférences se construisent à
partir de ce registre ; les barres lisent la visibilité par identifiant. Ajouter
un bouton masquable = une ligne dans le registre.

### Masquable ⇔ une commande dans la palette

**Un élément n'est masquable que s'il a une commande de palette équivalente.**
Un test le vérifie pour chaque entrée du registre. Aujourd'hui la palette ne
couvre qu'une partie des boutons (vues, recherche, dispositions Liste / Côte à
côte / Grille, sections des Préférences, résumé et traduction IA) : les
commandes manquantes sont **ajoutées** dans ce chantier, ce qui profite aussi à
ceux qui ne masquent rien. Une commande liée à l'article ouvert n'apparaît que
lorsqu'un article est ouvert, comme le font déjà résumé et traduction.

**Barre de la liste** (commande à ajouter = ✚, existe = ✓) :

| Élément | Palette |
|---|---|
| Rechercher | ✓ |
| Non lus (filtre) | ✚ |
| Aléatoire | ✚ (seulement là où le tirage est permis) |
| Favoris (filtre) | ✚ |
| Tout lu | ✚ (seulement si la vue le permet ; passe par la même confirmation) |
| Piste d'options : Source, Favicons, Séparateurs de dates, Barre des serveurs | ✚ une bascule par option |
| Densité (Aperçu / Simple / Compact) | ✚ une commande par densité |
| Liste / Côte à côte / Grille | ✓ |
| **La barre entière** | couverte : chacun de ses boutons l'est |

**Barre du volet de lecture** (article ouvert) :

| Élément | Palette |
|---|---|
| Retour (2 colonnes / grille) | ✚ « Fermer l'article » |
| Lu / non lu | ✚ |
| Favori | ✚ |
| À lire plus tard | ✚ |
| Étiquettes | ✚ (voir « Laissé au constructeur ») |
| Article complet / RSS | ✚ |
| Résumé IA | ✓ (conditionnel, inchangé) |
| Traduire | ✓ (conditionnel, inchangé) + ✚ « Afficher le texte source » quand une traduction est affichée. Le choix de langue et de fournisseur (chevron) reste dans Préférences → IA, qui le règle déjà *(choix de conception)* |
| Ouvrir l'original | ✚ |
| Partager / copier le lien | ✚ |
| Mode Focus | ✚ |
| A− / A+ | ✚ deux commandes |

**Barre des raccourcis** : purement informative, elle n'a aucune fonction à
remplacer. **Un seul interrupteur pour la barre entière** *(choix de
conception)* : ses éléments sont générés à partir des raccourcis, réassignables,
et n'entrent pas dans le registre des boutons. Masquée, elle emporte la mention
« ⌘K Palette » ; l'aide des raccourcis reste atteignable par `?`, et la phrase
d'aide de chaque section des Préférences rappelle Ctrl/⌘ K.

### Ce qui ne bouge jamais

- L'accès aux **Préférences** reste toujours visible (il vit dans la barre
  latérale, hors périmètre — rien à faire, mais à ne pas casser).
- Les **raccourcis clavier** ne dépendent pas de la visibilité d'un bouton.
- Les **gestes portés par un bouton** suivent son sort : masquer Favori ou
  À lire plus tard dans le volet retire aussi leur appui long (classer dans une
  catégorie). Le texte d'aide de la section l'annonce, comme pour les icônes
  des lignes. Le classement reste possible depuis la ligne d'article.

## Ne pas casser la mise en page

Masquer **retire** un élément ; les autres se resserrent. Rien n'est déplacé ni
réordonné. Règles :

- **Séparateurs** : un séparateur n'est rendu que s'il a un élément visible de
  chaque côté dans sa barre. Jamais deux séparateurs de suite, jamais en tête
  ni en queue.
- **Groupes** : la piste d'options vide, la densité ou les dispositions masquées
  ne laissent pas leur conteneur (bordure, fond) vide à l'écran.
- **Espaceur** du volet de lecture : il reste à sa place ; Focus et A− / A+
  restent calés à droite tant qu'au moins l'un d'eux est visible.
- **Barre vide** : une barre sans élément visible n'est pas rendue du tout
  (pas de bande vide). Pour la barre de la liste, c'est aussi ce que fait
  l'interrupteur « barre entière ».
- **Repli des libellés** (`useToolbarFold`, `data-fold`) : il se recalcule sur
  les éléments réellement affichés, pour ne pas replier des libellés alors
  qu'il y a désormais la place.
- **Bouton ☰** (rouvrir la barre latérale quand elle est fermée) : il vit dans
  la barre de la liste. Masquer la barre entière le masque aussi ; la touche
  `b` et la palette restent. *(À vérifier par le constructeur : s'il n'y a pas
  de commande de palette pour la barre latérale, en ajouter une.)*
- **Barre de raccourcis masquée** : le volet et la liste récupèrent sa hauteur.
- **Barre de progression de lecture** (desktop) : elle est rendue dans la barre
  du volet. Si tous les boutons du volet sont masqués, la barre n'est plus
  rendue mais la progression reste, en fin liseré en haut du volet comme sur
  mobile *(choix de conception)*.

## Préférences

Dans **Préférences → Mise en page**, qui contient déjà les icônes des lignes,
une section par zone, sous un titre qui précise **« Sur ordinateur »** :

1. Barre de la liste — l'interrupteur « barre entière » en tête ; quand il est
   éteint, les interrupteurs des boutons sont désactivés (grisés), pas cachés.
2. Volet de lecture.
3. Barre des raccourcis.
4. **Une section à part, « Sur tous les écrans »**, dans le même panneau,
   pour la barre des serveurs et les icônes des lignes *(choix de
   conception)*. Ces deux réglages valent aujourd'hui pour tous les formats et
   **le restent** : les ranger sous « Sur ordinateur » laisserait croire le
   contraire, et les limiter au desktop changerait l'affichage de ceux qui les
   ont déjà réglés. Leur stockage ne change pas ; la barre des serveurs garde
   aussi sa bascule dans la piste d'options.

Un bouton « Tout réafficher » par zone. Chaque section porte une phrase d'aide :
un élément masqué reste disponible dans la palette (Ctrl/⌘ K).

Sur tablette et téléphone, la section reste visible (on peut régler son
ordinateur depuis son téléphone) avec une mention qu'elle ne vaut que pour le
format desktop.

## Laissé au constructeur

- Le nom exact du module de registre et la forme de l'objet stocké.
- La forme de la commande « Étiquettes » : ouvrir le sélecteur d'étiquettes de
  l'article, ou une commande par étiquette (« Étiqueter : X »). Les deux
  satisfont la règle ; choisir la plus simple qui reste lisible dans la palette.
- Le libellé exact de chaque commande, cohérent avec celui du bouton (même
  verbe).
- Le découpage des commits et l'ordre des zones.

## Vérification attendue

- Tests purs du registre, de la normalisation (clés manquantes = visibles) et
  de la règle des séparateurs.
- **Garde-fou** : chaque entrée masquable du registre a sa commande de palette ;
  chaque bouton de ces trois barres est déclaré dans le registre. Prouver qu'il
  sait échouer (retirer une commande, le voir rougir).
- Rendu réel desktop, toutes zones masquées puis une à une, en 3 colonnes,
  2 colonnes et grille : aucune barre vide, aucun séparateur orphelin, mesure
  par `getBoundingClientRect()`.
- Tablette et téléphone : **aucune différence** avec et sans réglages.

## Suite possible (hors périmètre)

Ouvrir tablette et téléphone : la palette n'y existe pas (clavier seulement),
donc le filet de secours serait un menu « Plus » par barre — le volet de lecture
en a déjà un sur ces formats (feuille « Plus »). Le registre est conçu pour
porter une visibilité par format le jour venu.
