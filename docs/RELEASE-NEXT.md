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

- **Un thème sombre, enfin.** Cinq thèmes livrés en plus du thème par défaut :
  **Night**, **Lowlight** et **Desk** en sombre, **Paper** (sépia) et
  **High Contrast** en clair — présentés en galerie de vignettes
  en haut de Préférences → Apparence → Thème. Le moteur savait déjà tout faire :
  il ne livrait aucun contenu, et atteindre un thème sombre demandait de régler
  36 couleurs à la main.
- **Un bouton pour voir le mot de passe** sur l'écran de connexion, et un
  sous-titre qui dit ce qu'est FriRSS au lieu de répéter « Connexion » entre
  « Bienvenue sur FriRSS » et le bouton « Se connecter ».
- **Des messages de confirmation.** L'application ne disait jamais qu'une
  action avait abouti. Un message bref apparaît en bas de l'écran — articles
  marqués comme lus, lien copié — et disparaît seul.
- **Une palette de commandes, sur ⌘K (Ctrl+K).** Elle et l'aide-mémoire `?`
  sont rappelées dans la barre du bas, à part des raccourcis d'articles, et la
  touche affichée suit le clavier — ⌘ sur Mac, Ctrl ailleurs. Une seule entrée pour aller à
  un flux, une catégorie, une étiquette ou une vue, et pour lancer les actions
  courantes. Les accents sont ignorés : « securite » trouve « Sécurité ».
- **Marquer les articles comme lus en défilant**, en option (Préférences →
  Général, éteinte par défaut). C'est la seule façon de traiter une vue Non lus
  à trois cents entrées sans cliquer trois cents fois. Jamais pendant une
  recherche, et une seconde de délai laisse le temps de remonter.
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

- **Le texte d'un article occupe toute la largeur du volet**, comme avant ce
  cycle. Le plafond de largeur essayé ici n'a convaincu à aucune des deux
  versions : la colonne est déjà bornée par la disposition.
- **« Paper » est sépia jusqu'au bout.** La page était crème mais la barre
  latérale et son bandeau restaient aux couleurs du thème par défaut : une page
  de livre surmontée d'un bandeau vert vif. Cuir sombre, bandeau tan, encre
  sienna.
- **Le blanc est redevenu blanc.** Les surfaces de lecture avaient reçu une
  teinte — chaude pour le thème par défaut, colorée pour les thèmes de couleur.
  À l'usage, cela se lit comme un voile sur les articles. Fonds neutres
  partout, sauf « Paper » où la teinte est le sujet. La piste qui groupe les
  icônes d'affichage suit : un gris franc, ni lilas ni beige.
- **Préférences → Apparence s'ouvre sur la galerie de thèmes**, pas sur la
  liste des 36 couleurs.
- **Plus d'encadré surgissant sur les bascules d'affichage.** Après un clic,
  elles gardaient le focus et l'anneau du clavier s'allumait à la frappe
  suivante, sur un bouton qu'on ne regardait plus.
- **Les séparateurs de date portent la date**, pas seulement le jour :
  « MERCREDI » seul ne dit pas de quel mercredi il s'agit.
- **Les thèmes livrés se mettent à jour.** Une fois un préréglage dans votre
  liste, il y restait figé : une correction apportée à ce thème ne vous
  parvenait jamais, et rien dans l'interface ne permettait de le rafraîchir.
  Vos propres thèmes ne sont pas touchés — un préréglage modifié se garde sous
  son propre nom, avec « Enregistrer ».
- **Les bascules d'affichage de l'en-tête sont regroupées** et leur état actif
  ne se signale plus par un fond vert, devenu trop présent sur le nouvel
  en-tête.
- **Les icônes des flux dans la liste se désactivent séparément** de celles de
  la barre latérale, dans le même groupe que « nom du flux » et « dates ».
- **Dans les préférences, « Accent » ouvre la liste des couleurs** — c'est
  celle qu'on vient changer en premier.

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

## Sous le capot

- Le passage d'un article à l'autre se fait avec un léger mouvement, dans le
  sens de la navigation ; la bascule du squelette vers le texte se fond au lieu
  de clignoter ; les dix premières lignes d'une liste se déposent au lieu
  d'arriver en bloc ; et le compteur de non-lus marque le coup quand il change.
  Tout est désactivé si le système demande un mouvement réduit.
- Ouvrir un article depuis la vue deux colonnes ou la grille fait grandir son
  titre jusqu'à sa place dans le volet de lecture, au lieu de le faire
  disparaître d'un côté et réapparaître de l'autre. Les navigateurs qui ne
  savent pas le faire n'affichent simplement rien de particulier.
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
