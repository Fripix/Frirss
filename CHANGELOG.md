# Changelog

All notable changes to FriRSS. Each entry is a summary — the full notes for a
release live on its [release page](https://github.com/Fripix/Frirss/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
FriRSS follows [semantic versioning](https://semver.org/).

## [1.7.0] - 2026-10-23

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
  automatiquement » (éteint d'origine) et colonne « Résumé FR » par flux
  et catégorie ; c'est toujours le cas quand l'article lui-même est traduit
  automatiquement — **y compris pour les flux et catégories déjà réglés sur
  « Traduire »** : leurs résumés dans une autre langue partent désormais en
  traduction, un court appel de plus par résumé, sans nouvelle confirmation. Un chevron (un appui long au doigt,
  ou la feuille « … ») ouvre « Traduire en… » — 28 langues, filtrables — et
  « Traduire avec… », qui force un fournisseur sans couper le repli. Un résumé
  déjà dans la langue cible garde « Traduire », qui répond « Déjà en français. »
  sans rien envoyer ; un article déjà dans la langue le dit (« Déjà en
  français. ») après un seul appel, même si le modèle l'a traduit quand même,
  ensuite servi par le cache. Un passage trop
  lourd pour un lot reste dans la langue d'origine, et la notice le dit (« Traduit en partie (n lots sur m) »). Un lot a le temps que demande sa longueur (jusqu'à 110 s), et un lot coupé faute de temps a une seconde chance, en deux moitiés. Quand la réponse se perd en route (reverse proxy qui coupe, téléphone mis en arrière-plan, réseau qui change), le même lot est d'abord redemandé entier, sans rien payer de plus : le serveur, qui a continué, le sert de son cache ou y rattache la demande ; ce n'est qu'en cas de nouvel échec qu'il est coupé en deux. Si un proxy coupe encore, un message dit d'accorder au moins 120 s à /api/ai (le README donne les deux lignes à ajouter) ; si la connexion s'est simplement interrompue, le message le dit, sans accuser un proxy. Une réponse inexploitable (un Ollama au contexte trop court tronque un gros lot) ne bascule plus vers un autre fournisseur, peut-être payant : le lot est rejoué en deux moitiés sur le même (le README recommande `OLLAMA_CONTEXT_LENGTH=16384`) ; une « traduction » qui recopie la source (un petit modèle renvoie parfois l'anglais tel quel) est traitée de même, au lieu d'être affichée comme traduite et mise en cache — et le message dit alors quoi faire (réessayer, ou choisir un autre fournisseur via « Traduire avec… »). Les segments voyagent entre des balises `<seg>`, qu'aucun modèle ne prend pour sa fin de séquence : un 7b d'Ollama (Qwen, Llama) traduit le lot entier au lieu de s'arrêter au premier segment. Les
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
  deux, sous un seul en-tête de colonnes (Résumer, Traduire, Résumé FR — la
  langue cible —, Panneau, IA),
  précédé d'une clé en deux parties : un petit tableau à filets qui donne
  pour chaque colonne son icône, son nom et ce qu'elle fait, puis, dans une
  bande à part, ce que montre chaque bouton — Désactivé (plein gris), Activé
  (plein vert), Hérité (cerclé) — et la règle de priorité (un flux l'emporte
  sur sa catégorie, une catégorie sur les réglages généraux). Chaque clic
  passe à l'état suivant, désactivé → activé → hérité : une catégorie ou un
  flux retrouve l'héritage d'un clic. Chaque catégorie est une bande grisée en gras, avec son
  nombre de flux et, en couleur, combien ont leurs propres réglages ;
  dépliée, elle montre ses flux, en retrait, avec leur favicon. Les
  réglages sont des boutons à icône : plein quand le réglage est fait ici,
  cerclé quand il vient de la catégorie ou du réglage global, une infobulle
  le dit. Les trois colonnes héritent de la même façon : une catégorie
  sans réglage propre montre le réglage général (résumé automatique comme
  panneau), et peut s'éteindre sous un réglage général allumé. Le fournisseur se choisit dans un menu (une feuille du bas au
  doigt) ; sur un téléphone, il se réduit à une icône, marquée d'un point
  quand la ligne a le sien, les colonnes sont réduites à leurs seules icônes
  pour que le nom d'un flux reste lisible, et chaque ligne garde 44 px de haut au doigt. Allumer Résumer ou Traduire demande la
  confirmation de coût, une fois par compte (pas pour Résumer quand le résumé
  automatique général est déjà allumé). L'éditeur s'ouvre sous la liste, titré
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
- **Les raccourcis se taisent derrière une fenêtre, dans une liste et dans un
  menu ouvert.** Au bureau, le volet de lecture reste monté derrière les
  Préférences : `r`, `d`, `l` ou `s` agissaient sur l'article caché, et la
  saisie rapide d'une liste déroulante pouvait déclencher `s` — un résumé,
  peut-être payant. De même, `t` ou les flèches ne partent plus depuis « Traduire
  en… » ou « Résumer avec… ». `?` referme aussi l'aide-mémoire.
- **Préférences › IA, côté admin** : un double-clic sur « Enregistrer » ne
  crée plus deux fournisseurs ; un enregistrement lent ne ramène plus
  l'éditeur sur le fournisseur précédent ; « Enregistré » disparaît dès qu'on
  modifie à nouveau ; une clé collée avec un espace ou un retour est nettoyée ;
  le plafond quotidien tapé puis Préférences fermées à Échap n'est plus perdu
  (Entrée l'enregistre aussi).
- **L'IA ne disparaît plus pour la session** quand sa configuration n'a pas pu
  être chargée au démarrage (réseau instable) : elle est redemandée au retour
  du réseau ou de l'app.
- **Les nouveaux raccourcis ne volent pas une touche déjà prise** : si vous
  aviez donné `s` ou `t` à une autre action, « Résumer » ou « Traduire »
  arrive sans touche (« Aucune touche » dans les Préférences, à régler) au lieu
  de rester muet.
- **Fermer le tiroir des flux sur téléphone ou tablette ne masque plus la
  barre latérale de l'ordinateur** (iPad qu'on tourne, fenêtre redimensionnée,
  disposition forcée).
- **Espagnol : un seul registre.** L'interface vouvoyait et tutoyait selon les
  écrans ; elle vouvoie partout (« usted »), comme le français.
- **Le compte d'une catégorie se lit au lecteur d'écran** (« 70 non lus »,
  plus seulement « 70 »).
- **« Résumer » et « Traduire » attendent l'article complet.** Demandés
  pendant son extraction, ils partaient sur l'aperçu du flux — un résumé du
  chapô, ou une traduction jetée à l'arrivée de l'article : un appel perdu,
  peut-être payant. Ils attendent maintenant l'extrait (« Résumé… »,
  « Traduction… ») puis partent d'eux-mêmes. La palette ne propose plus
  « Résumer » quand un résumé est déjà affiché ou en cours, ni hors ligne.
- **Une modale cachée dans un article ne coupe plus les raccourcis.** Un
  article (ou sa page extraite) qui embarque une fenêtre de newsletter en
  `role="dialog"` désactivait tous les raccourcis tant qu'il restait ouvert.
- **L'extraction automatique ne saute plus d'article.** Passer à l'article
  suivant pendant qu'un « Article complet » se chargeait laissait le suivant
  sans extraction (et donc sans résumé automatique) ; et revenir à un article
  après en avoir lu un sans extrait n'affichait plus le sien.
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
- **Une requête piégée ne peut plus bloquer le serveur.** Le décompte des
  mots d'un segment à traduire utilisait un motif quadratique sur une suite de
  `<` sans `>` : 200 Ko envoyés à `/api/ai/translate` par n'importe quel
  compte connecté figeaient le serveur ≈ 17 s, pour tout le monde. Le motif
  est linéaire, côté serveur comme dans les copies du navigateur (un flux
  hostile pouvait y figer l'onglet).
- **Une clé ne part jamais vers un autre hôte.** Changer l'adresse ou le type
  d'un fournisseur efface sa clé enregistrée et celles des utilisateurs —
  l'éditeur le dit avant d'enregistrer et demande la clé du nouvel hôte.
  Avant, elles partaient vers la nouvelle adresse au premier appel.
- **Sécurité des dépendances** : DOMPurify 3.4.17 (GHSA-cg2g-xh64-v4q7,
  GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f — FriRSS n'utilise aucune des
  options concernées, mise à jour par principe) et follow-redirects 1.16.1
  (CVE-2026-111755, CVE-2026-111756). `npm audit --omit=dev` : 0.
- **Outils de développement à jour** : vitest 4.1.12 (avis sur vitest,
  tinypool, esbuild, vite), correctifs mineurs de `npm audit fix`, et
  `postcss-selector-parser` 7.1.7 forcé sous Tailwind 3 (CSS produit identique
  à l'octet). Reste `braces` (via Tailwind 3), sans version corrigée : n'en
  sortir qu'avec Tailwind 4 ; il ne sert qu'à la construction, sur nos propres
  motifs. Rien de cela n'est dans l'image publiée.
- **Paquets Alpine de l'image toujours à jour** : la couche `apk upgrade` est
  refaite au moins une fois par jour (`APK_REFRESH`) ; le cache de build la
  gardait tant que l'image de base ne changeait pas, et l'image portait encore
  nginx 1.30.4 (six avis, dont trois élevés) alors qu'Alpine livrait la 1.30.6.
- **nginx du conteneur** : `proxy_read_timeout 120s` sur `/api/` (60 s par
  défaut), pour qu'une longue demande à l'IA ne soit pas coupée en route.
- **Image de branche** : un lancement manuel du workflow de publication sur une branche autre que `main` et `dev` publie `:sha-…` et `:<branche>` (nom assaini), en amd64 seulement.

## Actions requises à la mise à jour

_(aucune)_

## Documentation

- **README** : une section « AI summaries and translations » (ce que fait
  l'IA, les fournisseurs, les réglages par flux et catégorie, le cache) ;
  douze raccourcis au lieu de dix ; **Redis fortement recommandé** (sans lui,
  rien n'est préchargé et le cache IA vit dans SQLite, plafonné à 10 000
  entrées) ; le paragraphe du reverse proxy dit que le lot coupé est d'abord
  redemandé entier.

## [1.6.1] - 2026-10-15

## Corrections et améliorations

- **Connexion OIDC derrière un SSO tiers (issue #23).** Le callback OIDC
  échouait avec `URIError: URI malformed` dès qu'un cookie du domaine (Authelia
  derrière SWAG, par exemple) portait une séquence `%` invalide : le parseur
  de cookies décodait chaque valeur sans tolérance. Une valeur indécodable est
  maintenant gardée telle quelle ; seuls `oidc_verifier` et `oidc_nonce` sont
  lus, et eux sont toujours bien encodés. Parseur extrait dans
  `server/cookies.ts`, testé.
- **« Ouvrir à la source » est un lien (issue #21).** Dans les modes liste et
  grille, l'icône était un bouton sans `href` : les extensions de
  prévisualisation d'URL et « copier l'adresse du lien » ne la voyaient pas.
  C'est désormais un `<a href>` vers l'article ; le clic garde le comportement
  d'avant (nouvel onglet puis sélection de l'article), sans double ouverture.
- **Connexion SSO derrière un split-DNS.** Depuis la 1.4.4, la découverte OIDC
  passait par la garde anti-SSRF, qui refusait l'émetteur dès que son nom
  public se résolvait en IP privée depuis le conteneur (cas typique : le
  fournisseur d'identité derrière le même reverse proxy, sur le même réseau).
  Toute connexion SSO échouait alors en `login_failed`, sans explication.
  L'hôte de l'émetteur, fixé par l'administrateur, est désormais de confiance
  pour la garde ; et l'échange du code et `userinfo`, jusqu'ici des `fetch`
  hors garde, passent par elle avec la même règle. Une redirection de
  l'émetteur vers un autre hôte interne reste refusée. Décision et coût dans
  `SECURITY.md`.

## Actions requises à la mise à jour

- Aucune. Si vous aviez ajouté l'hôte de votre fournisseur OIDC à
  `PROXY_INTERNAL_HOSTS` pour contourner `login_failed`, vous pouvez le retirer
  (le garder ne change rien).

## [1.6.0] - 2026-10-14

## Fonctionnalités

- **Ordre des articles : plus anciens d'abord.** Réglage global dans
  Préférences → Général (synchronisé), surchargeable par flux depuis le menu
  contextuel du flux, sous le sélecteur de disposition — même moule que la
  disposition par flux. C'est FreshRSS qui livre la liste dans l'autre sens
  (`r=o`), page par page : un tri local n'aurait réordonné que les pages déjà
  reçues. Les deux sens ne partagent ni cache mémoire, ni liste hors-ligne, ni
  cache serveur. « Marquer au-dessus / en dessous » suit l'ordre affiché : en
  liste inversée, « au-dessus » désigne bien les plus anciens. Demandé dans
  l'issue #20.
- **La visibilité par flux de FreshRSS est honorée.** Un flux réglé « afficher
  dans sa catégorie seulement » (ou dans sa propre vue seulement) ne paraît
  plus dans Tous les flux / Non lus, et son compte ne gonfle plus le badge.
  L'accueil charge le flux `org.freshrss/main` de FreshRSS 1.28+ au lieu de
  `reading-list` ; « Tout lu », « au-dessus / en dessous », la recherche et
  l'annulation visent ce même flux, donc un flux de catégorie n'est jamais
  marqué lu depuis l'accueil, y compris sur la vue restaurée à l'ouverture.
  Aucun réglage FriRSS : celui de FreshRSS fait foi. Un FreshRSS plus ancien
  ne change pas de comportement. Demandé dans la discussion #18.
- **Vue à l'ouverture.** Préférences → Général : *Dernière vue* (défaut, le
  comportement d'avant), *Tous les flux* ou *Non lus* — toujours cette vue au
  lancement et au rechargement, quoi qu'on ait consulté avant. Demandé dans
  la discussion #19.
- **Article complet par défaut.** Un réglage global dans Préférences → Général
  (désactivé d'origine), que chaque flux peut surcharger — *Par défaut / Oui /
  Non* — depuis son menu, à la place de l'ancienne case « Article complet
  auto ». Les flux déjà réglés gardent leur choix. Demandé dans la discussion
  #19 ; l'aide du réglage rappelle le coût : une extraction par article ouvert
  ou préparé hors-ligne.

## Corrections et améliorations

- **Mobile : le menu d'un flux n'est plus coupé par le tiroir.** Il était
  rendu dans le tiroir, qui le rognait à son bord droit : les sélecteurs
  « Article complet auto » et « Ordre de ce flux » sortaient du cadre sur un
  iPhone. Le menu flotte maintenant au-dessus du tiroir, entièrement visible.

- **« Tout marquer lu » au bout de la liste.** Avec « Marquer lu au
  défilement », les derniers articles ne sortaient jamais par le haut et
  restaient non lus sans autre recours que la barre d'outils (issue #19, point
  5). Une fois la dernière page chargée, s'il reste des non-lus, la liste se
  termine par une ligne « Fin de la liste » et un bouton « Tout marquer lu » :
  la même action que la barre d'outils, confirmation et Annuler compris. Jamais
  dans Favoris, À lire plus tard, ni pendant une recherche.

- **Le bandeau « Hors ligne » ne recouvre plus l'en-tête.** Fixé en haut de
  l'écran, il masquait sur Android la barre de la liste — titre, recherche,
  filtres — puisqu'aucune safe-area ne l'écartait (discussion #19, capture à
  l'appui ; mesuré à 320 px : l'en-tête entier dessous). Il occupe
  maintenant sa propre rangée sous la bande safe-area, dans les trois
  dispositions, et pousse l'en-tête vers le bas.
- **« Tout lu » dans la vue Non lus vide la liste.** Les lignes restaient
  affichées, passées lues, et il fallait tirer pour rafraîchir ou passer par
  le menu (discussion #19) ; le ✓ d'une seule ligne, lui, la retirait déjà.
  L'état « Tout est lu » s'affiche aussitôt ; le retour en arrière recharge
  la liste.
- **Android : le geste retour revient à la liste.** Depuis un article, le
  balayage depuis le bord gauche (ou le bouton Précédent) fermait l'app ; il
  ferme maintenant ce qui recouvre l'écran — l'article, le tiroir des flux,
  les Préférences — et ne quitte l'app qu'une fois tout refermé. Les
  balayages gauche/droite entre articles sont inchangés. Android seulement ;
  iOS et bureau ne changent pas. Demandé dans la discussion #19.
- **Android, app installée : la barre d'état ne fait plus « fenêtre de
  navigateur ».** Elle prenait la couleur de la barre des serveurs, sombre
  et masquée par défaut sur mobile — noire au-dessus d'un en-tête clair —
  puis l'accent en lecture (discussion #19). Elle prend maintenant la couleur
  de ce qui est juste dessous : l'en-tête de liste, le fond de l'article, ou
  la barre des serveurs si elle est affichée ; Chrome teinte la barre de
  navigation de même. Ce sont des couleurs du thème, déjà réglables. Une
  surface plus claire que ce que Chrome accepte en app installée (luminosité
  > 0,94, mesuré) est ramenée au plafond : `#fafafa` donne `#efefef`, presque
  blanc. iOS inchangé.
- **Android, app installée : le bas des listes est de nouveau atteignable.**
  Chrome donnait à la colonne une hauteur figée de 56 px supérieure à la
  fenêtre : la fin de chaque liste restait hors écran, et le nouveau bouton
  de fin de liste y était coupé. La hauteur vient maintenant de la fenêtre
  réelle, suivie au redimensionnement. Android seulement ; iOS inchangé.

## Sous le capot

- **Trois dépendances de production montées pour vider le panneau Docker Scout.**
  L'image `1.5.0` publiée affichait 17 vulnérabilités (1 critique, 9 hautes,
  5 moyennes, 2 basses), dont 14 venaient de `node_modules` et non de l'image de
  base — un renversement par rapport aux cycles précédents, où les paquets
  Alpine portaient presque tout. `proxy-addr` 2.0.7 → 2.0.8 corrige la critique
  (CVE-2026-90711, score 9.1) : une IP cliente pouvait être usurpée via un
  sous-réseau de confiance IPv6-mappé-IPv4, et c'est cette IP que `trust proxy`
  détermine puis que le plafond de requêtes du proxy prend pour clé. `axios`
  1.19.0 → 1.20.0 solde douze avis (7 hautes, 5 moyennes) et `dompurify`
  3.4.13 → 3.4.16 deux XSS DOM en mode `IN_PLACE`.
- **Le lockfile était la cause, pas `package.json`.** Les intervalles déclarés
  autorisaient déjà les versions corrigées ; `package-lock.json` épinglait les
  anciennes, et la CI construit depuis lui. Un `npm update` des trois paquets a
  donc suffi, sans toucher aux dépendances déclarées. Au passage, la version du
  projet inscrite dans le lockfile, restée à 1.4.10, redevient exacte.
- **Les deux CVE Alpine se règlent par la reconstruction seule** : `zlib`
  1.3.2-r0 → 1.3.2-r1 (CVE-2026-85091) et `pcre2` 10.48-r0 → 10.49-r0
  (CVE-2026-103111) sont déjà publiées dans 3.24, et `apk upgrade` les ramasse
  en tête de l'étape de production.

## [1.5.0] - 2026-09-30

## Fonctionnalités

- **Les résultats de recherche disent pourquoi ils sont là.** Le terme cherché
  est surligné dans le titre et le résumé ; quand il ne figure dans ni l'un ni
  l'autre — la recherche fouille le corps entier des articles, que la liste
  n'affiche pas — le résumé cède la place à l'extrait du corps qui a fait
  sortir l'article.

- **On peut revenir en arrière après un « tout marquer comme lu »** : un bandeau
  « Annuler » rend non lus exactement les articles qui l'étaient — jusqu'à
  25 000, de quoi couvrir les comptes qui suivent beaucoup de flux. Au-delà, la
  boîte de dialogue prévient d'avance que l'action sera définitive. Le bandeau
  final dit combien d'articles sont revenus, et le signale quand il en manque.

- **La barre d'état de la recherche reste affichée une fois le balayage
  terminé** et annonce le nombre de résultats — « lus compris » quand la vue
  filtre les non lus. Elle disparaissait : plus rien ne distinguait alors une
  liste de résultats d'une liste ordinaire, au point de faire croire que la
  recherche ne se lançait pas.

## Corrections

- **« Tout marquer comme lu » demande par une boîte de dialogue** (issue #17,
  signalée par @alasdair64) au lieu de changer le bouton en « Confirmer ? » :
  ce second état tombait sous le curseur, si bien qu'un double-clic le validait
  — et le bouton, voisin de « Non lus » et « Favoris », se lisait comme un
  filtre. La boîte annonce le nombre d'articles et la vue concernée. Le réglage
  « Confirmer avant de tout marquer comme lu » la gouverne toujours : désactivé,
  un clic agit immédiatement, comme avant.

- **La confirmation avant « tout marquer comme lu » est active par défaut.**
  Les installations existantes gardent le réglage qu'elles avaient.

- **« Tout lu au-dessus / en dessous » demande dans la même boîte** que le
  bouton « Tout lu », au lieu de changer l'entrée du menu en « Confirmer ? ».

- **Les écritures longues se voient** : l'annulation affiche son avancement
  dans son propre bandeau — « Annulation… 300/1 200 » et une jauge — au lieu de
  disparaître dès le clic ; la barre du haut couvre le reste.

- **La loupe de la recherche envoie vraiment la recherche.** Elle n'était
  qu'une icône : la recherche ne partait qu'en validant au clavier, et sur les
  claviers logiciels où cette validation ne soumet pas le formulaire, elle
  restait inatteignable.

- **Extraction d'article : les images et les liens relatifs ne cassent plus**
  quand le navigateur extrait lui-même la page (le repli, quand la route
  serveur n'a pas pu répondre). La CSP refusait le `<base>` posé pour résoudre
  ces URLs, qui pointaient alors vers FriRSS au lieu du site d'origine — 404
  sur les images, liens qui ramenaient dans l'application.

## [1.4.12] - 2026-09-25

## Fonctionnalités

- **Un bandeau signale les nouveaux articles.** Quand de nouveaux articles
  arrivent dans la vue affichée, un bandeau pleine largeur « ↑ N nouveaux
  articles » se pose en haut de la liste ; un clic dessus les charge, une
  croix à droite l'ignore (il reviendra à la prochaine arrivée). La liste ne
  change jamais d'elle-même. Désactivable dans Préférences → Général. Demandé
  dans la discussion #14.

- **Marquer lu tout ce qui précède — ou suit — un article.** Le menu d'un
  article (clic droit, appui long, touche Menu) propose « Tout lu au-dessus »
  et « Tout lu en dessous » : tous les articles plus anciens, ou plus récents,
  de la vue courante passent lus — y compris ceux que la liste n'a pas encore
  chargés. Ces deux entrées respectent le réglage « Confirmer avant de tout
  marquer comme lu » (désactivé par défaut — qui l'a explicitement activé
  garde son choix), comme « Tout lu » : réglage actif, un premier clic
  demande confirmation et un second agit ; réglage éteint (le défaut), un
  seul clic suffit. Aucune des deux n'a d'annulation, comme « Tout lu ».
  Elles n'apparaissent pas dans Favoris ni À lire plus tard : ce ne sont pas
  des flux qu'on vide, ce sont des sélections transversales. L'article
  cliqué, lui, n'est jamais touché. Demandé dans l'issue #15.

- **« Confirmer avant de tout marquer comme lu » est désormais désactivé par
  défaut.** « Tout lu » et les deux marquages de plage agissent donc au
  premier clic, sans confirmation, pour qui n'a jamais touché ce réglage
  (Préférences → Général). Qui l'avait explicitement activé garde son choix —
  seule la valeur par défaut change.

## Corrections et améliorations

- **Le menu d'un article porte des icônes et se lit en trois groupes.** Chaque
  entrée est précédée de son icône, alignée sur une colonne, et un filet
  sépare ce qui ouvre l'article (Ouvrir la source, Marquer lu/non lu) de ce qui
  agit sur une plage (Tout lu au-dessus, Tout lu en dessous) et de ce qui range
  (Favori, À lire plus tard, Copier le lien). Un menu de sept entrées à plat
  obligeait à tout lire pour en trouver une.

- **La barre d'action du volet de lecture ne casse plus ses libellés en deux
  lignes.** Dès que la place manquait, les boutons (Non lu, Favori, Plus
  tard, Étiquettes, Article complet, Original, Partager) passaient sur deux
  lignes et la barre doublait de hauteur. Les libellés restent maintenant sur
  une ligne, et se replient en icônes seules (nom conservé pour les lecteurs
  d'écran) quand la barre elle-même n'a plus la place — pas l'écran, la barre :
  la colonne de liste peut se redimensionner.

- **Le menu d'un article ne se referme plus en levant le doigt (iOS).** Un appui
  long faisait bien apparaître la feuille, mais le clic d'écho émis par iOS au
  moment où le doigt se lève tombait sur le fond de la feuille et la refermait
  aussitôt : le menu était inutilisable au doigt la plupart du temps. Le fond ne
  devient actif qu'une fois le doigt qui a ouvert la feuille effectivement
  relevé. Le geste attendu fonctionne : garder le doigt appuyé pour faire
  apparaître le menu, lever, puis appuyer sur l'entrée voulue.

- **Un marquage de plage bridé par le plafond de requêtes le dit.** Quand
  « Tout lu au-dessus » heurtait la limite du proxy, le message annonçait un
  refus du serveur alors qu'une partie des articles était bien passée. Il
  distingue maintenant les deux cas et invite à réessayer dans une minute.

- **La recherche filtre enfin.** Elle ne filtrait rien : FriRSS envoyait un
  paramètre `q` que l'API Google Reader de FreshRSS n'a jamais lu — vérifié sur
  les versions 1.20.2, 1.23.1, 1.24.3, 1.26.0 et 1.27.0 — et le serveur
  renvoyait le flux entier. Un terme inexistant ramenait quand même tous les
  articles. Le filtrage se fait
  désormais dans le navigateur : FriRSS balaye le périmètre de la vue courante
  (flux, catégorie, ou tous les flux), articles lus compris, affiche les
  correspondances au fur et à mesure avec un compteur et un bouton pour
  arrêter, et ne dit « aucun résultat » qu'une fois le balayage terminé. Les
  accents et la casse sont ignorés, tous les mots de la requête sont exigés.
  Hors ligne, la recherche fouille ce que l'appareil détient et le dit.
  **Changement de comportement** : changer de flux, de filtre ou de catégorie
  referme désormais la recherche, au lieu de laisser la boîte remplie au-dessus
  d'une autre vue.

## [1.4.11] - 2026-09-14

## Fonctionnalités

- **Le filtre Non lus peut s'appliquer à tous les flux.** Préférences →
  Général, « Filtre Non lus » : *Par flux*, le fonctionnement actuel où chaque
  flux retient son choix, ou *Tous les flux*, où le bouton Non lus s'applique
  partout, y compris à l'entrée « Tous les flux » de la barre latérale. Revenir
  à *Par flux* repart de l'état du moment : les choix par flux
  antérieurs sont effacés. Limite connue : les préférences se synchronisent
  d'un bloc, si bien qu'un appareil resté ouvert depuis avant le retour à *Par
  flux* peut réécrire les anciens choix à son prochain changement de
  préférence — recharger les autres appareils ouverts. Demandé dans la
  discussion #13.
- **Clic droit sur un article.** Un menu ouvre l'article à la source dans un
  nouvel onglet, le marque lu ou non lu, l'ajoute aux favoris ou à lire plus
  tard, ou copie son lien. Au doigt, un appui long ouvre le même menu, en
  feuille du bas sur téléphone. Le clic molette ouvre directement l'article à
  la source. Demandé dans l'issue #11.

## Corrections et améliorations

- **Le menu d'un flux s'ouvre enfin au doigt.** Un appui long sur un flux dans
  la barre latérale ouvre le même menu que le clic droit : renommer, ouvrir le
  site, extraction automatique, se désabonner. Sur téléphone et tablette, ces
  quatre actions n'étaient jusqu'ici accessibles par aucun geste — le bouton ⋯
  n'apparaît qu'au survol d'une souris.
- **Et ce menu ne s'ouvre plus hors de l'écran.** Il s'ancrait au bord droit de
  la ligne sans jamais être ramené dans la fenêtre : sur un téléphone, il
  s'ouvrait en dehors, ce qui donnait l'impression que rien ne se passait. Le
  clic droit près du bord d'une fenêtre étroite était touché de la même façon.
  Une tape à côté du menu le referme désormais aussi au doigt.
- **Et son contenu ne déborde plus.** La rangée de disposition du flux était
  coupée par le bord du menu ; elle passe à la ligne quand elle ne tient pas.
- **L'appui long ne surligne plus le nom du flux.** iOS lançait sa sélection de
  texte par-dessus le menu qui venait de s'ouvrir.
- **On peut de nouveau sortir des préférences sur un écran étroit.** Le
  sélecteur de thème poussait la croix de fermeture hors du panneau : il n'y
  avait plus aucun moyen de revenir à l'interface. Sur téléphone, ce raccourci
  de thème quitte l'en-tête, où il recouvrait « Tout réinitialiser » ; les
  thèmes restent dans la section Apparence.
- **Le choix actif du « Mode d'authentification » se lit enfin.** Il était écrit
  en blanc sur le vert d'accent, un contraste de 1,9:1 ; il prend désormais la
  couleur de texte prévue pour l'accent, lisible dans tous les thèmes.
- **Les menus contextuels se visent mieux au doigt.** Sur tablette et
  téléphone, les entrées du menu d'un flux — et du nouveau menu d'un article —
  font désormais 44 pt de haut, contre 40 px.

## Actions requises à la mise à jour

Rien à faire : aucune nouvelle variable d'environnement, aucune migration.

## Documentation

- **La démo en ligne est annoncée dans le README**, avec ses identifiants de
  démonstration et les restrictions de l'instance.
- **README** : la portée du filtre Non lus, le menu d'un article et l'appui long
  qui ouvre un menu au doigt rejoignent la liste des fonctionnalités.

## [1.4.10] - 2026-09-07

## Fonctionnalités

- **Ouvrir un article à sa source depuis la liste.** Une icône sur chaque ligne
  ouvre l'article sur le site d'origine dans un nouvel onglet, sans y naviguer
  dans FriRSS — pour qui préfère lire ses flux à la source. Demandé dans
  l'issue #11. L'article ouvert devient l'article sélectionné : il est donc
  marqué lu et sa ligne **reste** dans la liste même sous le filtre « Non
  lus ». Mais sélectionner ouvre aussi le volet de lecture, qui prend la place
  de la liste sur téléphone, en tablette et sur desktop en 2 panneaux/grille —
  seul le desktop en 3 panneaux garde liste et volet côte à côte. Au retour de
  l'onglet, on retombe donc le plus souvent sur le volet de l'article qu'on
  vient de lire ailleurs, pas sur la liste ; un Retour suffit pour la
  retrouver. C'est un compromis assumé, pas une disposition oubliée : la
  sélection se comporte pareil partout, sans condition par mise en page. En
  mode Compact, les icônes sont aussi plus espacées qu'avant,
  pour que le doigt ne vise pas le ✓ et n'ouvre pas un onglet. À savoir : dans
  la vue normale, les quatre icônes restent empilées en colonne, et cette
  colonne est plus haute que le texte de la ligne — les lignes y gagnent une
  vingtaine de pixels, soit à peu près un article de moins par écran. Masquer
  une icône dans Préférences → Mise en page rend cette hauteur.
- **Choisir les icônes affichées sur une ligne.** Une nouvelle section
  « Mise en page » dans les préférences permet d'afficher ou de masquer chacune
  des quatre icônes, une par une. Les balayages, les raccourcis et le volet de
  lecture ne changent pas — en revanche, masquer « Favori » ou « À lire plus
  tard » retire aussi l'appui long qui classe un article dans une catégorie
  depuis la liste : ce geste vit dans ces deux boutons. Le texte d'aide de la
  section le dit.
- **FriRSS parle chinois simplifié.** Dixième langue de l'interface, contribuée
  par [zhhbinn](https://github.com/zhhbinn) — traduction complète, dont la
  terminologie suit celle de l'interface chinoise de FreshRSS. Elle se
  sélectionne dans Préférences → Général, et s'active toute seule pour un
  navigateur réglé en `zh`.

## Corrections et améliorations

- **Un site ouvert depuis FriRSS ne peut plus reprendre la main sur l'onglet
  resté derrière.** Le raccourci `O` (ouvrir l'article d'origine) et
  « Ouvrir le site » du menu contextuel d'un flux ouvraient un onglet qui
  gardait un lien vers FriRSS : la page visée pouvait rediriger l'onglet FriRSS
  laissé en arrière-plan — vers une fausse page de connexion, par exemple.
  C'est le *reverse tabnabbing*, dont les liens contenus dans les articles
  étaient déjà protégés ; ces deux ouvertures-là ne l'étaient pas. Elles
  passent désormais par une fonction unique qui coupe ce lien.
- **Le corps d'un article ne clignote plus quand on le fait défiler.** Sur les
  flux à extraction automatique, en PWA iOS, les images de l'article
  disparaissaient et revenaient une trentaine de fois par seconde pendant un
  défilement. Le volet reconstruisait tout le corps à chaque rendu, donc
  détruisait et recréait chaque image. Il ne le réécrit désormais que lorsque
  le contenu change vraiment.
- **Le balayage d'un article à l'autre redevient fluide.** En PWA iOS, passer
  d'un article au suivant se bloquait 2 à 7 secondes par à-coups. La 1.4.8
  préchargeait les **images** des dix articles suivants : dès qu'on marquait une
  pause, dix extractions et leurs images partaient d'un coup et saturaient le
  serveur, si bien que le balayage suivant attendait derrière la file. Les
  images ont quitté le serveur ; le préchargement de **texte** garde ses dix
  articles d'avance, mais un article à la fois.
- **Les images des articles suivants sont prêtes avant qu'on y arrive.** En
  lisant un article, FriRSS charge maintenant l'image d'en-tête des dix
  articles suivants, directement depuis leur site et deux à la fois — sans
  passer par le serveur, contrairement à la tentative qui avait bloqué le
  balayage plus tôt dans ce cycle. Une image déjà en cache n'est pas
  redemandée, et rien ne part pendant un balayage. En prime, la place de
  l'image est désormais réservée même quand le flux n'annonce pas ses
  dimensions : le texte ne saute plus quand elle se pose.
- **L'article s'affiche tout de suite, sans écran d'attente.** Sur un flux à
  extraction automatique, le volet montrait un rectangle gris tant que le texte
  complet n'était pas récupéré — alors que le contenu du flux était déjà là. Il
  affiche désormais ce qu'il a immédiatement, puis complète en silence quand
  l'article entier arrive. Le même changement vaut pendant un balayage : plus
  d'article gris qui glisse à l'écran. Le rectangle d'attente ne subsiste que
  là où le flux ne livre réellement rien.
- **Dix articles d'avance au lieu de cinq** pour le texte préparé pendant la
  lecture — toujours un article à la fois, pour ne pas charger le serveur.
- **Le texte des articles est extrait une fois pour toute l'instance.** Chaque
  appareil refaisait l'extraction de chaque article : dix lecteurs des mêmes
  flux, c'étaient dix extractions identiques et dix requêtes chez le site
  d'origine. Le serveur s'en charge désormais et, quand Redis est là, partage
  le résultat entre appareils et entre comptes — le téléphone ne calcule plus
  rien. **Sans Redis, le serveur extrait quand même** : il ne garde simplement
  rien, et l'appareil suivant repaie l'extraction. Le navigateur ne reprend la
  main que si la route manque (serveur plus ancien), si elle renonce à la page
  ou si elle ne répond pas — au bout de 20 s, l'extraction bascule d'elle-même
  sur le navigateur plutôt que d'attendre indéfiniment.
- **Défilement plus fluide dans le volet de lecture** : la barre de progression
  se mesure une fois par image affichée, plus une fois par événement de
  défilement.
- **Les dates s'affichent enfin dans votre langue.** Le formatage s'était arrêté
  à deux langues : hors français, tout passait au format américain. Un lecteur
  allemand, espagnol, italien, néerlandais, polonais, portugais ou ukrainien —
  sept des neuf langues — voyait donc des dates anglaises dans une interface
  par ailleurs traduite. Au passage, la date affichée pendant le balayage d'un
  article à l'autre était figée en français : elle changeait sous les yeux au
  moment où l'article s'affichait vraiment.
- **Plus de bande verte à côté des vignettes vidéo.** Sur les écrans larges, la
  vignette d'une vidéo YouTube s'affichait à sa taille d'origine au lieu de
  remplir son cadre, laissant apparaître le fond de celui-ci sur la droite. Le
  défaut ne se voyait qu'au-delà d'une certaine largeur de colonne, donc jamais
  sur mobile.
- **Trois textes restaient dans une seule langue.** L'exemple d'adresse
  courriel à l'inscription et celui d'URL de logo étaient rédigés en français
  pour tout le monde ; la barre de progression du haut s'annonçait « Loading »
  aux lecteurs d'écran, quelle que soit la langue — et comme elle n'affiche
  aucun texte, c'était le seul mot qu'ils prononçaient.
- **La page déclare la langue de l'interface.** Elle annonçait le français quelle
  que soit la langue choisie. Les lecteurs d'écran y prennent leur voix et leurs
  règles de prononciation : une interface polonaise était lue avec une voix
  française. Le correcteur orthographique des champs de saisie s'aligne aussi.

## Sous le capot

- **Le journal d'accès du serveur n'enregistre plus la chaîne de requête.** Il
  écrivait `req.originalUrl` ; l'extraction côté serveur y aurait déposé l'URL
  complète de chaque article ouvert par chaque compte — préchargement et
  préparation hors-ligne compris. Seul le chemin est journalisé désormais.
- **Et ce chemin est de nouveau complet.** La première version le lisait trop
  tard (Express l'a alors réécrit en relatif au routeur) : la production
  journalisait `GET /` aussi bien pour `/api/proxy` que pour `/api/extract`, et
  `POST /login` pour `/api/auth/login`. Le journal est désormais couvert par un
  test.
- **Les URL d'articles ne partent plus non plus dans les lignes d'erreur** du
  serveur : sur la route d'extraction, seul l'hôte visé est journalisé.
- **Une panne de résolution DNS ne se fait plus passer pour un serveur
  refusé.** Un unique paquet DNS perdu pendant l'installation annonçait « cette
  adresse pointe à l'intérieur de votre réseau, FriRSS l'a bloquée », avec la
  marche à suivre correspondante. L'écran dit maintenant ce qui s'est réellement
  passé.
- **L'extraction côté serveur ne bloque plus l'instance.** L'analyse d'une page
  immobilise l'unique processus qui sert tout le monde ; la file est désormais
  bornée (une analyse à la fois, cinq requêtes au plus en attente) et un tour
  complet est rendu aux autres requêtes entre deux analyses. Au-delà de cinq, le
  navigateur reprend la main comme avant la 1.4.10. Ce n'est pas un plafond de
  charge : un compte obstiné peut faire analyser en continu — mais le serveur
  reste joignable pendant ce temps.
- **Dix appareils qui ouvrent le même article au même moment ne déclenchent plus
  qu'une seule extraction**, donc une seule requête chez le site d'origine.
- **La préparation hors-ligne garde les articles que le plafond de cadence lui
  refusait.** Quand le serveur répond « trop de requêtes » **en annonçant quand
  revenir**, elle attend ce délai puis réessaie, au lieu de laisser l'article
  absent du jeu hors ligne. C'est le cas courant. Si le serveur n'annonce aucun
  délai exploitable, ou s'il refuse une seconde fois, l'article reste absent de
  ce passage — le passage suivant le reprendra.
- **Une URL signée ne peut plus finir en clair dans le journal du serveur.** La
  branche qui annonce une résolution sans réponse écrivait la cible telle
  quelle, là où les deux autres en retiraient les paramètres secrets — or le
  préchargement d'images hors ligne y fait passer des URL de CDN signées par un
  jeton. Les trois branches sont désormais identiques, et un test échoue si
  l'une d'elles se remet à écrire une cible brute.
- **Le repli d'extraction est borné dans le temps lui aussi.** Un backend qui
  accepte la connexion sans jamais répondre bloquait encore la file : le
  minuteur ne couvrait que la première des deux requêtes.

## Actions requises à la mise à jour

Aucune : pas de nouvelle variable d'environnement, pas de migration.

⚠️ **Un seul point à vérifier si vous aviez abaissé `FRIRSS_PROXY_RATE_LIMIT`.**
L'extraction d'articles puise désormais dans **le même seau** que le proxy, au
lieu d'un seau distinct — c'était un défaut : deux seaux doublaient
silencieusement le plafond annoncé. À la valeur par défaut (600/min par compte)
il n'y a rien à faire ; à une valeur basse, la préparation hors-ligne peut
désormais l'atteindre.

## Documentation

- `docs/FEATURES.md` : trois affirmations fausses corrigées — le journal
  d'accès (chemin tronqué), la fraîcheur des extraits (« le bouton *Article
  complet* relance à la demande », faux : rien ne ré-extrait, et l'entrée
  serveur vit 24 h là où le client revalide à 12 h) et « les deux
  consommateurs » du délai d'extraction. Le plafond de résolution DNS est
  désormais décrit pour ce qu'il est : une garde de TOUTES les sorties du
  backend, pas seulement de l'extraction.
- **Relecture de fin de cycle**, cinq énoncés remis d'aplomb : les
  consommateurs du délai d'extraction sont **six**, pas cinq, et quatre
  seulement sont des files (la boucle de préchargement du volet de lecture
  manquait à l'appel) ; le pire cas d'un article est **~100 s** avec une attente
  de cadence, pas ~40 s ; le traitement du 429 dit maintenant ce qu'il couvre
  et ce qu'il ne couvre pas ; la borne d'analyse borne une file, pas le CPU ; et
  l'argument du « sémaphore classique » décrivait de travers le compteur qu'il
  justifiait. La liste des échecs de `/api/extract` mentionne enfin ses deux
  503.
- Barre d'actions d'une ligne : la disposition retenue pour chaque mode
  d'affichage est désormais écrite, avec la mesure qui la justifie (une colonne
  de quatre boutons rendait la ligne normale 21 % plus haute), ainsi que
  l'écartement des cibles tactiles en mode Compact et la raison de le doubler.
  Deux affirmations fausses corrigées : « cliquer l'icône équivaut à un ✓ suivi
  de l'ouverture externe » (faux sur un article déjà lu, que le ✓ repasserait
  non lu) et l'écartement « plus resserré » de la ligne compacte. Le couplage
  entre les icônes Favori / À lire plus tard et le geste de classement y est
  consigné, des deux côtés — barre d'actions et Préférences.

## [1.4.9] - 2026-09-03

## Corrections et améliorations

- **Deux vulnérabilités corrigées dans une dépendance du serveur.** `qs`, la
  bibliothèque qu'Express utilise pour analyser les paramètres d'URL, portait
  deux avis de sévérité moyenne : un contournement de sa limite de taille de
  tableau, et un déni de service. Passée en 6.16.0. C'est la seule
  vulnérabilité que l'image publiée portait — les autres remontées par `npm
  audit` vivent dans les dépendances de développement et ne sont jamais
  embarquées.

## [1.4.8] - 2026-09-03

## Corrections et améliorations

- **Passer à l'article suivant ne fait plus sauter le texte.** Sur un flux à
  extraction automatique, FriRSS préchargeait le texte des articles suivants
  mais pas leurs images : elles n'arrivaient qu'une fois l'article ouvert, et
  poussaient le texte vers le bas (très visible sur iPhone, en PWA). Le
  préchargement réchauffe désormais aussi les images du corps, et porte sur les
  **dix** articles suivants au lieu de cinq. Il obéit au réglage « images hors
  ligne » : sur « aucune », rien n'est téléchargé.
- **Changer de flux pendant un chargement ne mélange plus les listes.** Quand
  une page du scroll infini arrivait après un changement de flux, ses articles
  étaient ajoutés à la liste affichée — celle d'un autre flux — et le mélange
  était enregistré dans le cache de la vue quittée : il revenait tel quel au
  rechargement suivant, y compris hors ligne. La page est désormais jetée si
  la vue a changé entre-temps.
- **Le scroll infini d'une recherche reste dans la recherche.** Descendre au
  bas d'une liste de résultats chargeait la suite du **flux**, pas celle de la
  requête : des articles sans rapport s'ajoutaient sous une boîte de recherche
  toujours remplie. La pagination poursuit désormais la recherche, dans le même
  périmètre (flux, catégorie, favoris, à lire plus tard).
- **Un problème côté FreshRSS ne vous déconnecte plus de FriRSS.** Une session
  FreshRSS expirée ou un mot de passe d'API changé faisait fermer la session
  FriRSS et renvoyait à l'écran de connexion, alors que le compte FriRSS était
  parfaitement valide. Les deux authentifications sont désormais distinguées :
  seule l'expiration de la session **FriRSS** déconnecte.

## [1.4.7] - 2026-09-02

## Fonctionnalités

- **Marquer un article lu le fait sortir de la liste « Non lus ».** Cliquer le ✓
  d'une ligne n'avait aucun effet visible sous le filtre dont c'était pourtant
  le sujet. La ligne disparaît maintenant immédiatement ; si le serveur refuse
  le marquage, elle revient à sa place. Ouvrir un article ne retire pas sa
  ligne, et le marquage au défilement non plus : seul un geste explicite
  retire. (issue #10)
- **Le ✓ arrive dans l'affichage compact**, où il manquait alors qu'il existait
  déjà dans les autres dispositions.
- **Une liste vide propose de charger la suite.** Quand une vue n'a plus rien à
  montrer alors que le flux n'est pas épuisé — filtrer sur les favoris un flux
  dont les premiers articles n'en sont pas, par exemple — elle annonçait à tort
  qu'il n'y avait plus rien. Elle affiche désormais un message neutre et un
  bouton « Charger la suite ».

## Corrections et améliorations

- **Un jeton d'écriture périmé ne condamne plus toutes les écritures.** Le
  jeton CSRF de FreshRSS était obtenu une fois pour toute la session et rien ne
  le renouvelait : dès qu'il expirait — session FreshRSS renouvelée, serveur
  redémarré —, chaque marquage, chaque favori et chaque « à lire plus tard »
  échouait silencieusement jusqu'au rechargement de la page. FriRSS redemande
  maintenant un jeton et rejoue l'écriture une fois.
- **Une écriture perdue le dit.** Un marquage refusé par le serveur, ou mis en
  file d'attente alors que la connexion est bonne, ne laissait aucune trace à
  l'écran. Un message l'explique désormais. Hors ligne pour de bon, rien ne
  s'affiche : le bandeau hors-ligne le dit déjà.
- **Retirer « À lire plus tard » ne fait plus disparaître l'article quand le
  serveur refuse.** Depuis cette vue, la ligne partait avant même la réponse du
  serveur : sur un refus elle ne revenait pas, et le compteur annonçait un
  élément au-dessus d'une liste vide. Même correction que celle appliquée aux
  favoris en 1.4.4.
- **Une ligne retirée de « À lire plus tard » ne revient plus.** Quitter la vue
  puis y revenir réaffichait l'article dont l'étiquette venait d'être enlevée.
- **Plus de clignotement en vidant une journée.** Marquer lu le dernier article
  d'une bande de date faisait rejouer l'animation d'entrée à toutes les lignes
  des journées suivantes.

## Sous le capot

- **L'extraction de fond suit le rattrapage de pagination.** Le rattrapage
  introduit par le retrait de ligne redemande une page à chaque ✓ ; chacune de
  ces pages annulait et relançait l'extraction du contenu complet, qui ne
  prenait donc jamais d'avance sur un flux à extraction automatique. Une page
  supplémentaire alimente désormais le travail en cours au lieu de le
  remplacer.

## [1.4.6] - 2026-09-01

## Corrections et améliorations

- **Connexion à un FreshRSS auto-hébergé : l'écran dit enfin pourquoi elle
  échoue.** Une instance sur une IP privée est refusée par la garde anti-SSRF,
  qui répond `403 Target host not allowed` — mais l'écran affichait « connexion
  au serveur impossible » et taisait la cause comme la solution. Il nomme
  maintenant le blocage et la variable qui le lève, `PROXY_INTERNAL_HOSTS`.
  Vaut pour la première connexion comme pour l'ajout d'un serveur depuis les
  préférences. (issue #8)
- **Un mot de passe d'API refusé ne se présente plus comme une panne de
  serveur.** FreshRSS répond 401 quand le mot de passe d'API est faux — ou
  quand aucun n'a jamais été défini — et l'écran annonçait « connexion au
  serveur impossible ». Il dit maintenant que les identifiants ont été refusés
  et rappelle que ce mot de passe se définit à part de celui du compte. Les 401
  venant de FriRSS lui-même (session expirée) restent exclus de ce diagnostic.
- **Aucune autre cause n'est nommée, délibérément.** Un hôte injoignable, une
  coupure réseau ou une session FriRSS expirée gardent le message générique :
  seule une cause que le backend a réellement vérifiée est annoncée.

## Documentation

- **README** : l'installation prévient que la plupart des FreshRSS
  auto-hébergés vivent sur une adresse privée, montre la ligne
  `PROXY_INTERNAL_HOSTS` à ajouter, explique pourquoi le refus existe et donne
  la signature à chercher dans le journal (`POST /api/proxy 403`). La ligne du
  tableau de configuration dit désormais quand la variable est nécessaire.
- **Template Unraid Community Applications** : le champ `PROXY_INTERNAL_HOSTS`
  y figure enfin — son absence est la raison pour laquelle le blocage passait
  inaperçu. Un conteneur déjà installé garde sa copie du template : la variable
  doit y être ajoutée à la main.

## [1.4.5] - 2026-08-31

## Fonctionnalités

- **Un panneau pour gérer les catégories de flux** (Préférences → Flux) :
  renommer, supprimer, et déplacer un flux d'une catégorie à l'autre. Supprimer
  une catégorie ne supprime aucun flux — ils se retrouvent sans catégorie, et
  la confirmation le dit avant. Une catégorie vide n'existe pas dans FreshRSS :
  elle naît du premier flux qu'on y range, ce que propose le sélecteur.

- **Deux liens discrets en bas de la barre latérale**, à côté de l'engrenage :
  mettre une étoile sur GitHub et soutenir le projet.

- **Un thème sombre, enfin.** Cinq thèmes livrés en plus du thème par défaut :
  **Riso** (blanc et rose fluo), **Paper** (sépia) et **High Contrast** en
  clair, **Night** et **Desk** en sombre — présentés en galerie de vignettes
  en haut de Préférences → Apparence → Thème. Le moteur savait déjà tout faire :
  il ne livrait aucun contenu, et atteindre un thème sombre demandait de régler
  36 couleurs à la main.
- **Un bouton pour voir le mot de passe** sur l'écran de connexion, et un
  sous-titre qui dit ce qu'est FriRSS au lieu de répéter « Connexion » entre
  « Bienvenue sur FriRSS » et le bouton « Se connecter ».
- **Des messages de confirmation.** L'application ne disait jamais qu'une
  action avait abouti. Un message bref apparaît en bas de l'écran — articles
  marqués comme lus, lien copié — et disparaît seul.
- **La palette de commandes sait aussi changer de serveur FreshRSS**, ce qui
  était jusqu'ici réservé à la barre du haut — donc indisponible à qui la
  masque.
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

- **Les images d'article ne dépassent plus 80 % de la hauteur d'écran.** Une
  infographie verticale occupait trois écrans et coupait la lecture en deux.
  Le TEXTE, lui, occupe toujours toute la largeur du volet, comme avant.
- **« Paper » est sépia jusqu'au bout.** La page était crème mais la barre
  latérale et son bandeau restaient aux couleurs du thème par défaut : une page
  de livre surmontée d'un bandeau vert vif. Cuir sombre, bandeau tan, encre
  sienna.
- **Le compteur de non-lus est lisible dans la barre latérale, quel que soit
  le thème.** Il prenait la couleur d'accent, réglée pour le panneau clair —
  donc presque invisible sur la barre latérale sombre dès que le thème est
  clair. « Paper » était le plus touché.
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
- Un test serveur échouait par intermittence : une relève de flux lancée en
  arrière-plan par un test antérieur venait se poser dans le simulacre de
  `fetch` d'un test ultérieur. Les travaux de fond sont maintenant drainés
  entre les tests.
- **React 19.** Aucun changement de code : les API retirées par cette version
  n'étaient utilisées nulle part. Rien de visible à l'usage — c'est une montée
  d'entretien, pour rester sur la version supportée.

## Actions requises à la mise à jour

Aucune.

## [1.4.4] — 2026-08-30

Version de sécurité et de correction : aucune nouvelle fonctionnalité, et rien à
faire à la mise à jour.

### Security

- **Le jeton FreshRSS ne peut plus partir chez un tiers.** Le proxy décidait de
  l'attacher en comparant la cible à l'URL du serveur par simple préfixe de
  chaîne, si bien que `https://serveur.tld.tiers.tld/` et
  `https://serveur.tld@tiers.tld/` passaient tous deux le contrôle. Les URL
  d'images et de favicons venant du contenu des flux, un flux hostile suffisait
  à faire envoyer le jeton — un accès complet au compte FreshRSS — vers son
  propre domaine. La comparaison porte désormais sur l'origine analysée.
- **L'inscription est fermée par défaut.** Le premier compte reste toujours
  autorisé ; les instances existantes gardent leur réglage.
- **Le backend ne s'exécute plus en root** (`PUID`/`PGID`, 1000 par défaut). Le
  répertoire de données est adopté au démarrage : aucune action requise.
- **Les requêtes proxifiées sont plafonnées par utilisateur**
  (`FRIRSS_PROXY_RATE_LIMIT`, 600/min, `0` désactive).
- **L'authentification est vérifiée avant la lecture du corps de requête.**
- **Les écritures de préférences sont bornées** — longueur de clé, taille de
  valeur, nombre par requête et total par utilisateur.
- **Les fichiers statiques portent les en-têtes de sécurité.** `/sw.js` en est
  délibérément exclu : un service worker applique à ses propres `fetch()` la CSP
  livrée avec son script, et ne pourrait plus récupérer une image tierce.
- **L'extraction d'article n'archive plus de balisage plus large qu'affiché.**
- **La découverte OIDC passe par le garde anti-SSRF.**
- **Le proxy ouvert du serveur de développement est supprimé.**

### Fixed

- **« Marquer tout comme lu » n'est plus proposé dans Favoris et À lire plus
  tard**, où il marquait toute la liste de lecture.
- **Retirer un favori ne fait plus disparaître la ligne.**
- **Le favori et « à lire plus tard » sont enregistrés dans le cache
  hors-ligne.**
- **Les actions faites hors ligne ne sont plus rejouées en double.**

### Changed

- Code mort retiré : le repli `X-Freshrss-Auth` du proxy, une règle CSS
  orpheline, deux dépendances de développement jamais importées.
- `SECURITY.md` consigne une limite connue du garde anti-SSRF : il ne fixe pas
  l'adresse qu'il a validée, ce qui laisse passer un DNS rebinding.
- Le garde-fou de l'inventaire relève les variables d'environnement dans le
  code ; la CI vérifie qu'aucun processus applicatif ne tourne en root et que
  `/sw.js` ne porte ni CSP ni `immutable`.

## [1.4.3] — 2026-08-28

### Added

- **Encrypted backup and restore.** One downloadable file holds everything
  FriRSS knows about itself — accounts and password hashes, servers and their
  tokens, preferences, instance settings — behind a mandatory passphrase of 12
  characters minimum. Restorable from *Preferences → Administration* or from the
  first-run screen, which makes it a migration tool as well as a backup. Article
  content is not included: it lives in FreshRSS.
- **FreshRSS server management in *Preferences → Feeds*.** Adding, renaming,
  setting a default, deleting and switching now all live on a screen reachable
  in every configuration. The top bar stays a selector; its `+` and its
  right-click lead there. Hiding the top bar used to make server management —
  and switching itself — unreachable, and renaming, setting a default and
  deleting simply did not exist in the iOS PWA, for want of a right-click.
- **Per-server master token.** It is configured and tested from any server's
  row, without having to switch to that server first.

### Changed

- The Preferences panel no longer rebuilds on every section change. Feeds and
  Administration paid a full network round trip, blank screen included, on every
  visit.
- Administration's five unrelated groups are legible at a glance. Their headings
  were the smallest, palest text on the page — a heading quieter than its own
  content titles nothing.
- The first-run screen puts the administrator note and the restore link on a
  readable surface instead of floating them over the background animation, and
  the note is a sentence — "The first account you create becomes the
  administrator." — rather than the cryptic "First account = administrator".
- 25 dead translation keys removed across the nine locales, and two counters
  given real plural forms — Polish and Ukrainian were receiving a French-shaped
  `user(s)` where their grammar asks for four forms.

### Fixed

- **Signing back in after a restore works the first time.** The restore armed a
  1.5 s deferred logout that no unmount cancelled; since clearing the sessions
  returns you to the login screen well within that delay, a quick sign-in was
  destroyed by the stale timer. It took two or three attempts.
- **Login errors no longer lie.** Every failure — rate limit, server error,
  dropped connection — announced "incorrect credentials", which sent you
  retyping a password that was right all along. Only an authentication refusal
  says so now.
- Restoring onto an already-configured instance says exactly that, instead of
  "The operation failed. Try again." — advice that could not work, since
  retrying produced the same refusal.
- The restore form is readable everywhere. It borrowed the Administration
  panel's light palette even on the dark login screen: near-black text on
  near-black, white borders.
- The file picker reads as one control that carries its state, instead of an
  empty input with the chosen filename detached beside it.
- Checking a backup shows that it is working, and the preview that unfolds below
  announces itself rather than appearing unnoticed.
- **Escape no longer closes the Preferences panel from under an open form.** The
  server forms moved into Preferences, which already handles Escape at the panel
  level, so cancelling a rename tore the whole panel down. Focus also returns to
  the button that opened the layer — without it a second Escape did nothing,
  focus having fallen back to `document.body`, outside the listening tree.
- A refused rename keeps the form open along with what you typed, instead of
  closing and discarding it to show the error.
- The server list tells its states apart. A pending load and a failed
  `getServers()` were indistinguishable from a read-only legacy connection. The
  recovery action reads **Retry**, not Refresh: it does not refresh anything, it
  reissues the request that failed.
- The active server's row expands when you click its body instead of doing
  nothing, the chevron and its panel are tied by `aria-controls`, and the rename
  form has a cancel button like the delete flow.
- French and Italian use the typographic apostrophe instead of the straight one.

### Under the hood

- `docs/FEATURES.md` inventories everything FriRSS does, with a test that fails
  when a server route, an environment variable or a translation family is
  missing from it.
- The 232-settings guard now walks the panel recursively; it was not descending
  into nested settings, so it guarded less than it claimed.

### Security

- Alpine packages are upgraded when the image is built. The base image is
  rebuilt on its own schedule, so it was shipping openssl 3.5.7-r0 with ten
  fixable advisories against it; the production stage now pulls the patched
  3.5.8-r0 from the branch the base already pins.

## [1.4.2] — 2026-08-22

### Added

- **Refresh actually refreshes.** The button asked FreshRSS to re-read its own
  database; it now asks FreshRSS to go and collect new articles. Optional —
  it needs your FreshRSS master authentication token, and without one the
  button behaves as before. Read the warning in the setting before enabling it:
  that token also grants password-free access to your articles, and FreshRSS
  only accepts the call as a GET, so it appears in your server's access logs.

### Changed

- **Preferences rebuilt.** Ten horizontal tabs became five sections plus
  Administration in a vertical navigation, so the panel's width no longer
  depends on how many sections exist. Language moved to General, where people
  look for it; Colours, Sizes and Themes merged into Appearance; keyboard
  shortcuts joined General. A live preview above the theme settings recomposes
  as you change colours and sizes.
- **Phone and tablet support for the Preferences panel**, which had none: a
  two-level navigation, safe areas for the notch and home indicator, 44 pt touch
  targets, and colour highlighting that responds to a tap — it fired on hover
  only, so it had never worked on a touch device.
- `Preferences.tsx` went from 3 012 lines to 278 across seven focused files. A
  test freezes an inventory of 232 settings and fails the build if any of them
  becomes unreachable.

### Fixed

- Toggle switches rendered as vertical ovals on touch.
- The colour highlight dimmed the Preferences panel and the highlighted element
  along with everything else.
- Each colour's reset control was invisible until hovered.
- The Escape key cap reads `ESC` in every language.
- Built-in gesture labels no longer wrap onto two lines.

## [1.4.1] — 2026-08-20

### Fixed

- **The operator scripts were missing from the container image.**
  `scripts/backup-db.js` and `scripts/reset-password.js` were documented but
  never shipped, so both failed with `MODULE_NOT_FOUND`. This matters for
  recovery: a backup tool is only useful if it is in the image you run.

## [1.4.0] — 2026-08-20

### Added

- **Grid view** — a third layout beside *list only* and *list + reading pane*:
  a full-width gallery of cards, two to five columns with the window width,
  uniform 16:9 thumbnails, and a full-screen reader on click. Settable per feed,
  so a visual feed can stay a grid while everything else stays a list.
- **YouTube videos play in place**, behind a click-to-load facade — nothing
  reaches YouTube until you press play. Videos embedded in blog posts reappear:
  the HTML sanitiser had been deleting them outright.
- **Offline images.** Choose how much to keep (Light / Standard / Maximum),
  see the space used, empty it in one click. Prefetching had never worked
  before — images were fetched but never stored, and cross-origin requests were
  blocked by the app's own security policy.
- **Offline actions are kept.** Reading, starring or saving for later while
  offline was silently undone; those actions are now queued and replayed when
  the network returns. A refusal from the server is still rolled back — only a
  missing network is queued.
- **Categories for saved articles**, filed by holding the star or clock, or by
  dragging an article onto a category. They are ordinary tags, so FreshRSS and
  your other clients see them too.
- **Focus mode** (the reading pane fills the screen), **search scoped to the
  current view** instead of always searching everything, an *X new articles*
  banner after a refresh, and **right-to-left content** rendered in its own
  direction whatever the interface language.

### Fixed

- **Open site** opened the raw XML feed instead of the website, for feeds that
  point at themselves.
- The **search shortcut** did nothing: it targeted an input that only exists
  once search is already open.
- **Logging out did not end the server session** — a token captured beforehand
  stayed valid until it expired.

## [1.3.4] — 2026-08-15

### Added

- **Aggregated category view** — clicking a category name reads the articles
  from all its feeds at once.
- **SSO-only mode**: when OIDC is enabled, the local username/password form can
  be hidden. A break-glass `?local=1` URL always reaches it, so an administrator
  is never locked out if the identity provider is unavailable. The Admin panel
  shows the OIDC callback URL to whitelist.
- An optional confirmation-free **Mark all as read**, and a new General
  preferences tab.

### Changed

- **Faster, clearer startup**: the sidebar paints instantly from the offline
  snapshot instead of showing a blank list on a cold start, with a progress bar
  while feeds revalidate and an "Updating…" overlay instead of a silent reload.
- On/off options use consistent slide toggles.

## [1.3.3] — 2026-08-13

### Added

- **Instant feed opening** — the first page of unread feeds is prefetched in the
  background after load (capped, throttled, skipped on data-saver or slow
  connections), plus a prefetch on hover or touch.

### Fixed

- A read article reappeared as unread on returning to the list; the read state
  now propagates to the in-memory and offline caches.
- A feed's unread count holds at 0 through FreshRSS's eventually-consistent
  count instead of briefly re-showing a phantom "1 unread".

## [1.3.2] — 2026-08-11

### Security

- **Proxy SSRF guard hardened** — `/api/proxy` rejects targets that *resolve* to
  a private or loopback address, defeating DNS tricks such as `10.x.x.x.nip.io`,
  and re-checks every redirect hop; the FreshRSS token is stripped on
  cross-origin redirects.
- **Security headers on the app page** from nginx: a Content-Security-Policy
  (`script-src 'self'`), `X-Frame-Options`, `X-Content-Type-Options: nosniff`
  and `Referrer-Policy`.
- **JWT verification pinned to HS256.**
- **The bundled npm was removed from the runtime image.** It is never used at
  runtime, and its own dependencies were the source of most reported CVEs.
- dompurify bumped to 3.4.13 (moderate XSS advisory).

## [1.3.1] — 2026-08-10

### Security

- **Removed the unauthenticated `/cors-proxy` nginx endpoint** — an open proxy
  with no SSRF guard, able to reach internal hosts or act as an open relay. The
  client already used the authenticated, guarded `/api/proxy`, so this was dead
  config. Updating is recommended if your instance is publicly reachable.
  Reported by @spencerwongfeilong (#5).

### Fixed

- `tzdata` added to the image, so the `TZ` variable is honoured on Alpine
  instead of silently falling back to UTC. Thanks @spencerwongfeilong.

## [1.3.0] — 2026-08-01

### Added

- FriRSS **follows the browser language** on first run instead of always
  starting in French (#1).
- **Hide feeds with no unread articles** — a sidebar toggle that syncs with your
  account (#4).
- **Multi-arch images**: `:latest` and version tags ship amd64 and arm64, so
  FriRSS runs on a Raspberry Pi with a 64-bit OS (#2).

---

Releases before 1.3.0 are listed on the
[releases page](https://github.com/Fripix/Frirss/releases).

[1.4.3]: https://github.com/Fripix/Frirss/releases/tag/v1.4.3
[1.4.2]: https://github.com/Fripix/Frirss/releases/tag/v1.4.2
[1.4.1]: https://github.com/Fripix/Frirss/releases/tag/v1.4.1
[1.4.0]: https://github.com/Fripix/Frirss/releases/tag/v1.4.0
[1.3.4]: https://github.com/Fripix/Frirss/releases/tag/v1.3.4
[1.3.3]: https://github.com/Fripix/Frirss/releases/tag/v1.3.3
[1.3.2]: https://github.com/Fripix/Frirss/releases/tag/v1.3.2
[1.3.1]: https://github.com/Fripix/Frirss/releases/tag/v1.3.1
[1.3.0]: https://github.com/Fripix/Frirss/releases/tag/v1.3.0
