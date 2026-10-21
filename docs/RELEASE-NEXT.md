# 1.6.2 — en préparation

Journal des changements du cycle en cours, tenu au fil de l'eau. Il alimente les
notes de la release GitHub et les corrections du README, puis se vide une fois
la release publiée.

> **À tenir à jour au moment du commit, pas à la fin du cycle.** Pour la 1.4.3,
> six correctifs manquaient à l'appel : le journal avait été rempli pour les
> gros morceaux et oublié pendant les finitions. Ils n'ont été retrouvés qu'en
> relisant les 57 commits. Contre-vérification utile avant de publier : differ
> `src/locales/en.json` contre le tag précédent — toute chaîne d'interface
> ajoutée ou modifiée doit correspondre à une entrée écrite ici.
>
> **Les commits sans chaîne d'interface échappent à cette contre-vérification.**
> Pour la 1.4.12, le menu du clic droit passé aux icônes et groupes, et le
> correctif de la feuille du bas sur iOS, manquaient tous deux au journal : ni
> l'un ni l'autre n'avait touché `en.json`. Relire aussi `git log`.

## Fonctionnalités

- **Résumés et traductions par IA** (discussion #22). Un panneau repliable « Résumé IA », en
  tête du volet de lecture, envoie l'article au fournisseur que l'admin a
  déclaré (Claude, ou tout service compatible OpenAI dont Ollama) et affiche le
  résumé au-dessus de l'article, sur toute la largeur de la colonne. L'en-tête
  dit l'état (« Pas encore résumé », « Résumé par X »…) et porte l'action
  « Résumer », puis « Résumer avec… » ; replier le panneau est mémorisé pour
  tous les articles et synchronisé entre appareils. Sa surface teintée se règle
  dans Apparence → Couleurs → Lecture (« Résumé IA, fond » / « bordure »),
  avec une teinte propre à chaque thème livré. Éteint d'origine ; nouvelle
  section « IA » des Préférences avec un bloc « Résumés » pour chacun (longueur
  visée du résumé, de 5 à 50 % de l'article, 20 % par défaut, jamais moins de
  trois phrases) et le bloc admin « Fournisseurs » (interrupteur, fournisseurs,
  clé partagée, test de connexion, plafond quotidien, et un bouton « Lister les
  modèles » qui propose les noms disponibles avec la clé saisie, avant même
  d’enregistrer). Repli automatique entre fournisseurs, cache
  des résumés, clés chiffrées, aucune dépendance nouvelle ; la sauvegarde
  chiffrée emporte les fournisseurs et leurs clés. Chacun choisit son
  fournisseur préféré et le repli, peut demander un résumé automatique à
  l'ouverture de chaque article (éteint d'origine, avec un avertissement sur le
  coût d'un appel par article), fixe un fournisseur par flux ou par catégorie
  dans une vue d'ensemble, et saisit ses propres clés quand l'admin le permet ;
  l'admin peut effacer la clé d'un fournisseur. Le raccourci `s`
  (réassignable, masqué tant que l'IA est inutilisable) et la palette ⌘K
  résument l'article ouvert.

  **Traductions.** « Traduire », à côté de « Résumer avec… », traduit le
  résumé vers la langue cible ; « Traduire l'article », dans la barre
  d'outils, traduit le titre et le corps affiché, par lots, avec une notice
  (« Lot 2 sur 4… », « Traduit en anglais par X ») et « Texte source » pour
  revenir à l'original sans nouvel appel. Un chevron (un appui long au doigt,
  ou la feuille « … ») ouvre « Traduire en… » — 28 langues, filtrables — et
  « Traduire avec… », qui force un fournisseur sans couper le repli. Un résumé
  déjà dans la langue cible ne propose pas « Traduire » ; un article déjà dans
  la langue le dit (« Déjà en français. ») après un seul appel, même si le
  modèle l'a traduit quand même, ensuite servi par le cache. Un passage trop
  lourd pour un lot reste dans la langue d'origine, et la notice le dit (« Traduit en partie (n lots sur m) »). Un lot a le temps que demande sa longueur (jusqu'à 110 s), si bien qu'un modèle local lent n'est plus coupé au milieu d'un long article. Les
  échecs ont leurs propres messages : « La traduction a échoué. Réessayez. »,
  « Le fournisseur a refusé de traduire cet article. », « Texte trop long pour
  être traduit. », « Le fournisseur n'a pas rendu une traduction exploitable.
  Réessayez. » et « Langue non proposée. ». Nouveau bloc « Traduction » dans
  Préférences → IA : langue cible (celle de l'interface par défaut) et
  fournisseur des traductions (« Même que le résumé » par défaut). La vue
  « Par flux et catégorie » gagne deux interrupteurs par ligne, « Résumer » et
  « Traduire » à l'ouverture, un flux primant sur sa catégorie ; allumer la
  traduction automatique demande une confirmation, une fois par compte, qui
  rappelle qu'un article entier coûte cinq à quinze fois un résumé. Le plafond
  quotidien compte les « appels IA », résumés et traductions ensemble (un par
  lot traduit), et ses messages le disent. Le raccourci `t` (réassignable,
  masqué tant que l'IA est inutilisable) et la palette ⌘K traduisent l'article
  ouvert. Aucun choix IA qui engage un coût ne passe d'un compte à l'autre sur
  un navigateur partagé.

## Corrections et améliorations

- **Les blocs `<pre>` et `<picture>` étaient cassés par l'ajout de
  `dir="auto"` depuis la 1.4.0.** Le motif qui donne sa direction à chaque
  bloc n'avait pas de borne après le nom de balise : un bloc de code devenait
  un paragraphe (`<p dir="auto"re>`) et perdait sa mise en forme et ses
  espaces, une `<picture>` perdait son conteneur. La direction par bloc et le
  chargement différé des images sont désormais posés sur l'arbre assaini, plus
  par motif sur le HTML : ils ne peuvent plus toucher l'intérieur d'une valeur
  d'attribut.
- **La réservation de place des images et le ménage des paragraphes vides
  pouvaient réécrire le balisage après l'assainissement.** Eux aussi
  travaillaient par motif sur le HTML déjà assaini : un `<img` écrit dans la
  valeur d'un attribut (un `title`, un `alt`) recevait un `style` dont le
  guillemet refermait la valeur — de quoi faire d'un `onmouseover` un vrai
  attribut sur les navigateurs qui n'échappent pas `<` dans les attributs —,
  et un paragraphe « vide » pouvait avaler l'image et le texte qui le
  suivaient. Les deux se font désormais sur l'arbre assaini, y compris pour
  l'aperçu de l'article voisin pendant un balayage.

## Sous le capot

- **Image de branche** : un lancement manuel du workflow de publication sur une branche autre que `main` et `dev` publie `:sha-…` et `:<branche>` (nom assaini), en amd64 seulement.

## Actions requises à la mise à jour

_(aucune)_

## Documentation

_(rien pour l'instant)_
