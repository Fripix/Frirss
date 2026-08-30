# 1.4.5 — en préparation

Journal des changements du cycle en cours, tenu au fil de l'eau. Il alimente les
notes de la release GitHub et les corrections du README, puis se vide une fois
la release publiée.

> **À tenir à jour au moment du commit, pas à la fin du cycle.** Pour la 1.4.3,
> six correctifs manquaient à l'appel : le journal avait été rempli pour les
> gros morceaux et oublié pendant les finitions. Ils n'ont été retrouvés qu'en
> relisant les 57 commits. Contre-vérification utile avant de publier : differ
> `src/locales/en.json` contre le tag précédent — toute chaîne d'interface
> ajoutée ou modifiée doit correspondre à une entrée écrite ici.

## Fonctionnalités

- **Un thème sombre, enfin.** Trois thèmes livrés en plus du thème par défaut —
  **Night**, **Paper** et **High Contrast** — présentés en galerie de vignettes
  en haut de Préférences → Apparence → Thème. Le moteur savait déjà tout faire :
  il ne livrait aucun contenu, et atteindre un thème sombre demandait de régler
  36 couleurs à la main.
- **Des messages de confirmation.** L'application ne disait jamais qu'une
  action avait abouti. Un message bref apparaît en bas de l'écran — articles
  marqués comme lus, lien copié — et disparaît seul.
- **Un aide-mémoire des raccourcis, sur la touche `?`.** Ils étaient
  réassignables et documentés dans les préférences, mais rien ne les montrait
  au moment où on en a besoin.
- **La recherche se souvient des cinq dernières requêtes**, par serveur, et les
  propose à l'ouverture du champ.
- **Partager un article, ou copier son lien**, depuis le volet de lecture. Sur
  mobile, la feuille de partage du système ; ailleurs, le presse-papiers.
- **Le thème peut suivre le système.** Un interrupteur, puis le choix du thème
  clair et du thème sombre. La bascule conserve vos tailles de police, et se
  rejoue aussi au retour dans l'application — le système change souvent d'avis
  pendant que l'onglet est en arrière-plan.

## Corrections et améliorations

- **Les favicons apparaissent dans la liste d'articles.** La source n'était
  qu'un mot en majuscules : dans une vue Tous les flux, il fallait lire au lieu
  de reconnaître. Suit le réglage de favicons déjà présent.
- **L'en-tête de liste a une hiérarchie.** Le titre du flux est plus grand, et
  le nombre d'articles non lus de la vue s'affiche à côté — en scroll infini,
  rien ne disait s'il restait dix articles ou deux cents.
- **Les séparateurs de date sont lisibles** et indiquent le nombre d'articles
  du jour. Ce sont les seuls repères de progression d'une liste sans fin.
- **Les états vides proposent une action.** « Tout est lu » est une réussite et
  le montre ; « aucun résultat » propose d'élargir la recherche à tous les flux.
- **Les images d'article ne dépassent plus 80 % de la hauteur d'écran.** Une
  infographie verticale occupait trois écrans et coupait la lecture en deux.
- **Le badge de non-lus suivait mal les thèmes** : son fond était le vert
  menthe écrit en dur, y compris sur un thème dont l'accent est différent.

- **Le focus clavier est enfin visible.** Un anneau `:focus-visible` global :
  l'interface comptait 137 boutons pour 4 anneaux de focus, tous sur l'écran de
  connexion. Naviguer au clavier hors des raccourcis dédiés était impossible.
- **iOS ne zoome plus sur les champs de saisie.** La règle qui les forçait à
  16 px perdait contre les classes utilitaires : mesuré à 14 px sur l'écran de
  connexion, sur tous les champs sauf celui de la recherche, qui avait son
  contournement à lui.
- **Le texte des boutons pleins est lisible.** Le blanc était écrit en dur sur
  l'accent et sur la couleur de danger, deux couleurs que l'utilisateur choisit ;
  sur l'accent menthe par défaut, cela donnait 1,9:1. L'encre est maintenant
  calculée à partir de la couleur de fond. Idem pour les pastilles d'étiquette,
  qui pouvaient écrire leur nom en blanc sur un fond jaune.
- **Les articles non lus se repèrent dans la liste.** Une barre à gauche de la
  ligne, dans les modes Standard et Aperçu, où l'état non-lu ne tenait qu'à la
  graisse du titre et à sa nuance de gris.
- **Le texte d'un article ne s'étale plus sur toute la largeur** en mode Focus :
  la colonne de lecture est plafonnée et centrée.
- **Les champs de saisie atteignent 44 px au doigt**, comme les boutons.
- **Les surbrillances de glisser-déposer suivent le thème.** Trois d'entre elles
  étaient en orange codé en dur — l'accent d'une ancienne version.
- **Les boutons à icône seule ont un nom** pour les lecteurs d'écran, en plus de
  leur infobulle, que le tactile n'affiche jamais.
- **« Mouvement réduit » est respecté partout**, y compris par les deux
  transitions de navigation mobile, dont les durées échappaient au CSS.
- **Les panneaux ne sont plus d'un blanc froid.** La barre latérale est un noir
  chaud ; les panneaux à côté étaient en blanc pur, et les deux moitiés de
  l'écran n'allaient pas ensemble. Le blanc pur est aussi le fond le plus
  fatigant en lecture longue. Un thème personnalisé n'est pas touché : seules
  les valeurs restées à l'ancien défaut sont reprises.

## Sous le capot

- Le passage d'un article à l'autre se fait avec un léger mouvement, dans le
  sens de la navigation ; la bascule du squelette vers le texte se fond au lieu
  de clignoter ; les dix premières lignes d'une liste se déposent au lieu
  d'arriver en bloc ; et le compteur de non-lus marque le coup quand il change.
  Tout est désactivé si le système demande un mouvement réduit.
- Les menus d'options du format mobile s'ouvrent en feuille depuis le bas, à
  portée du pouce, au lieu d'une liste ancrée en haut de l'écran. Le motif
  existait déjà pour les étiquettes ; les trois partagent maintenant un seul
  composant.
- Le composant de favicon a été sorti de la barre latérale, où il ne servait
  qu'elle, vers `src/components/FeedFavicon.tsx`.

## Actions requises à la mise à jour

Aucune.

## Documentation

_(rien pour l'instant)_
