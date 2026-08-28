# 1.4.3 — en préparation

Journal des changements du cycle en cours, tenu au fil de l'eau. Il alimente les
notes de la release GitHub et les corrections du README, puis se vide une fois
la release publiée.

## Fonctionnalités

- **Gestion des serveurs FreshRSS dans Préférences → Flux.** Ajouter, renommer,
  définir par défaut, supprimer et basculer se font désormais depuis un écran
  atteignable en toutes circonstances. La barre du haut reste un sélecteur ; son
  `+` et son clic droit y mènent. *Corrige un défaut où masquer la barre du haut
  rendait la gestion — et la bascule elle-même — inaccessible, et où renommer,
  définir par défaut et supprimer n'existaient tout simplement pas dans la PWA
  iOS, faute de clic droit.*
- **Jeton maître par serveur.** Il se configure et s'éprouve depuis la ligne de
  n'importe quel serveur, sans avoir à basculer dessus.
- **Sauvegarde et restauration chiffrées.** Un fichier téléchargeable contenant
  tout ce que FriRSS sait de lui-même — comptes et mots de passe, serveurs et
  leurs jetons, préférences, réglages d'instance —, protégé par une phrase de
  passe obligatoire de 12 caractères minimum. Restaurable depuis Administration
  ou depuis l'écran de première installation. Le contenu FreshRSS (articles,
  flux, états de lecture) n'y est pas : il vit dans FreshRSS.

## Corrections et améliorations

- **Le panneau Préférences ne se reconstruit plus à chaque changement de
  section.** Flux et Administration repayaient un aller-retour réseau complet,
  écran vide, à chaque visite. Mesuré après correction : zéro requête sur trois
  allers-retours.
- **Écran de première installation** : la note sur le compte administrateur et
  le lien de restauration sont passés sur une surface lisible, au lieu de
  flotter sur l'animation de fond.
- **Formulaire de restauration lisible partout.** Il empruntait la palette du
  panneau d'Administration, qui est claire, y compris sur l'écran de connexion,
  qui est sombre : texte presque noir sur fond presque noir, bordures blanches,
  champ blanc au milieu d'une carte sombre. Chaque écran décrit désormais sa
  propre surface.
- **Sélecteur de fichier repensé.** Il se lisait comme un champ de saisie vide,
  et le nom du fichier choisi s'affichait à côté, détaché. C'est maintenant un
  seul contrôle qui porte son état : bordure tiretée en attente, trait plein et
  nom du fichier une fois choisi, cliquable de nouveau pour le remplacer.

- **Se reconnecter après une restauration fonctionne du premier coup.** La
  restauration armait une déconnexion différée de 1,5 s qu'aucun démontage
  n'annulait. Comme la suppression des sessions renvoie l'utilisateur à l'écran
  de connexion bien avant ce délai, une reconnexion rapide était détruite par ce
  minuteur périmé : il fallait s'y reprendre à deux ou trois fois.
- **Les messages d'erreur de connexion ne mentent plus.** Toute panne — limite
  de cadence, erreur serveur, coupure réseau — annonçait « identifiants
  incorrects », ce qui envoyait retaper indéfiniment un mot de passe pourtant
  juste. Seul un refus d'authentification le dit désormais ; les autres cas ont
  leur propre message.
- **Restaurer sur une instance déjà configurée le dit.** Ce refus s'affichait
  « L'opération a échoué. Réessayez. » — un conseil qui ne pouvait pas
  fonctionner, puisque réessayer rendait le même refus.

- **Rubriques d'Administration lisibles d'un coup d'œil.** Cinq groupes sans
  rapport entre eux n'étaient séparés que par du blanc et un libellé gris plus
  petit et plus pâle que le contenu qu'il annonçait — un titre plus discret que
  son propre contenu ne titre rien. Les titres sont désormais les plus gros et
  les plus sombres de la rubrique, portent un repère accentué que le contenu ne
  produit jamais, et l'écart qui les sépare du groupe précédent est trois fois
  celui qui les rattache au leur. La séparation vient de la hiérarchie et de la
  proximité, pas de filets supplémentaires.
- **La vérification d'une sauvegarde se voit.** Le bouton affiche un compteur
  pendant le travail, et l'aperçu — qui se dépliait plus bas sans rien
  signaler — s'annonce par un liseré accentué, se fait lire par les
  technologies d'assistance et vient sous les yeux.
- **Paquets Alpine mis à jour à la construction de l'image.** Docker Scout
  signalait 10 vulnérabilités sur `fripix/frirss:latest`, toutes sur le même
  paquet — l'openssl fourni par `node:24-alpine`, contre lequel nginx est lié —
  et toutes déjà corrigées en amont. L'image de base est reconstruite à son
  propre rythme : ses paquets ont l'âge de sa dernière reconstruction. Un `apk
  upgrade` en début d'étape de production récupère les correctifs de la branche
  qu'elle épingle déjà, au niveau du correctif uniquement.

- **Traductions** : 25 clés mortes retirées des 9 locales (dont toute la
  famille `shortcutBar`, orpheline depuis une refonte), et deux compteurs
  passés en vraies formes plurielles — le polonais et l'ukrainien recevaient
  « utilisateur(ów) » là où leur grammaire réclame quatre formes.

## Actions requises à la mise à jour

Aucune. Aucune variable d'environnement nouvelle, aucune migration manuelle.

## Incidence sur le README

- **À faire** : le README ne mentionne pas la sauvegarde. Sur un produit
  auto-hébergé, « comment je sauvegarde ? » est une des premières questions.
