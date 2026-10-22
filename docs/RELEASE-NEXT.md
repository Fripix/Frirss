# 1.7.0 — en préparation

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
  dit l'état (« Résumé en cours… », « Résumé par X »…) et porte l'action
  « Résumer », puis « Résumer avec… » ; tant qu'il n'y a rien à montrer, le
  panneau tient sur une seule ligne compacte (titre et « Résumer ») ; replier le panneau est mémorisé pour
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
  résument l'article ouvert. Quand le repli n'a pas joué (réponse inexploitable,
  refus, ou repli éteint), l'alerte propose « Réessayer avec X », le
  fournisseur suivant de la liste, et le réglage du repli dit ce qu'il fait et
  ne fait pas.

  **Traductions.** « Traduire », à côté de « Résumer avec… », traduit le
  résumé vers la langue cible ; « Traduire », dans la barre
  d'outils, traduit le titre et le corps affiché, par lots, avec une notice
  pendant l'attente (« Lot 2 sur 4… »), puis une discrète puce « Traduit par X » dans les
  métadonnées de l'article (le bandeau ne reste que pour une bascule ou une traduction
  partielle) et « Texte source » pour
  revenir à l'original sans nouvel appel. Le résumé peut aussi se traduire
  tout seul dès qu'il s'affiche : interrupteur « Traduire le résumé
  automatiquement » (éteint d'origine) et colonne « Résumé traduit » par flux
  et catégorie ; c'est toujours le cas quand l'article lui-même est traduit
  automatiquement. Un chevron (un appui long au doigt,
  ou la feuille « … ») ouvre « Traduire en… » — 28 langues, filtrables — et
  « Traduire avec… », qui force un fournisseur sans couper le repli. Un résumé
  déjà dans la langue cible garde « Traduire », qui répond « Déjà en français. »
  sans rien envoyer ; un article déjà dans la langue le dit (« Déjà en
  français. ») après un seul appel, même si le modèle l'a traduit quand même,
  ensuite servi par le cache. Un passage trop
  lourd pour un lot reste dans la langue d'origine, et la notice le dit (« Traduit en partie (n lots sur m) »). Un lot a le temps que demande sa longueur (jusqu'à 110 s), et un lot coupé faute de temps a une seconde chance, en deux moitiés — y compris quand c'est un reverse proxy en amont qui le coupe ; si une moitié l'est encore, un message dit d'accorder au moins 120 s à /api/ai (le README donne les deux lignes à ajouter). Une réponse inexploitable (un Ollama au contexte trop court tronque un gros lot) ne bascule plus vers un autre fournisseur, peut-être payant : le lot est rejoué en deux moitiés sur le même (le README recommande `OLLAMA_CONTEXT_LENGTH=16384`) ; une « traduction » qui recopie la source (un petit modèle renvoie parfois l'anglais tel quel) est traitée de même, au lieu d'être affichée comme traduite et mise en cache — et le message dit alors quoi faire (réessayer, ou choisir un autre fournisseur via « Traduire avec… »). Les segments voyagent entre des balises `<seg>`, qu'aucun modèle ne prend pour sa fin de séquence : un 7b d'Ollama (Qwen, Llama) traduit le lot entier au lieu de s'arrêter au premier segment. Les
  échecs ont leurs propres messages : « La traduction a échoué. Réessayez. »,
  « Le fournisseur a refusé de traduire cet article. », « Texte trop long pour
  être traduit. », « Le fournisseur n'a pas rendu une traduction exploitable (texte recopié ou
  coupé). Réessayez, ou choisissez un autre fournisseur via « Traduire
  avec… ». » et « Langue non proposée. ». Nouveau bloc « Traduction » dans
  Préférences → IA : langue cible (celle de l'interface par défaut) et
  fournisseur des traductions (« Même que le résumé » par défaut). Allumer la
  traduction automatique (« Par flux et catégorie », voir plus bas) demande une confirmation, une fois par compte, qui
  rappelle qu'un article entier coûte cinq à quinze fois un résumé. Le plafond
  quotidien compte les « appels IA », résumés et traductions ensemble (un par
  lot traduit), et ses messages le disent. Le raccourci `t` (réassignable,
  masqué tant que l'IA est inutilisable) et la palette ⌘K traduisent l'article
  ouvert. Aucun choix IA qui engage un coût ne passe d'un compte à l'autre sur
  un navigateur partagé. Une traduction d'article affichée revient quand on
  rouvre l'article sur le même appareil, sans rien coûter (elle vient du cache
  du serveur ; « Texte source » l'oublie).

  **Préférences › IA.** Pour l'admin, le bloc « Fournisseurs » ouvre la
  section, avant « Résumés » (sans fournisseur, rien d'autre ne marche) ;
  une ligne par fournisseur dans une liste bordée — nom, badge « par défaut »,
  type en étiquette courte, modèle et « clé enregistrée », puis « Tester »,
  « Modifier » et un menu « ⋯ » (feuille du bas au doigt) qui porte Monter,
  Descendre, Définir par défaut et Supprimer ; la liste déroulante
  « Fournisseur par défaut » a disparu. « Par flux et catégorie » se lit
  comme un tableau : une ligne par catégorie et une ligne par flux, jamais
  deux, sous un seul en-tête de colonnes (Résumer, Traduire, Résumé traduit,
  Panneau, IA),
  précédé d'une clé en deux parties : un petit tableau à filets qui donne
  pour chaque colonne son icône, son nom et ce qu'elle fait, puis, dans une
  bande à part, ce que montre chaque bouton — Activé (plein), Hérité
  (cerclé), Désactivé (gris) — et la règle de priorité (un flux l'emporte sur
  sa catégorie, une catégorie sur les réglages généraux). Chaque catégorie est une bande grisée en gras, avec son
  nombre de flux et, en couleur, combien ont leurs propres réglages ;
  dépliée, elle montre ses flux, en retrait, avec leur favicon. Les
  réglages sont des boutons à icône : plein quand le réglage est fait ici,
  cerclé quand il vient de la catégorie ou du réglage global, une infobulle
  le dit. Les trois colonnes héritent de la même façon : une catégorie
  sans réglage propre montre le réglage général (résumé automatique comme
  panneau), et peut s'éteindre sous un réglage général allumé. Le fournisseur se choisit dans un menu (une feuille du bas au
  doigt) ; sur un téléphone, il se réduit à une icône, marquée d'un point
  quand la ligne a le sien, les colonnes sont réduites à leurs seules icônes
  pour que le nom d'un flux reste lisible, et chaque ligne garde 44 px de haut au doigt. Allumer Résumer ou Traduire demande toujours la
  confirmation de coût, une fois par compte. L'éditeur s'ouvre sous la liste, titré
  « Nouveau fournisseur » ou « Modifier X », ses champs sur une colonne, le partage de la clé en interrupteur. « Les utilisateurs peuvent
  saisir leur propre clé » et le plafond quotidien par utilisateur sont
  affichés à plat, sous l'éditeur. Le
  panneau « Résumé IA » tient sur une seule ligne compacte (titre et
  « Résumer », aucun état ; ≈ 42 px sur téléphone, le bouton aéré, avec une
  zone de toucher de 44 px) tant qu'il n'y a ni résumé, ni demande en cours, ni erreur ; le repli
  mémorisé joue dès la première demande. Le panneau se distingue de l'article :
  filet d'accent à gauche, texte du résumé un cran plus petit et plus serré,
  teinte un peu plus marquée. Dans la barre d'outils, le repli des libellés
  se mesure au lieu de se deviner par des seuils de largeur : d'abord Étiquettes,
  Partager et Original passent en icônes, puis tous les libellés si la barre
  déborde encore.
  **Panneau « Résumé IA » facultatif.** Un interrupteur « Panneau Résumé IA
  toujours visible » (Préférences → IA → Résumés, allumé d'origine) permet de ne
  le montrer qu'avec une demande ou un résumé : un bouton « Résumer » prend
  sa place dans la barre d'outils (sur téléphone et tablette tactile : première
  rangée de la feuille « … »), et la
  touche `s` ou la palette le font apparaître comme lui ; le panneau disparaît
  à l'article suivant.
  Le réglage est synchronisé ; il se précise par flux et par catégorie, avec la
  colonne « Panneau » de « Par flux et catégorie » (un flux prime sur ses
  catégories, qui priment sur le global).
- **Deux onglets, un seul appel IA.** Quand le même résumé ou le même lot de
  traduction est demandé pendant qu'il est en cours de génération — depuis un
  autre onglet ou un autre appareil du même compte —, le serveur rattache la
  seconde demande à la première au lieu de rappeler le modèle : un seul appel
  payé, une seule unité du plafond (un résumé ainsi partagé s'affiche
  « depuis le cache » ; une traduction ne dit rien de plus).
- **« Régénérer » et « Retraduire ».** Le menu « Résumer avec… » se termine par
  « Régénérer », et le menu de traduction (résumé et article) par
  « Retraduire » quand une traduction est affichée : la demande repart chez
  le même fournisseur (et dans la même langue), sans le cache, dont le
  nouveau résultat prend la place. Un clic, un appel payé, une unité du
  plafond ; ni raccourci ni consigne libre. Les entrées n'apparaissent que si
  ce fournisseur est encore disponible, et un « Retraduire » raté laisse la
  traduction affichée, avec le message d'erreur.

## Corrections et améliorations

- **Le tiroir des flux ne s'ouvre plus tout seul** au chargement sur téléphone ou tablette, ni en passant du bureau au téléphone. La préférence de la barre latérale du bureau n'est pas touchée.

- **Un fichier absent répond 404**, plus l'application en 200 : `/.env`, `/.git/HEAD` ou `/x.js.map` ne ressemblent plus à des fichiers existants. Les routes de l'application, elles, n'ont pas changé.

- **Les compteurs d'étiquettes se lisent au lecteur d'écran** : « 12 articles ». C'est le total de l'étiquette, lus compris — pas un compte de non-lus.

- **Les erreurs de `/api` sont du JSON.** Une route inconnue donne `404 not_found`, un corps mal formé `400 invalid_json`, un corps trop gros `413 payload_too_large` — au lieu des pages HTML « Cannot GET » et « Bad Request » d'Express.

- **`index.html` est servi en `no-cache`** : un déploiement est vu au chargement suivant, sans qu'un ancien document n'appelle des bundles disparus. Les ressources hachées restent en cache un an.

- **Les compteurs de la barre latérale se lisent correctement au lecteur d'écran** : « Non lus, 3 673 non lus » au lieu de « Non lus3673 ». Aucun changement visuel.

- **Les pages en ISO-8859-1 ne ressortent plus criblées de « � » en
  « Article complet ».** L'extraction côté serveur lisait toute page en UTF-8 :
  un site qui déclare `charset=iso-8859-1` (developpez.com, avec en prime une
  virgule à la place du point-virgule dans l'en-tête) donnait « a rapport� ».
  Le jeu de caractères est maintenant lu dans l'en-tête, sinon dans la balise
  `<meta>`, sinon UTF-8.

- **Les liens d'un article s'ouvrent dans un nouvel onglet** (issue #24). Un
  clic sur un lien du corps remplaçait FriRSS par la page visée — et en app
  installée, sans barre d'adresse, il n'y avait plus de retour. Chaque lien du
  corps porte maintenant `target="_blank"` ; les ancres internes de
  l'article restent dans la page.

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
- **Une connexion ratée n'écrase plus les préférences synchronisées.** Si la
  lecture des préférences échouait à la connexion (réseau, erreur 5xx), FriRSS
  prenait le compte pour un compte neuf et y écrivait l'état local du
  navigateur — des valeurs par défaut après une déconnexion — sur tous les
  appareils. Un échec ne change plus rien : la lecture est retentée et la
  première réussie décide.
- **Les raccourcis ne volent plus les touches du navigateur.** ⌘R / Ctrl+R
  marquait l'article lu au lieu de recharger la page, et ⌘/Ctrl avec L, D, B,
  O, U ou F (et Alt + lettre) déclenchait aussi une action FriRSS. Une touche
  tenue avec ⌘, Ctrl ou Alt revient désormais au navigateur (seul ⌘K / Ctrl+K
  ouvre toujours la palette), et une touche maintenue ne bascule plus favori,
  « à lire plus tard » ou le panneau latéral à chaque répétition.
- **L'éditeur de raccourcis refuse les touches réservées**, avec un message :
  F1–F12, Tab, Espace, Entrée, un modificateur seul, `/` et `'` (recherche
  rapide de Firefox), `?` (aide-mémoire), une combinaison avec ⌘, Ctrl ou Alt,
  et une touche déjà attribuée à une autre action. Les flèches restent
  permises.

## Sous le capot

- **Le texte barré part au modèle en `<del>`, pas en `<s>`.** `</s>` est une
  chaîne de fin de séquence pour les tokenizers Llama et Qwen : un article qui
  portait du texte barré pouvait faire s'arrêter un modèle Ollama au milieu du
  lot. Le barré voyage donc en `<del>` et reste `<del>` dans la traduction.
- **Image de branche** : un lancement manuel du workflow de publication sur une branche autre que `main` et `dev` publie `:sha-…` et `:<branche>` (nom assaini), en amd64 seulement.

## Actions requises à la mise à jour

_(aucune)_

## Documentation

_(rien pour l'instant)_
