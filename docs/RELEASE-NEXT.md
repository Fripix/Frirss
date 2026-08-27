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

## Actions requises à la mise à jour

Aucune. Aucune variable d'environnement nouvelle, aucune migration manuelle.

## Incidence sur le README

- **À faire** : le README ne mentionne pas la sauvegarde. Sur un produit
  auto-hébergé, « comment je sauvegarde ? » est une des premières questions.
