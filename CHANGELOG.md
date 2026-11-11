# Changelog

All notable changes to FriRSS. Each entry is a summary — the full notes for a
release live on its [release page](https://github.com/Fripix/Frirss/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
FriRSS follows [semantic versioning](https://semver.org/).

## [1.9.1] - 2026-11-11

## Fonctionnalités

- **Les non-lus des étiquettes.** Préférences → Étiquettes propose deux
  réglages indépendants pour les étiquettes, comme pour Favoris et À lire plus
  tard : le total (l'ancien « Afficher le nombre d'articles », renommé) et le
  nombre de non-lus, avec la pastille des flux (désactivé par défaut). Les deux
  peuvent s'afficher ensemble ; un groupe additionne ses enfants. Le chiffre
  vient du relevé des compteurs que FriRSS fait déjà chaque minute, qui
  demande FreshRSS 1.26 ou plus : sur un serveur plus ancien rien ne
  s'affiche et Préférences → Étiquettes demande la mise à jour. Suite de
  l'issue #29.
- **Les compteurs par identifiants montent à 9999** (ils s'arrêtaient à 1000) :
  totaux et non-lus des étiquettes, de Favoris et d'À lire plus tard. Une
  étiquette de plus de mille articles affichait 1000.

## Sous le capot

- **Les totaux de Favoris et d'À lire plus tard ne sont plus relevés quand
  leur réglage est éteint** (deux réponses de 9999 identifiants par minute
  pour un chiffre invisible) ; les allumer relance le relevé tout de suite.

## [1.9.0] - 2026-11-10

## Fonctionnalités

- **Un format d'image portrait pour la grille.** Préférences → Apparence →
  Tailles propose maintenant 3:4 à côté de 16:9, 4:3 et 1:1 (issue #26).
- **Les non-lus des Favoris et d'À lire plus tard.** Préférences → Étiquettes
  propose deux réglages indépendants : le total, comme jusqu'ici (activé par
  défaut, pastille inchangée) et le nombre de non-lus, avec la pastille des
  flux (désactivé par défaut). Les deux peuvent s'afficher ensemble. En réponse
  à l'issue #29, qui le demandait pour les étiquettes : celles-ci gardent leur
  total, qu'on peut toujours masquer.
- **Des barres d'outils à son goût, sur ordinateur.** Préférences → Mise en
  page → Sur ordinateur permet de masquer chaque bouton de la barre de la liste
  et de celle du volet de lecture, la barre de la liste entière et la barre des
  raccourcis. Rien ne se perd : chaque bouton masqué reste dans la palette de
  commandes (Ctrl/⌘ K), qui gagne au passage les filtres, « Tout lu », les
  options d'affichage, la densité, les actions de l'article (étiquettes
  comprises) et l'affichage de la barre latérale. Masquer Favori ou À lire
  plus tard dans le volet retire aussi leur appui long. Sur tous les écrans,
  le même onglet permet aussi d'afficher ou de masquer la barre des serveurs ;
  le reste ne change pas sur tablette et téléphone.
- **Annuler la préparation hors ligne, et savoir combien de temps il reste.**
  L'onglet Hors ligne propose « Annuler » pendant la préparation et affiche
  une estimation de la durée restante, d'après le rythme observé.
- **Un ☰ de secours** quand la barre latérale et la barre de la liste sont
  toutes deux masquées sur ordinateur (et dans le volet de lecture quand
  « Retour » est masqué) : sans clavier (écran tactile), plus rien ne
  permettait de rouvrir la barre latérale ni de quitter l'article. Dans la
  liste, il vit dans un rail étroit à gauche, qui ne recouvre aucune ligne.
- **Un repère « Aléatoire »** à côté du titre quand un tirage est en cours et
  que son bouton est masqué ; le toucher fait sortir du tirage.

## Corrections et améliorations

- **La palette ne propose plus « Traduire » sur une traduction qui vient de
  s'afficher.** Pendant un court instant, avant le retrait de son écouteur, le
  volet répondait encore « oui ». C'était aussi un rouge possible en CI, de même
  forme que celui de « Résumer » corrigé en 1.8.0.
- **Échap dans les Préférences ne referme plus aussi l'article.** En grille,
  avec un article ouvert, une seule pression fermait les Préférences et
  ramenait à la grille.
- **Retour sur l'onglet sans perdre sa place** (#30). Après avoir fait
  défiler un long flux, revenir sur FriRSS relisait la liste en ne gardant
  que sa première page : la position retombait près du haut. Seul le haut
  est désormais relu, les articles déjà chargés restent, sans doublon ni
  désordre quand le bas de la liste a été lu ailleurs ; une page en route
  pendant une relecture complète ne crée plus de trou dans la liste, une page
  de suite en cours de chargement n'est plus perdue, et les étiquettes et
  abonnements modifiés sur un autre appareil sont relus.
- **↓ ne saute plus les non-lus après un retour sur l'onglet.** L'article
  ouvert reprend sa place parmi ses voisins (défaut présent depuis 1.2.0).
- **La liste suit le clavier et garde sa position par vue.** ↓/↑ font défiler
  la liste jusqu'à la ligne choisie ; chaque flux s'ouvre à sa propre
  position (en haut s'il n'a jamais été vu) ; une liste revenue au bas d'une
  page charge la suite ; passer de la liste à la grille garde l'article du
  haut.
- **Article complet : moins de requêtes, de meilleurs extraits.** Une page
  qui ne s'extrait pas n'est plus redemandée à chaque ouverture, une vidéo
  YouTube n'est jamais envoyée à l'extraction, et un site qui refuse n'est
  plus sollicité une deuxième fois. Les avis du CERT-FR ne se réduisent plus
  à un fragment (« Solutions » ou l'en-tête du document) : quand la page
  désigne son contenu principal et que l'extraction n'en garde qu'une petite
  part, une seconde passe le reprend. Les images chargées « à la demande »
  (Numerama, Frandroid…) et celles enveloppées dans un bouton de zoom
  (Zoomit) sont gardées ; publicités, mentions d'affiliation, formulaires
  d'abonnement et replis CodePen en double sont retirés ; le corps d'un
  article réparti en plusieurs blocs (Ars Technica) est gardé en entier,
  chapeau compris, de même que celui d'un article Clubic coupé par ses
  intertitres, ses images légendées ou ses tweets (il n'en restait que la
  dernière section). Les gros avis du CERT-FR gardent leurs sections
  (Risques, Systèmes affectés, Résumé, Solutions) au lieu de se réduire à la
  liste de leurs références. Les voiles de consentement des vidéos et tweets
  intégrés (les tweets et vidéos qu'ils masquent restent), les encarts payants
  (BleepingComputer) et les liens « retour en haut » ne s'invitent plus dans
  l'article. Un extrait bien plus court que le contenu du flux, ou qui
  n'en contient presque rien, n'est pas montré automatiquement (« Article
  complet » demandé à la main le montre quand même, et le résumé IA porte sur
  le texte affiché). Un échec d'extraction automatique s'annonce discrètement
  sous l'article, avec « Réessayer », au lieu d'un bandeau rouge ; un refus
  passager du site n'est pas retenu. Les extraits mis en cache avant la mise
  à jour sont refaits une fois ; si la nouvelle extraction échoue, l'ancien
  extrait reste affiché (favoris épinglés compris, avec leurs images).
- **L'article complet ne perd plus de texte.** Quand l'extraction laisse de
  côté une partie de l'article (chapeau ou image d'en-tête chez The Verge,
  Google ou Ars Technica, articles du blog de Docker remplacés par leurs
  « articles liés », moitié d'un dossier Clubic, liste d'offres d'un bon
  plan, vidéo de DeepMind), FriRSS la remet à sa place à partir du conteneur
  que la page désigne pour son article, sans ramener la signature de l'auteur,
  les commentaires ni ce que le site marque comme hors extrait. Un bloc de
  code n'est plus jamais retiré, et le texte d'un bouton placé dans du code
  est gardé (les exemples de code du blog de Node.js sortaient troués). Le
  sommaire d'un article reste. Un chapeau, une photo d'en-tête ou une légende
  que la page écrit deux fois pour deux mises en page (The Verge, Ars
  Technica) ne s'affiche qu'une fois ; jamais dans le corps du texte. Mesuré
  sur 490 pages réelles contre le contenu de leur flux : le texte du flux
  absent de l'extrait passe de 1 115 phrases (1.8.0) à 22, qui ne sont
  presque toutes pas de l'article. Une publicité peut encore passer ; une
  phrase de l'article, non.
- **Les médias de l'article aussi.** Les images chargées à la demande dans une
  `<picture>` (Clubic), les vidéos YouTube derrière un voile de consentement
  (Numerama) ou chargées au clic (Journal du Geek), les vidéos et citations du
  blog de Google, les questions d'une FAQ et l'image d'en-tête dans son lien
  d'agrandissement (Ars Technica) sont gardées, de même que les photos d'un
  dossier Clubic et leurs légendes, rangées entre deux blocs du texte ;
  l'en-tête du blog de Google n'est plus flou, et le logo Google « source
  préférée » (Les Numériques) n'entre plus dans l'article. La photo du flux
  n'est plus affichée une seconde fois au-dessus d'un article qui s'ouvre
  déjà sur elle, à un autre recadrage. Sur 401 pages, les médias d'article
  manquants passent de 937 (1.8.0) à 256, surtout des vignettes et avatars.
- **Images affichées à leur vraie largeur** : les images différées dont la
  page écrit `sizes="auto"` (blog de GitHub, Frandroid) restaient à 300 px
  dans le volet, contenu du flux compris.
- **La préparation hors ligne suit le réglage « Article complet ».** Elle
  n'extrait plus que les articles qui s'ouvriraient en article complet : avec
  « Article complet par défaut » éteint (le réglage d'origine), seuls les flux
  réglés sur « Oui » le sont, là où elle extrayait tout jusqu'ici. Favoris et
  À lire plus tard restent extraits. Un article refusé parce que le serveur
  est occupé est redemandé en fin de passage ; la préparation dit quand elle
  attend le serveur, et son bilan distingue les articles prêts avec leur
  article complet.
- **Vidéos YouTube affichées une seule fois** (iframe dans l'article, ou
  vignette du flux sous la façade). Un lien vers YouTube au milieu d'une
  phrase reste un lien et garde son texte : il devenait un bouton « Ouvrir sur
  YouTube » qui effaçait les mots de la phrase. Une adresse d'article qui ne
  fait que citer YouTube n'est plus prise pour une vidéo.
- **Hors ligne, rien de silencieux.** Relancée sans réseau, l'app annonce
  toujours ses actions en attente ; « Tout lu » hors ligne ou en échec le dit.
- **Étiquettes et catégories : les noms déjà pris sont refusés avec une
  explication** (étiquette au nom d'une catégorie, renommage vers un nom
  existant), au lieu d'échouer en silence ou d'annoncer un faux succès ; une
  catégorie vide de FreshRSS n'est plus proposée comme étiquette ; renommer
  ou supprimer l'étiquette ou la catégorie affichée met la vue à jour ;
  renommer une étiquette enfant la garde dans son groupe ; un nom de
  catégorie avec « / » dit pourquoi il est refusé.
- **Palette** : une faute de frappe suivie d'Entrée ne crée plus d'étiquette ;
  Échap et les flèches marchent quel que soit le focus ; la commande
  Aléatoire dit si elle entre dans le tirage ou en sort.
- **Raccourcis** : Début, Fin, Page préc. et Page suiv. sont refusés (touches
  du navigateur) et nommés dans chaque langue.
- **Recherche** : les guillemets ne font plus échouer une recherche ; le champ
  suit l'écriture de droite à gauche.
- **Échap dans le sélecteur de couleur d'une étiquette** ne ferme plus toutes
  les Préférences.
- **Tablette** : plus de séparateur orphelin en bout de ligne dans l'en-tête de
  la liste. **Grille** : un nom de flux long tient sur une ligne.
- **Accessibilité** : zoom à deux doigts autorisé ; lignes et cartes
  d'articles qui ne sont plus des boutons contenant des boutons ; filtres Non
  lus et Favoris qui annoncent leur état ; article ouvert signalé ; liste
  cachée derrière l'article inatteignable au téléphone, et focus rendu à la
  ligne ou à la carte de l'article à sa fermeture, sur tous les formats ; erreurs des boîtes d'ajout annoncées ; champs et
  pastilles de couleur nommés ; palette à la structure valide ; aide-mémoire
  défilable au clavier sous Safari ; chevron de catégorie plus large au
  doigt ; repères `main` et titres de page.
- **Langues** : le menu de densité porte le même nom que dans les
  Préférences, dans toutes les langues (en anglais, espagnol, néerlandais,
  polonais, ukrainien et chinois, il s'appelait comme la disposition) ;
  pluriels ukrainiens et polonais corrigés.
- **Connexion** : l'écran de connexion dit quand le serveur a fermé la
  session.
- **Tableaux larges** : ils défilent de côté au lieu d'être coupés, et le
  balayage de l'article laisse faire un tableau ou un bloc de code qui
  défile ; un long `code` en ligne se coupe.
- **Densité Compacte** : le titre garde toujours de la place (il disparaissait
  dans une colonne étroite, et la ligne débordait au téléphone) : la source
  ne prend plus qu'un tiers de la place au plus, le titre au moins les deux
  tiers, et chacun se tronque. Masquer des boutons de ligne ou la source dans
  les réglages rend de la place au titre.
- **Android : le bouton retour ferme la feuille, le menu ou la confirmation
  ouverte**, et rien d'autre (il fermait l'app ou l'onglet).
- **Gestes en rafale** : les écritures d'un même article (lu, favori, À lire
  plus tard, étiquettes, actions hors ligne rejouées) partent dans l'ordre ;
  FreshRSS et l'écran ne divergent plus sur un réseau lent.
- **« Tout lu » et « marquer lus en dessous »** attendent les écritures
  « lu/non lu » encore en route avant de partir.
- **Changer de serveur pendant une écriture** : un geste qui attendait son
  tour (après « Tout lu », par exemple) ou une action hors ligne rejouée ne
  part plus vers le nouveau serveur ; il attend le retour du sien.
- **Relève** : si FriRSS redémarre pendant une relève, elle se conclut
  aussitôt en « Relève inachevée » et relit la liste, au lieu de bloquer le
  bouton dix minutes.
- **Ajouter un flux** : la nouvelle catégorie suit les mêmes règles que dans
  les Préférences (pas de « / », pas le nom d'une étiquette, une catégorie
  existante est réutilisée), et un flux déjà suivi est signalé.
- **Divers** : « Erreur de chargement » ne s'affiche plus sur une vue qu'on
  vient de quitter ; un flux renommé renomme sa source sur les cartes déjà
  chargées ; le bouton « Enregistrer » du thème et la légende IA tiennent à
  320 px dans toutes les langues ; l'échec d'« Article complet » est annoncé
  et propose « Réessayer » ; l'aide « ? » et les Préférences listent les
  mêmes gestes, ⌘K / Ctrl+K compris ; le libellé « Ajouter un flux » du tiroir
  est dans son bouton ; un « Déjà en français » mis en cache avant la mise à
  jour est revérifié.
- **Aperçus des cartes** : les entités HTML sont décodées (« &amp; »
  s'affiche « & »).
- **Résumés IA** : un résumé en arabe ou en persan s'affiche de droite à
  gauche ; « Traduire » ne répond plus « Déjà en français » à un texte qui ne
  l'est manifestement pas ; le markdown que certains modèles ajoutent est
  nettoyé.
- **Focus** : « Résumer », « Préparer » et « Annuler » rendent le focus au
  bon endroit, comme « Oublier cette recherche », « Nouveau tirage » et
  « Réessayer » sur l'écran vide ; un bouton qui disparaît au clic passe le
  focus ; le piège à focus ignore les éléments hors de l'ordre de tabulation
  et tient Tab au-dessus d'une boîte restée dessous.

## Sécurité

- **Le jeton d'écriture de FreshRSS ne quitte plus le serveur.** Le proxy
  signe lui-même les écritures. Avant, le navigateur recevait l'équivalent du
  jeton FreshRSS complet, qu'une session FriRSS suffisait à obtenir et qui
  restait valable après la déconnexion. Les adresses détournées (segments
  `..` encodés) qui permettaient encore de le lire sont refusées.
- **Une page piégée ne peut plus geler FriRSS** (défaut présent depuis 1.4.10).
  Une page web aux éléments imbriqués sur des milliers de niveaux occupait
  le serveur de quelques secondes à plusieurs minutes, pour tous les comptes,
  dès qu'on demandait son article complet (y compris par l'extraction
  automatique ou la préparation hors ligne). Une telle page est maintenant
  refusée en quelques millisecondes, l'analyse tourne à l'écart du serveur
  avec un délai de 10 secondes, et un échec est retenu quelques minutes.
  Quand le serveur refuse une page ou est occupé, l'app ne refait plus
  l'extraction elle-même (elle pouvait geler l'onglet).
- **Cache Redis indexé par serveur** : deux serveurs à la même adresse
  (deux utilisateurs FreshRSS) ne partagent plus leurs listes en cache ; la
  liste d'un serveur supprimé ou changé d'identité est purgée.

## Sous le capot

- **nginx** : la page 404 porte les mêmes en-têtes de sécurité que le reste.
- **Image plus légère** : les tests compilés du serveur ne sont plus livrés.
- **Sauvegardes** : la date et la version sont authentifiées (format v2) ;
  les anciennes sauvegardes s'ouvrent toujours, l'aperçu écrit la date en
  toutes lettres. ⚠️ Une sauvegarde 1.9.0 ne se restaure pas sur une version
  antérieure.
- **API plus stricte** : réglages d'administration écrits tout ou rien, corps
  mal formés refusés en 400 (et non 500), doublon de serveur détecté par son
  origine normalisée, clé `__proto__` des préférences rendue telle quelle,
  manifeste servi en `application/manifest+json`.
- **Compteurs Favoris / À lire plus tard** : relevés seulement quand le
  réglage change, plus à chaque réaffichage de la barre latérale ; totaux et
  non-lus comptés de la même façon.

- **Une méthode de test écrite.** `docs/TESTING.md` décrit le déroulé d'une campagne avant
  release, la gravité qui bloque une release, la carte des zones à couvrir et
  les règles « Corriger sans en casser d'autres ».
- **Un corpus de non-régression de l'extraction** (`scripts/corpus/`) :
  capture de pages réelles avec le contenu de leur flux, comparaison de deux
  versions de l'extracteur phrase par phrase, image par image et contre le
  flux ; une perte bloque le commit.
- **Un registre des régressions.** `docs/REGRESSIONS.md` recense les bugs passés, ce
  qui les protège, et la checklist manuelle d'avant release.
- **Plus de sortie en échec avec tous les tests verts.** `useReturnFocus` pouvait
  réveiller son minuteur après la destruction de jsdom (`document is not
  defined`).

## [1.8.0] - 2026-10-31

## Fonctionnalités

- **Le mot de passe API d'un serveur se change sur place.** Préférences ›
  Flux, dans la ligne du serveur : « Changer le mot de passe API ». FreshRSS
  vérifie les nouveaux identifiants avant qu'ils soient enregistrés. Il
  fallait jusqu'ici supprimer le serveur puis le rajouter, et les actions
  faites hors ligne en attente pour lui ne repartaient plus ; elles repartent
  désormais dès l'enregistrement si c'est le serveur actif, sinon dès qu'on
  bascule dessus.
- **Grille : la taille des cartes et le format de leur image se règlent**
  (issue #26). Préférences › Apparence › Tailles, section « Grille » : un
  curseur « Largeur des cartes » (160 à 480 px, au pixel, 240 par défaut), un
  interrupteur « Remplir la ligne » et un choix « Format d'image » (16:9, 4:3
  ou 1:1). Activé (par défaut), les cartes s'élargissent pour remplir la ligne
  et la largeur est un minimum ; désactivé, elles gardent exactement la
  largeur choisie et la grille se centre. Sur téléphone, la largeur est
  réduite d'un tiers, la grille remplit toujours l'écran, et une grande carte
  ne déborde jamais. Synchronisés entre
  appareils, indépendants du thème, remis aux défauts par « Réinitialiser les
  tailles ». Les défauts ne changent rien à la grille actuelle.
- **Changer son mot de passe.** Préférences › Général, section « Compte » :
  un compte local change lui-même son mot de passe (actuel, nouveau,
  confirmation). Jusqu'ici, seul un administrateur pouvait le réinitialiser.
  Les autres sessions du compte sont fermées, et un mauvais mot de passe
  actuel est dit sans déconnecter ; les gestionnaires de mots de passe savent
  à quel compte rattacher le nouveau. La route existait sans écran et sans
  limite : elle est désormais limitée à 10 échecs par quart d'heure, compte
  par compte.
- **Affichage aléatoire** (#27). Un bouton dans la barre de la liste tire des
  articles au hasard dans la vue affichée, sous Tous ou Non lus, comme l'ordre
  aléatoire de FreshRSS, avec un nouveau tirage en fin de liste. Le nombre d'articles
  et leur ancienneté maximale, en heures ou en jours, se règlent dans Préférences ›
  Général. Le choix reste, vue par vue et serveur par serveur, et se fait aussi depuis
  le menu d'un flux (clic droit ou appui long), dans « Ordre de ce flux ». Hors ligne,
  ou quand le serveur ne répond pas, la vue s'ouvre normalement avec sa liste gardée.
  « Tout lu » et le marquage au-dessus / en dessous sont masqués pendant un tirage.

## Sécurité

- **SSO : un compte existant ne se rattache plus tout seul par son adresse
  e-mail.** La première connexion SSO prenait le compte local qui portait la
  même adresse, sans exiger qu'elle soit vérifiée : quelqu'un qui inscrivait
  l'adresse de l'administrateur dans son profil chez le fournisseur recevait
  son compte. Le rattachement se fait désormais depuis le compte, connecté :
  Préférences › Général › Compte, « Lier à … », avec le mot de passe actuel :
  une session volée ne suffit plus. Le retour du fournisseur ne rattache rien
  à lui seul, il remet un ticket que seul le compte qui a lancé la liaison valide,
  depuis l'une de ses sessions — un cookie déposé par un site voisin du même
  domaine ne suffit pas — et qui ne sert qu'une fois. Délier ferme toutes les
  autres sessions du compte : rien ne dit lesquelles viennent du SSO, et une
  identité rattachée à tort gardait sinon la sienne jusqu'à 30 jours.
  Un compte se délie depuis la même section, ou par l'administrateur, qui voit
  désormais quels comptes sont liés (« Local + SSO »). Une connexion SSO qui
  tombe sur une adresse déjà utilisée explique la marche à suivre.
- **Les jetons FreshRSS ne suivent plus une adresse changée.** Changer l'hôte
  (ou le port, ou le schéma) ou le compte d'un serveur par l'API gardait les
  deux jetons, que FriRSS
  envoyait ensuite au nouvel hôte : une session FriRSS suffisait à les faire
  sortir. Il faut désormais fournir un nouveau jeton, et le jeton maître est
  oublié. Changer l'adresse ou le compte d'un serveur ne se fait pas depuis
  l'interface.
- **Derrière un reverse proxy, la limite de connexion vise enfin chaque
  client.** Toutes les requêtes semblaient venir du proxy : dix mauvais mots de
  passe envoyés par un inconnu bloquaient la connexion de tous les
  utilisateurs pendant 15 minutes. L'image lit maintenant l'adresse réelle
  transmise par un proxy du réseau privé, et relaie le schéma `https` (cookies
  du SSO enfin `Secure`).
- **SSO : l'adresse de retour ne dépend plus d'un en-tête du client**
  (`X-Forwarded-Host`), quand `FRIRSS_BASE_URL` n'est pas défini.
- **Administration : l'instance ne peut plus se retrouver sans
  administrateur par l'API** — un admin ne se désactive plus avec une valeur
  non booléenne, et un rôle vide est refusé.
- **Connexion : la réponse ne trahit plus quels noms de compte existent** (même
  délai, « compte désactivé » seulement après le bon mot de passe).
- **Deux inscriptions simultanées sur une instance neuve** ne créent plus deux
  administrateurs.
- **Proxy : les adresses IPv6 qui embarquent une IPv4 privée** sous forme
  hexadécimale (`[::ffff:7f00:1]`) ou NAT64 sont reconnues comme internes.
- **Extraction d'article : pages de 2 Mo au plus** (5 Mo avant). Une page
  plate de 5 Mo, faite pour coûter cher, immobilisait le serveur ~3 s pour
  tous les utilisateurs. Une page d'article réelle reste bien en dessous ;
  au-delà, elle n'est plus extraite (le navigateur ne la relit pas non plus),
  et l'article garde le contenu de son flux.
- **Le journal du retour SSO n'écrit plus l'adresse e-mail** de chaque
  connexion.
- **SECURITY.md** : la clé IA personnelle est bien supprimée quand l'admin
  déplace un fournisseur (la note disait le contraire) ; un flux peut faire
  émettre des requêtes vers le réseau interne sans compte (DNS rebinding) ; le
  mode « SSO uniquement » masque le formulaire local sans refuser les mots de
  passe.
- **Une adresse d'article qui n'est pas `http`/`https` n'est plus
  jamais ouverte ni rendue en lien.** Une adresse `javascript:` ou `data:`
  fournie par un flux pouvait devenir un lien (icône « ouvrir à la source »,
  « Original », titre du volet, feuille du bas) ou un onglet (`window.open`,
  touche `o`, « ouvrir le site » d'un flux) ; React ne neutralisait que
  `javascript:` dans les liens, rien dans `window.open`. Toutes ces entrées
  passent désormais par un même filtre : l'élément n'est pas un lien, rien ne
  s'ouvre, « Ouvrir à la source » disparaît du menu. Partager et copier le
  lien gardent l'adresse telle quelle (ils n'exécutent rien).
- **Une seule inscription piégée ne gèle plus l'instance.** Le contrôle de
  l'adresse e-mail, fait sans compte et même inscriptions fermées, devenait
  quadratique sur un `@` suivi de points : une requête bloquait le serveur
  plus d'une minute (des heures au plafond de 5 Mo). Même défaut sur les
  barres finales de l'URL d'un serveur, rejoué à chaque requête une fois
  l'URL enregistrée, sur la lecture du jeu de caractères d'une page extraite
  (en-tête et balise `<meta>`) et sur la clôture d'une réponse de traduction.
  Ces cinq contrôles sont désormais linéaires, et l'URL d'un serveur doit
  être en http(s) et tenir en 2 048 caractères.
- **La limite de tentatives de connexion ne se contourne plus en IPv6** : les
  adresses d'un même bloc /56 partagent leur compteur (connexion, inscription,
  sauvegardes).
- **Le cache des lectures (`REDIS_URL`) ne garde plus que du JSON, au plus
  8 Mo par entrée, et seulement pour les serveurs FreshRSS du compte.**
  N'importe quelle adresse dont le chemin ressemblait à l'API de FreshRSS y
  était écrite, sans plafond, et une réponse démesurée remplissait la mémoire :
  un compte pouvait remplir le Redis, partagé avec le reste de l'hôte. Une page
  de plus de 8 Mo reste servie sans être gardée ; au-delà de 32 Mo, la lecture
  est refusée. Chaque compte a aussi sa part de ces lectures (4 à la fois, 64 Mo
  par minute) : un seul compte pouvait geler l'instance ou saturer sa mémoire.
  Au-delà, la page est relayée telle quelle, sans copie en cache. Un Redis figé
  ne bloque plus les lectures ni le worker.
- **L'extraction d'un article a une échéance totale** : 45 s pour les
  en-têtes, redirections comprises. Six redirections lentes la tenaient près
  de quatre minutes.
- **SSO derrière un proxy sur un port non standard** : l'adresse de retour
  garde son port (nginx transmettait l'hôte sans lui).
- **Proxy : le jeton FreshRSS ne suit une redirection que sur la même origine**, ou
  de `http` vers `https` sur le même hôte aux ports standards. Vers `http`, il aurait
  voyagé en clair, même sur le même hôte.
- **Une instance neuve ne se laisse plus préparer par un inconnu.** Avant la
  création du premier compte, n'importe qui pouvait y restaurer une
  sauvegarde sans administrateur : l'instance restait « vierge », mais réglée
  par lui (secret de session, SSO pointé vers son fournisseur). Une
  sauvegarde sans administrateur actif est désormais refusée. Jusqu'à la
  création du premier compte, une instance neuve reste ouverte à qui la
  trouve : créez-le sans attendre.
- **Le serveur refuse les corps de requête compressés.** Avant toute
  authentification, une trentaine d'octets en brotli devenaient 5 Mo à lire
  et à analyser ; aucun client de FriRSS n'en envoie.
- **La synchronisation en arrière-plan (`CACHE_SYNC_INTERVAL`) ne se bloque
  plus** sur un serveur qui ne termine jamais sa réponse (elle s'arrêtait
  pour tous les comptes jusqu'au redémarrage), et ne lit plus une réponse
  sans fin.
- **Serveurs FreshRSS : nom, identifiant et jetons ont une taille maximale**,
  50 serveurs au plus par compte, et la relève compte dans la limite de
  requêtes par minute. « Tester » n'annonce le jeton refusé que si FreshRSS l'a
  refusé, et le reconnaît sous sa vraie forme, une redirection vers sa page
  d'erreur : limite de requêtes atteinte, test sans réponse ou enregistrement
  raté se disent comme tels.
- **Avec `PROXY_REWRITES`, la relève ne se rabat plus sur l'adresse publique**
  quand l'adresse interne est injoignable : son URL porte le jeton maître, qui
  aurait fini dans le journal du reverse proxy public.
- **Supprimer un compte efface aussi ses listes en cache** (`REDIS_URL`), au
  lieu de les laisser jusqu'à 24 h.
- **`PROXY_REWRITES` : la confiance porte sur l'origine exacte de la règle**
  (schéma, hôte et port), plus sur le nom. Avec un split-DNS, tout compte
  pouvait viser n'importe quel port du reverse proxy derrière le nom public,
  son interface d'administration comprise.
- **Préférences : 4 Mo au total par compte, et une limite de requêtes.** Un
  compte sans droit d'admin pouvait stocker 500 Mo : l'export de sauvegarde de
  toute l'instance échouait alors, et chaque lecture gelait le serveur
  plusieurs secondes. Au-delà, un message le dit une fois : les derniers
  changements restent sur l'appareil et repartent au prochain changement.
  Alléger le logo ou retirer des thèmes libère de la place.
- **Inscriptions ouvertes : 5 comptes par heure et par adresse.** Seuls les
  échecs comptaient : une adresse créait autant de comptes qu'elle voulait. Le
  nom d'utilisateur, le nom affiché et le mot de passe ont aussi une taille
  maximale (64, 128 et 1 024 caractères).
- **Le retour SSO a sa limite, et son `state` ne sert qu'une fois.** Sans
  compte, on pouvait faire envoyer au fournisseur un nombre illimité d'échanges
  de code depuis l'adresse de FriRSS, au risque de faire bannir l'instance par
  une protection placée devant lui. Au-delà de 30 retours par quart d'heure et
  par adresse, l'écran de connexion le dit.
- **Le journal du proxy n'écrit plus jamais la requête d'une URL.** Il écrivait
  les recherches (`q=`) et les paramètres signés des images préchargées ;
  seuls l'origine et le chemin restent.
- **Garde anti-SSRF** : toutes les adresses IPv6 lien-local (`fe80::/10`) sont
  refusées, et non plus seulement `fe80::` et `fe9…` à `feb…`.

## Corrections et améliorations

- **Un réglage changé hors ligne n'est plus perdu.** Ouverte sans réseau, l'app
  attendait de joindre le serveur pour suivre les modifications : un réglage
  changé entre-temps (thème, favicons, catégorie repliée…) était recouvert
  par la valeur du serveur dès le retour du réseau. Il gagne désormais, et
  part, même si l'app est fermée puis rouverte avant le retour du réseau, et
  même après plusieurs modifications faites hors ligne ; et ce retour est vu
  tout de suite.
- **« Tout lu » ne vise plus un autre serveur.** Basculer de serveur pendant
  le relevé des non-lus envoyait le marquage au serveur devenu actif, où le
  même numéro de flux désigne souvent un autre flux. Rien ne part si le
  serveur ou la session a changé. Et ouvrir un autre flux pendant le relevé
  ne vide plus sa liste ni n'affiche lu son article ouvert : le flux demandé
  est marqué, la vue devenue active n'est pas touchée.
- **Changer de serveur pendant un chargement lent** n'affiche plus les
  abonnements de l'ancien et n'éteint plus l'indicateur de synchronisation
  du nouveau.
- **Se désabonner : Échap ne referme plus la boîte pendant la requête.**
- **Le curseur « Corps » (Préférences › Apparence › Tailles, section
  Lecture) agit enfin sur téléphone et tablette.** Il changeait la taille de l'ordinateur, sans effet visible sur
  l'appareil, où la taille du texte vient d'un réglage propre (celui des
  boutons A− / A+). Il règle désormais cette taille-là, et le dit. Ses bornes
  sont aussi celles des boutons (10 à 24 px sur ordinateur, 13 à 26 px au
  doigt ; il s'arrêtait à 12-20). « Réinitialiser les tailles » remet aussi la
  taille de l'appareil.
- **Thèmes sombres : les survols se voient.** Une soixantaine de boutons et de
  rangées s'assombrissaient au survol, invisible sur Night ou Desk ; ceux de
  la barre latérale s'éclaircissaient, invisible sur une barre claire. Ils
  prennent maintenant une teinte tirée de la couleur du texte. Les messages
  d'erreur (connexion, ajout d'un serveur ou d'un flux, import de thème)
  prennent la couleur de danger du thème au lieu d'un rouge fixe.
- **Barre des raccourcis : plus de défilement horizontal.** À 1280 px avec un
  article ouvert, elle débordait et poussait la palette et l'aide hors de vue.
  Les raccourcis qui ne tiennent pas sont masqués, la palette et l'aide
  restent toujours visibles, et « Échap » passe en tête en mode Focus.
- **Les boîtes de confirmation rendent le focus** au bouton qui les a ouvertes
  (il tombait sur la page, et Échap ne fermait plus les Préférences), et un
  double-clic sur ce bouton ne les referme plus aussitôt.
- **Compte d'un flux : il ne disparaît plus après un survol.** Le compte de
  non-lus laissait la place au bouton « ⋯ » et restait parfois caché, la
  souris partie ; sur tablette, le flux touché perdait son compte jusqu'à la
  tape suivante.
- **Recherche** : Échap la ferme même après avoir cliqué la loupe, le focus
  revient au bouton « Rechercher », l'en-tête dit « Recherche : … », et le
  nombre de non-lus de la vue ne s'affiche plus à côté des résultats.
- **Préférences : une seule typographie.** Les onglets IA et Administration
  avaient leurs propres titres (gras, précédés d'une barre colorée) et un texte
  plus grand ; ils prennent ceux des autres onglets.
- **Accessibilité : clavier et lecteurs d'écran.** Les menus (article, flux,
  serveurs, étiquettes, traduction, résumé) se parcourent aux flèches et
  rendent le focus au bouton qui les a ouverts. Les boutons à icône seule ont
  tous un nom (les « A » de la barre latérale s'annonçaient « A »), et les
  boutons à bascule disent leur état. Les libellés d'« Ajouter un flux »,
  « Ajouter un serveur » et de la sauvegarde sont reliés à leur champ. Le
  tiroir mobile fermé n'est plus atteignable à la tabulation. Les messages
  (confirmations, hors ligne, relève) sont annoncés de façon fiable. Les
  boutons à bascule (favori, à lire plus tard, mode Focus, dispositions…)
  gardent un nom fixe et disent leur état. Les champs encore sans nom en ont
  un : couleurs du thème, nom du thème et de l'application, adresse du logo,
  jeton maître, création de compte et SSO, touches des raccourcis. Les
  boutons d'une étiquette disent laquelle ils visent, et les options du menu
  d'un flux de quel réglage elles relèvent. Le formulaire de création de
  compte ne propose plus les identifiants de l'administrateur.
- **Titre de la liste écrasé : lisible au survol.** Avec un article ouvert,
  la barre d'outils le réduisait à « To… » ; l'infobulle donne le titre
  entier.
- **Appui long : un pouce qui tremble ouvre quand même le menu.** Le moindre
  mouvement du doigt annulait l'appui long d'un article (ligne, carte, bouton
  de traduction) ; un pouce posé sur un téléphone n'est jamais tout à fait
  immobile. Il faut désormais bouger de plus de 8 pixels pour l'annuler — un
  défilement ou un balayage le font toujours.
- **Appui long puis glisser : le menu s'ouvre, et rien d'autre.** Sur
  téléphone, garder le doigt sur un article ouvrait son menu, puis le moindre
  glisser horizontal qui suivait marquait AUSSI l'article lu ou à lire plus
  tard. Les deux gestes s'excluent désormais : un balayage commencé annule
  l'appui long, un menu ouvert par l'appui long bloque le balayage — y
  compris l'appui long sur l'étoile ou « À lire plus tard » de la ligne, qui
  ouvre le classement par catégorie.
- **Android : l'appui long sur un article ouvre son menu à tous les coups.**
  Chrome démarre un glisser-déposer natif de la ligne juste avant les 500 ms,
  puis interrompt le contact : le menu ne s'ouvrait qu'environ une fois sur
  deux (mesuré sur émulateur). Ce glisser est désormais annulé et le menu
  s'ouvre aussitôt — de même pour le classement depuis l'étoile ou « À lire
  plus tard » de la ligne. Le glisser-déposer à la souris, au bureau, ne
  change pas.
- **Retrait assumé : glisser un article sur une étiquette ou une catégorie
  de la barre latérale se fait désormais à la souris seulement.** Au doigt,
  l'appui long gagne toujours : un doigt qui bougeait un peu pendant l'appui
  pouvait encore lancer un glisser à la place du menu. Au doigt, on classe
  par le menu de l'appui long (favori, à lire plus tard), par l'appui long
  sur l'étoile ou « À lire plus tard » (catégorie) ou par les étiquettes du
  volet de lecture.
- **Bureau : glisser un article depuis son étoile n'ouvre plus le classement
  par catégorie en plein glisser.** Le bouton de la souris resté enfoncé
  pendant le glisser armait l'appui long de l'étoile (ou de « À lire plus
  tard »), qui ouvrait son sélecteur au bout d'une demi-seconde.
- **Android : un seul menu, au même endroit, quel que soit l'ordre des
  événements.** Chrome envoie son propre signal de menu un peu AVANT les
  500 ms de l'appui long : sur un flux, le menu s'ouvrait au point du doigt
  puis se rouvrait au bord de la ligne (il sautait sous le doigt) ; sur une
  carte de la grille et sur l'étoile ou « À lire plus tard » du volet de
  lecture, il s'ouvrait deux fois. (Sur une ligne d'article, boutons compris,
  le défaut était le glisser natif de l'entrée précédente.) L'appui aboutit
  maintenant dès ce signal,
  une seule fois, et un signal tardif (délai d'appui long rallongé dans les
  réglages d'accessibilité) est ignoré tant que le doigt reste posé.
- **Appui long sur un flux de la barre latérale : le même geste que sur un
  article.** Il tolère lui aussi un léger tremblement et s'annule quand un
  second doigt se pose ou que le système interrompt le contact avant
  l'ouverture.
- **Étoile et « À lire plus tard » de la liste : l'appui long qui range dans
  une catégorie suit la même règle.** Il tolère un léger tremblement,
  s'annule sur un second doigt ou une interruption du système, et à la souris
  seul le bouton principal maintenu l'arme (maintenir le bouton droit
  l'armait aussi, en plus du menu du clic droit).
- **Volet de lecture : l'appui long sur « Favori » et « À lire plus tard »
  suit la même règle** — même tolérance, même
  annulation, et seul le bouton principal de la souris maintenu l'arme. Il
  n'existe plus qu'une seule implémentation de l'appui long dans toute l'app,
  au lieu de quatre.
- **Clic molette sur le titre d'un article : l'onglet s'ouvre en
  arrière-plan.** Il s'ouvrait au premier plan et faisait quitter FriRSS. Le
  titre d'une ligne et d'une carte de la grille est désormais un vrai lien,
  comme dans FreshRSS : clic molette, ⌘-clic ou Ctrl-clic l'ouvrent en
  arrière-plan (Maj-clic dans une nouvelle fenêtre), et l'article est marqué lu sans changer celui qu'on lit. Le
  clic simple sélectionne toujours l'article, l'apparence du titre ne change
  pas, et l'appui long au doigt sur le titre ouvre toujours le menu. Ailleurs
  sur la ligne, le clic molette garde son comportement. Seules les adresses
  `http`/`https` deviennent un lien.
- **Chinois : le statut des résumés et traductions IA se lit avec la virgule
  pleine chasse « ， »** au lieu d'une virgule latine en dur (en-tête du
  panneau, annonce aux lecteurs d'écran, bandeau de traduction). Nouvelle clé
  `ai.separator` dans les dix locales.
- **Lecteurs d'écran : l'annonce d'un résumé dit aussi la bascule de
  fournisseur** (« X indisponible »), celle du résumé comme celle de sa
  traduction. L'en-tête visible la montrait déjà ; l'annonce la taisait.
- **Préférences : un appareil resté ouvert n'écrase plus les réglages changés
  sur un autre.** Chaque changement renvoyait tous les réglages synchronisés,
  et le serveur n'était relu qu'au démarrage : replier le panneau IA sur le
  téléphone, puis replier une catégorie sur l'ordinateur resté ouvert, rouvrait
  le panneau partout. Désormais seuls les réglages modifiés partent, et l'app
  relit ceux des autres appareils sans rechargement : en revenant au premier
  plan, quand sa fenêtre reprend le focus, et chaque minute tant qu'elle reste
  affichée (un onglet laissé ouvert sur l'ordinateur ne passe jamais en
  arrière-plan quand on prend le téléphone). Une modification qui n'a pas pu partir — réseau coupé en
  cours de route, app fermée juste après — n'est plus perdue : elle repart au
  retour du réseau, au retour dans l'app ou au démarrage suivant. Elle reste
  attachée à son compte : si un autre compte se connecte sur le même
  navigateur (SSO compris), elle ne part pas chez lui, pas même pendant la
  lecture de ses réglages ; et se déconnecter —
  ou voir sa session expirer — l'abandonne. Un réglage refusé par le serveur
  (logo trop lourd) n'empêche plus les autres de s'enregistrer.

- **Retour SSO : une coupure réseau passagère ne renvoie plus à l'écran de
  connexion.** Si la lecture du profil échoue juste après la redirection, elle
  est réessayée jusqu'à quatre fois (1, 2, 4 puis 8 s), chaque essai
  abandonné au bout de 15 s : un serveur muet est constaté en une minute et
  demie au plus. Seule une session réellement refusée déconnecte tout de
  suite ; après le dernier échec, l'écran de connexion dit que le serveur n'a
  pas répondu (clé existante `login.errorUnavailable`). Se déconnecter (ou se
  reconnecter autrement) pendant ces essais les arrête net, sans rouvrir ni
  fermer de session : la réponse tardive d'un essai, même refusée, ne ferme
  plus la session ouverte entre-temps (plus généralement, un refus ne
  déconnecte que s'il répond au jeton encore en place).

- **Plus aucune requête n'attend indéfiniment.** Un serveur FreshRSS (ou une
  page) qui envoyait le début de sa réponse puis ne finissait jamais tenait
  l'écran en attente jusqu'à deux minutes, sans fin bornée côté navigateur.
  Le proxy de FriRSS borne désormais chaque requête à environ une minute (504 clair
  si rien n'est arrivé, réponse coupée sinon), et le navigateur attend
  toujours plus longtemps que le serveur : 75 s pour les appels courants,
  150 s pour l'IA et la sauvegarde. Un délai dépassé ne déconnecte jamais.

- **Recherche : ce qu'on fait sur les résultats y reste.** Un article coché lu
  (ou mis en favori, à lire plus tard) dans les résultats redevenait non lu en
  cliquant « Charger la suite », et une étiquette posée depuis un résultat
  disparaissait à la recherche suivante.
- **Recherche : Rafraîchir et tirer-pour-rafraîchir ajoutent les nouveaux
  articles qui correspondent**, en tête des résultats, sans rebalayer tout le
  flux. Le spinner tournait jusque-là sans effet, et la liste pouvait rester
  bloquée sur son squelette de chargement.
- **Recherche : « Tout lu » rend la vue du flux.** La liste gardait les
  résultats sous l'en-tête du flux, sans pouvoir charger la suite.
- **Recherche : les accents codés en entités sont trouvés** (« été » trouve
  `&eacute;t&eacute;`, « l’avion » écrit avec `&rsquo;`…), le code des
  `<script>` et `<style>` n'est plus cherché, et une entité numérique invalide
  ne fait plus échouer tout le balayage.
- **Recherche : balayage plus léger** sur les gros flux (chaque page n'est plus
  refiltrée avec tout ce qui précède), et les articles gardés en mémoire pour
  la recherche sont libérés à la déconnexion.

- **« Tout lu au-dessus / en dessous » : la barre de progression s'allume, et
  deux marquages d'affilée se suivent.** Le marquage n'avait aucun signe à
  l'écran ; il utilise désormais la barre du haut, comme « Tout lu » — chiffrée
  (par lots de cent) en « au-dessus » une fois le total connu. Lancer un second
  marquage avant la fin du premier le met en attente (la barre est déjà là)
  au lieu de le croiser : avant, un premier marquage refusé pouvait repasser
  non lues des lignes que le second venait de marquer, et la recherche
  pouvait montrer lus des articles que le serveur avait en non-lus pendant
  cinq minutes. Même chose quand on rafraîchit pendant qu'un marquage est en
  vol dans une recherche. Un marquage en attente ne
  part plus vers un autre serveur FreshRSS si l'on change de serveur (ou si
  l'on se déconnecte) entre-temps.

- **Bandeau « nouveaux articles » : plus d'arrivées perdues après un
  renommage.** Renommer ou supprimer une catégorie, déplacer ou ajouter un
  flux rechargeait les compteurs sans rien compter : les articles arrivés
  dans la minute précédente n'étaient jamais signalés. Ils le sont
  désormais. Ajouter un flux n'annonce pas pour autant tout son stock comme
  « nouveau », et Rafraîchir ne compte pas deux fois ce que sa propre
  notification annonce déjà. Et un chargement des abonnements parti juste
  avant un changement de serveur n'écrit plus les flux et les compteurs de
  l'ancien serveur par-dessus ceux du nouveau.
- **Le bandeau « nouveaux articles » ne cache plus le séparateur du jour.**
  Tant qu'il s'affiche, le libellé de date collé en haut de la liste (liste et
  grille) se place juste en dessous au lieu d'être recouvert.
- **Plus aucun raccourci n'agit derrière un menu ouvert.** Six menus coupent
  maintenant le clavier tant qu'ils sont ouverts, même si le focus est
  ailleurs : le menu contextuel d'un article (clic droit sur ordinateur), le
  menu d'un flux, le sélecteur de catégorie, les menus « Traduire en… » /
  « Résumer avec… », la liste d'étiquettes du volet de lecture et le menu
  « Gérer » du sélecteur de serveur. `t` et `s` ne lancent plus de traduction
  ou de résumé (peut-être payant) derrière eux, et les flèches ne changent
  plus l'article dessous. Tous se ferment à Échap (quatre d'entre eux ne
  l'écoutaient pas : sans cela le clavier serait resté mort jusqu'à un clic).
  Le contenu d'un article ne peut pas se faire passer pour un de ces menus :
  le marqueur qu'ils portent est retiré du HTML des flux, et ignoré s'il
  apparaissait quand même dans le corps de l'article.
  Les fenêtres « Ajouter un flux » et « Ajouter un serveur » possédaient déjà
  l'écran mais pas le clavier : avec le focus sur un de leurs boutons, `t` et
  `s` agissaient derrière elles. Elles le coupent désormais, et toutes deux
  se ferment à Échap quel que soit le focus : « Ajouter un serveur », ouverte
  depuis les Préférences, laissait passer la touche au panneau, qui se
  fermait tout entier en perdant les identifiants saisis.
- **Lecteurs d'écran : les curseurs de la page Tailles disent ce qu'ils
  règlent.** Taille du texte des titres, des résumés, de l'article, largeur
  des cartes : chacun était annoncé « curseur, 240 », sans nom. Il porte
  désormais celui de sa ligne et sa valeur en pixels.
- **L'application ne remonte plus en laissant une bande blanche.** Les
  compteurs de non-lus des catégories, lus par les lecteurs d'écran,
  allongeaient la page bien au-delà de l'écran : une molette au-dessus d'une
  zone qui ne défile pas, ou l'ouverture des Préférences, faisait glisser
  toute l'application vers le haut, et elle y restait.
- **Vignettes : les images de Reddit (et de tout flux qui échappe ses
  adresses) s'affichent.** L'adresse de l'image partait avec ses `&amp;`
  et le serveur refusait. Et dans la grille, une image qui ne charge pas
  montre l'initiale du flux, comme une carte sans image, au lieu d'une case
  vide.
- **Préférences : Échap pendant un renommage n'annule plus que le
  renommage.** Renommer une étiquette ou une catégorie, ou nommer une
  nouvelle catégorie, puis appuyer sur Échap fermait aussi tout le panneau.
- **Texte lisible sur la couleur d'accent.** Les onglets actifs (Préférences,
  Administration) et une quinzaine de boutons et de pastilles (Préparer le
  hors-ligne, Télécharger la sauvegarde, Enregistrer…) écrivaient en blanc sur la couleur d'accent : sur
  la menthe par défaut, à peine lisible. Ils prennent désormais l'encre
  calculée pour l'accent, comme le reste de l'application.
- **« Ajouter un flux » n'est plus rognée sur téléphone et tablette.**
  Ouverte depuis la barre latérale, la fenêtre restait prise dans le tiroir
  et y était coupée.
- **Barre latérale au toucher** : la section Favoris ou À lire plus tard
  repliée garde son chevron visible (il fallait viser une zone invisible
  pour la rouvrir), et la croix invisible qui supprimait une de leurs
  catégories, sur le serveur et sans confirmation, n'est plus active au
  toucher (la suppression reste possible dans Préférences › Étiquettes).
- **Textes** : l'aide des préréglages de thème annonçait 36 couleurs, il y
  en a 38 (le nombre vient désormais du thème lui-même) ; en français, les
  derniers mots anglais des Préférences sont traduits (« Sidebar »,
  « Header », « Scrollbar », « Reset ») et l'aide du hors-ligne vouvoie
  comme le reste de l'application. Dans les autres langues : des aides qui
  citaient un écran ou un libellé sous un autre nom que le vrai (allemand,
  italien, polonais, ukrainien), « Local + SSO » traduit, la touche Échap
  nommée comme dans les textes, et le mode Focus décrit en « pleine
  largeur » plutôt qu'en « plein écran », qu'il n'est pas.
- **Un mot par notion, dans chaque langue.** Le vocabulaire des dix langues
  est aligné sur le terme majoritaire. En anglais : « Tags » partout (au
  lieu de « Labels » à certains endroits), « Favorite » (au lieu de « Star »),
  orthographe américaine (« Summarize », « Colors »), « log in », « server
  bar ». En espagnol, italien, portugais et ukrainien, un seul mot pour
  « flux ». Les chemins d'écran s'écrivent avec `›` partout.
- **Typographie française** : apostrophe typographique, espaces insécables
  avant `? ! ; :` et dans les guillemets, « hors ligne » sans trait d'union.
- **Une liste qui n'a pas pu se charger le dit.** Si le serveur ne
  répondait pas, la liste affichait « Tout est lu ! » ou « Ce flux est
  vide ». Elle affiche désormais que le chargement a échoué, avec un bouton
  « Réessayer ».
- **Toute action qui défait ou supprime se confirme dans une fenêtre**,
  comme « Tout marquer comme lu » — un double-clic ne peut plus valider à
  votre place. En Administration, donner ou retirer les droits
  d'administrateur, désactiver ou réactiver un compte demandaient un seul clic sur une
  pastille qui ressemblait à une étiquette ; supprimer un compte se validait
  au second clic d'un double-clic. Les boutons « Réinitialiser » des
  Préférences (thème, couleurs, tailles, couleurs des étiquettes, raccourcis
  clavier) passent par la même fenêtre, qui dit ce qui sera perdu, de même que
  toutes les suppressions : se désabonner d'un flux, supprimer une étiquette,
  une catégorie, un serveur, un thème enregistré, effacer sa clé IA
  personnelle ou une catégorie de Favoris / À lire plus tard (qui, elle, ne
  demandait rien).
- **Un échec se dit.** Se désabonner, renommer un flux, renommer ou supprimer
  une étiquette fermaient le menu comme si c'était fait quand le serveur
  refusait ; un message le dit désormais.
- **« Tout réinitialiser » devient « Réinitialiser »** : il promettait de tout
  remettre à zéro (« couleurs, tailles, raccourcis… »), alors qu'il ne
  rétablit que les couleurs et les tailles du thème en cours.
- **Administration : un échec se dit.** Une liste d'utilisateurs qui n'a pas
  pu se charger affichait « 0 utilisateur » ; une action refusée par le
  serveur ne disait rien.
- **Hors ligne : le bouton « Préparer » dit pourquoi il ne répond pas** sans
  réseau, « Vider les images » se confirme, et « Images supprimées » ne reste
  plus affiché une fois le cache rempli de nouveau.
- **Hors ligne : l'espace des images n'est plus gonflé.** « Espace utilisé »
  pouvait annoncer 12 Go pour quelques centaines de Mo réels : le navigateur
  compte plusieurs Mo pour chaque image d'un autre site gardée pendant la
  lecture, dont il ne connaît pas la taille. L'onglet donne maintenant le
  nombre et la taille réelle des images préparées, appelle l'autre chiffre
  « Espace compté par le navigateur » et dit pourquoi il est plus grand. Les
  tailles s'écrivent aussi dans l'unité et avec la virgule de la langue
  (« 12,0 Go » s'affichait en anglais).
- **Hors ligne : les images préparées ne disparaissent plus d'elles-mêmes.**
  Elles partageaient le cache des images vues en ligne : une image préparée
  puis affichée une fois entrait dans sa limite et pouvait en être chassée,
  et un manque d'espace vidait tout. Elles ont désormais leur propre cache,
  que seuls le budget choisi et « Vider les images » gouvernent. Une
  préparation retire aussi ce qui ne sert plus (articles de plus de 30 jours,
  au-delà du budget) et compte dans le budget les images déjà préparées : le
  cache ne dépasse plus la taille réglée d'une préparation à l'autre. Les
  images préparées par une version précédente sont reprises sans être
  retéléchargées.
- **Hors ligne : les images vues en ligne sont limitées aux 500 plus
  récentes** (6 000 jusqu'ici). Le navigateur compte chacune plusieurs Mo
  sans en connaître la taille : 6 000 pouvaient représenter plus de 40 Go
  comptés. Les articles lus récemment restent illustrés hors ligne ; pour les
  plus anciens, c'est la préparation qui garde les images.
- **Hors ligne : une erreur imprévue ne laisse plus « Préparer » en cours**
  jusqu'au rechargement.
- **Hors ligne : un article qui est une vidéo ne fait plus planter la
  préparation.** Quand l'adresse d'un article menait à une vidéo, le serveur
  refusait bien de l'extraire, mais le navigateur réessayait seul et
  téléchargeait la vidéo entière en mémoire : sur Android, l'onglet était
  fermé par le système, toujours au même article, et la préparation n'allait
  jamais au bout. Le navigateur ne réessaie plus dans ce cas, et ne lit plus
  que des pages, de 2 Mo au plus. Par précaution, le serveur ne relaie aussi
  pour la préparation que des images, de 25 Mo au plus.
- **Hors ligne : l'app se remet d'un stockage effacé par le navigateur.**
  Quand le navigateur efface les données du site (manque de place sur
  l'appareil, données effacées à la main), l'app n'arrivait plus à rien
  enregistrer jusqu'au rechargement : les articles préparés n'étaient plus
  gardés, et les actions faites hors ligne (lu, favori) pouvaient être
  perdues. Elle rouvre maintenant son stockage d'elle-même. « Préparer »
  demande aussi au navigateur de protéger ce stockage (Firefox affiche une
  demande d'autorisation ; une fois accordée, elle vaut aussi pour la
  préparation automatique). Et dès que l'appareil n'a plus de place, la
  préparation cesse de télécharger au lieu de le remplir, sans retirer les
  images encore utiles : l'onglet Hors ligne le dit.
- **Plusieurs comptes ou serveurs sur le même appareil : chacun ne voit que
  ses données.** Après une déconnexion, le compte suivant voyait un moment —
  durablement s'il était hors ligne — les flux et les articles du précédent ;
  hors ligne, un serveur pouvait afficher les listes d'un autre, et une liste
  encore en chargement au moment de changer de serveur s'affichait sur le
  nouveau. Préparer le hors-ligne d'un serveur retirait aussi les images
  préparées pour l'autre, même celles qu'ils partagent, et changer de serveur
  pendant une préparation effaçait les images du nouveau. Se déconnecter dans
  un onglet n'efface plus ce qui est gardé hors ligne pour le compte ouvert
  dans un autre. Une seule fois après la mise à jour, avec plusieurs
  serveurs : le premier serveur préparé peut encore retirer les images
  préparées pour l'autre avec la version précédente ; elles sont
  retéléchargées à la préparation suivante de cet autre serveur.
- **Les actions faites hors ligne ne se perdent plus, et n'écrasent plus vos
  gestes suivants.** Un favori ou un « lu » fait pendant que la file se
  rejouait (réseau instable) était oublié ; une action en attente était
  envoyée au serveur actif même s'il n'était pas celui où elle avait été
  faite, ou jetée toute entière si la session avait expiré — ou si l'on se
  déconnectait, ou changeait de serveur, pendant qu'elle se rejouait. Elle
  attend désormais son compte et son serveur, et part dès qu'ils
  redeviennent actifs. Un article que vous marquez à nouveau, une fois le
  réseau revenu, garde votre dernier choix. Le nombre d'actions en attente
  ne compte plus celles des autres comptes. Une action faite avec la version
  précédente, encore en attente au moment de la mise à jour, est envoyée
  comme les autres.
- **Quand FreshRSS refuse les actions en attente, elles ne sont plus
  perdues.** Après un changement du mot de passe d'API FreshRSS, par exemple,
  elles attendaient sans que rien ne dise pourquoi. Elles restent toutes en
  attente, et le bandeau dit que FreshRSS refuse l'authentification et où
  ressaisir le mot de passe API ; elles repartent dès qu'il est enregistré.
- **L'écran « Mise à jour… » ne reste plus affiché.** Recharger la page au
  moment précis où une nouvelle version s'installait pouvait laisser l'écran
  de mise à jour indéfiniment, jusqu'à un nouveau rechargement manuel. La page
  se recharge désormais d'elle-même après quelques secondes.
- **La préparation hors ligne automatique ne saute plus une heure** quand
  l'application se recharge juste après l'ouverture (après une mise à jour).
- **Deux onglets, deux comptes : se déconnecter dans l'un ne déconnecte plus
  l'autre.** Un onglet resté ouvert sur un ancien compte effaçait, en se
  déconnectant, la session et les réglages en attente du compte ouvert
  ailleurs.
- **Se désabonner retire les articles du flux partout**, y compris de ce qui
  est gardé hors ligne (ils réapparaissaient à l'ouverture sans réseau, et
  restaient affichés sous « Tous les flux », avec leur compteur, quand le
  flux était ouvert).
- **« Tout lu » : le retour en arrière ne touche que ce qui vient d'être
  marqué.** Une question annulée laissait son relevé derrière elle, et un
  « Tout lu » ultérieur sur le même flux pouvait rendre non lus des articles
  lus à la main depuis. Le retour en arrière s'arrête aussi si l'on change
  de serveur pendant qu'il tourne.
- **Les articles retirés des favoris ou de « À lire plus tard » libèrent leur
  texte gardé hors ligne**, au lieu de le garder pour toujours — sans toucher
  aux favoris des autres comptes ou serveurs du même appareil.
- **Une page de connexion ou de maintenance ne vide plus la liste.** Quand un
  proxy devant FreshRSS répondait par une page HTML, la liste devenait vide sans
  erreur, et la copie gardée hors ligne était écrasée. C'est désormais une panne
  comme une autre : la liste gardée reste affichée, et « Marquer au-dessus » ne
  marque plus à l'écran ce que le serveur n'a pas reçu.
- **Ce que vous lisez reste lu hors ligne.** Un article lu ou mis en favori
  depuis l'accueil, une catégorie ou un autre flux ne touchait pas les listes
  gardées de son flux : il revenait non lu au trajet suivant. Le geste se
  reporte désormais sur la liste préparée du flux, ses autres listes et celles
  de l'accueil, et s'en retire si le serveur le refuse au final. « Marquer
  au-dessus / en dessous » aussi, et hors ligne, Favoris et À lire plus tard
  ne montrent plus un article qui en a été retiré.
- **Les flux préparés s'ouvrent hors ligne, quel que soit le filtre.** Après
  « Préparer le hors-ligne », un flux ouvert sous le filtre Non lus ou en ordre
  « plus anciens d'abord » échouait à se charger, ou s'affichait à l'envers.
  L'app se sert maintenant de la liste préparée, filtrée et retournée.
- **La préparation rend tous les articles joignables, et le reste.** Elle
  gardait 50 articles par flux dans la liste, alors qu'elle téléchargeait le
  contenu de tous : le reste était introuvable hors ligne, recherche comprise.
  Elle garde désormais tout ce qui a été préparé, sous sa propre liste : une
  visite du flux ne la ramène plus à 50 articles, et une ancienne liste Non lus,
  vidée la semaine passée, ne cache plus les articles préparés depuis.
- **Une lecture ne se défait plus toute seule.** Un article ouvert pendant un
  rafraîchissement pouvait repasser en gras, s'afficher non lu dans le volet,
  et être décompté deux fois en le rouvrant. Même chose pour un favori,
  « à lire plus tard » ou une étiquette posés au mauvais moment, et pour un
  marquage « au-dessus » ou « en dessous », tant que FreshRSS n'a pas répondu.
- **Une action en attente tient sur toutes les listes.** Un article lu hors
  ligne, ou pendant une panne de FreshRSS, repassait non lu en changeant de
  filtre ou au rafraîchissement suivant, et le rouvrir le décomptait une seconde
  fois. La recherche hors ligne voit aussi ces actions, et fouille toute la liste
  préparée à chaque recherche.
- **« Tout lu » vaut pour toutes les vues du flux.** Passer de Non lus à Tous
  après un « Tout lu » repeignait un instant les lignes non lues, et la liste
  hors ligne les gardait. Même chose pour l'accueil. Une page en cours de
  chargement ne ramène plus d'articles non lus sous la liste vidée, et annuler
  le « Tout lu » ne laisse plus les autres vues lues. Un article coché sous Non
  lus en ordre « plus anciens d'abord » ne revient plus non plus au retour sur
  le flux.
- **Les longues listes s'ouvrent vite.** Les 400 articles d'un flux préparé se
  montaient d'un bloc, puis se redessinaient à chaque article ouvert : la liste
  affiche maintenant 50 lignes, puis la suite au défilement. Le clavier, « Tout
  lu » et le retour à sa place depuis un article n'y voient aucune différence.
- **Les grosses sauvegardes se restaurent.** Au-delà de 5 Mo, une sauvegarde
  s'exportait mais était refusée à la restauration ; la limite est désormais
  de 64 Mo, et une sauvegarde plus grosse est refusée dès l'export, avec un
  message qui le dit. Quand un proxy inverse placé devant FriRSS refuse
  l'envoi (1 Mo par défaut avec nginx), le message le dit aussi, au lieu de
  conseiller d'alléger la sauvegarde. L'aperçu d'une sauvegarde sans
  administrateur actif la refuse déjà. Une seule restauration est lue à la
  fois : une seconde, lancée en même temps, reçoit un message qui le dit.
- **Téléphone : un balayage interrompu par le système ne déclenche plus rien
  à la tape suivante.** Quand iOS reprenait le contact (appel, centre de
  notifications), la ligne, le tiroir ou l'article restaient décalés, et la
  tape suivante marquait l'article lu ou refermait le tiroir.
- **Accessibilité, suite.** Les boutons favori et à lire plus tard du volet de
  lecture disent leur état aux lecteurs d'écran, comme les options
  d'affichage et la liste des étiquettes ; un groupe d'étiquettes se replie au
  clavier et dit lequel il replie, et un double-clic ne l'ouvre plus en plus
  de le replier ; le bandeau « Annuler » attend tant qu'on le vise ; les
  Préférences, la palette, l'aide et la feuille du bas rendent le focus en se
  fermant, y compris au bouton d'origine quand l'une a ouvert l'autre ; une
  seule pression d'Échap ne ferme plus à la fois les Préférences et le
  tiroir, et Échap ferme la palette même après un clic dans sa liste ;
  plusieurs messages « Enregistré » sont annoncés de façon fiable. La touche
  Tab ne sort plus des Préférences, de la palette, de l'aide, des feuilles et
  des boîtes de confirmation vers la page restée derrière.
- **Les titres affichent « & », « < » et « > » normalement, et les noms de
  flux aussi « / ».** FreshRSS les remplaçait par des caractères pleine
  chasse (« Tom ＆ Jerry », « r／selfhosted »), qui se voyaient, partaient tels quels dans un titre
  copié ou partagé, et échappaient à la recherche. Les titres de flux qui
  échappent leur texte deux fois affichent aussi leurs emojis et leurs accents :
  🎬 au lieu de « ＆#127916; » (#28). Un article sans titre
  affiche « Sans titre » dans la langue de l'interface, et non plus en
  français pour tous.
- **L'ordre et la disposition d'un flux restent sur leur serveur.** FreshRSS numérote
  les flux par serveur : régler un flux sur l'un changeait celui qui portait le même
  numéro sur l'autre. Un réglage fait avant la 1.8.0 reste lu sur tous les serveurs
  tant qu'on n'y touche pas ; le modifier le range sur le serveur actif, réglage par
  réglage, et l'autre serveur le perd pour ce flux. Un serveur supprimé puis rajouté
  reçoit un nouveau numéro : son ordre, sa disposition et ses choix d'aléatoire ne
  reviennent pas. « Changer le mot de passe API » évite ce détour. L'article complet
  et les choix d'IA par flux restent communs aux serveurs.
- **« Tout lu » reste accessible en 3 colonnes, et sur tablette article ouvert.** À la largeur par défaut de la
  colonne, le bouton sortait de la barre en allemand, espagnol, néerlandais,
  polonais, portugais et ukrainien. Quand la place manque, « Rechercher » puis
  « Aléatoire » gardent leur icône seule, et la barre ne passe à la ligne qu'en
  dernier recours.
- **Bandeau de relève lisible sur téléphone.** Il passe à la ligne au lieu de
  sortir des deux côtés de l'écran, se lit sur sa couleur, attend tant qu'on
  vise ses boutons, et sa croix dit qu'elle ne proposera plus la relève.
- **Petites finitions.** Les pastilles du choix de couleur d'une étiquette
  sont plus grandes au doigt. Les messages de réussite (« Enregistré »…) sont
  lisibles sur les thèmes clairs. Le libellé révélé par le balayage d'un article est
  plus lisible sur sa couleur ; l'infobulle d'« Original » donne la touche
  réellement choisie ; l'aperçu du balayage et le bandeau de relève parlent la
  langue de l'interface ; le menu « Gérer » des serveurs ne déborde plus de
  l'écran ; l'écran de connexion ne défile plus sur Android en app installée.
- **La mémoire ne grossit plus au fil de la lecture.** Chaque article
  affiché, extrait ou traduit qui contenait une vidéo ou une image adaptée à
  la taille de l'écran laissait une copie de sa page en mémoire, que le
  navigateur ne libérait jamais : sur Android, plus de 400 pages gardées au
  bout d'une préparation hors ligne complète. Elles sont maintenant libérées
  dès qu'elles ont servi.
- **Hors ligne : l'avertissement de budget dit vrai.** Un budget plus grand
  que ce que l'appareil autorise annonçait que « le navigateur purgera
  automatiquement » ; ce vidage ne touche plus les images préparées, et le
  message dit désormais que les images au-delà ne pourront pas être
  enregistrées. Une petite taille non nulle s'affiche « ~1 Mo », jamais
  « ~0 Mo ».
- **Le nom du flux ne se réduit plus à une lettre** en tête d'une liste
  étroite (trois colonnes) : les boutons d'affichage passent sur une seconde
  ligne quand la place manque.
- **Une relève longue n'est plus annoncée en échec.** Quand FreshRSS met
  plus d'une minute à relever tous les flux, son serveur web cesse d'attendre
  et répond une erreur, alors que la relève se termine bel et bien : FriRSS
  affichait « La relève a échoué ». Il dit désormais que FreshRSS n'a pas
  répondu à temps et que la relève peut continuer de son côté. Le bandeau
  montre aussi une icône par état : il affichait une coche ✓ même sous « La
  relève a échoué ».
- **« Ajouter un flux » place le curseur dans le champ URL**, et le rend au
  bouton à la fermeture ; il restait derrière la fenêtre.
- **Échap ferme les Préférences après « Tester » ou « Enregistrer »** : ces
  boutons se désactivent pendant leur travail et faisaient perdre le focus,
  et la touche ne fermait plus le panneau.
- **Échap pendant une confirmation qui travaille** (suppression d'un
  serveur, d'une étiquette…) ne referme plus les Préférences derrière elle.
- **Créer un compte : les refus du serveur sont traduits** (nom d'utilisateur
  trop court, inscriptions fermées, nom déjà pris…) ; ils s'affichaient en
  anglais dans toutes les langues. Le temps de lecture du volet, sur
  ordinateur, écrit aussi son unité dans votre langue.
- **La palette ne propose plus « Résumer » sur un résumé déjà affiché**,
  même dans le court instant qui suit son apparition.
- **La page d'erreur de l'application parle votre langue** (elle était en
  français pour tout le monde) et tient la hauteur réelle de l'écran sur
  Android en app installée.
- **Ponctuation selon la langue** : « Recherche : … », les noms accessibles
  « Renommer : Tech » et les détails d'une sauvegarde mettaient l'espace
  française avant les deux-points dans toutes les langues (« Search : foo »).
- **Les touches s'affichent pareil partout et dans votre langue** : la barre
  des raccourcis écrivait « Suppr » en français pour toutes les langues, et
  l'infobulle « Masquer la barre latérale (B) » gardait « B » même après une
  réassignation.
- **iPad : taper à côté ferme les menus** des étiquettes (volet de lecture),
  de la gestion des serveurs et des couleurs d'étiquettes. Ils n'écoutaient
  qu'un événement de souris qu'iOS n'émet pas pour un simple tap.
- **« Ajouter un serveur » ne se ferme plus sur un clic à côté**, qui perdait
  l'adresse, l'identifiant et le mot de passe saisis. Annuler ou Échap
  ferment, comme pour « Ajouter un flux ».
- **Traduction : un clic sur « Réessayer avec… » dès son apparition n'est
  plus perdu.** Le volet lisait encore l'état « en cours » pendant un bref
  instant après l'affichage de l'erreur, et ignorait le clic.

## Sous le capot

- La préparation hors ligne a sa propre clé par flux. Les listes rangées par
  les versions précédentes ne sont plus lues (voir « Actions requises ») et
  partent d'elles-mêmes en 30 jours.
- **Ménage (relecture 1.8.0)** : 332 lignes de CSS dupliquées à l'identique
  depuis un artefact de fusion d'août (la feuille construite contient les
  mêmes règles), la palette Tailwind personnalisée qui ne produisait aucune
  classe, quatre variables CSS jamais lues, trois replis de variables jamais
  définies remplacés par leur valeur, `@types/bcryptjs` (bcryptjs 3 porte ses
  types), `public/icon.svg` jamais référencé mais précaché, un doublon de
  `normalizeForSearch`, le nettoyage d'une clé que personne n'a jamais écrite.
- **Code mort retiré**, après vérification qu'aucun écran, test ou script du
  dépôt ne s'en servait : quatre
  textes de dates jamais affichés (dans les 10 langues), un accesseur, une
  table et une fonction sans appelant, deux blocs de CSS orphelins. Deux
  textes inutilisés ont trouvé leur place plutôt que de partir (noms
  accessibles du bouton de réinitialisation des raccourcis et de la
  capture d'une touche). Le lint signale désormais aussi les constantes en
  majuscules inutilisées.
- **Dépendance : follow-redirects 1.16.2** (embarquée par axios) : la 1.16.1 pouvait
  transmettre des identifiants personnalisés lors d'une redirection. `npm audit --omit=dev` à zéro : rien dans l'image.
  L'outillage de build garde 20 avis modérés ou faibles.
- **Dépendances : body-parser 2.4.0 et qs 6.16.1** (embarqués par Express,
  donc présents dans l'image : avis DoS GHSA-27r3-jxmh-p828 et
  GHSA-6pq8-jhm2-2vcw), avec leurs dépendances content-type 2.1.0 et
  iconv-lite 0.7.3 ; serialize-javascript 7.1.4 (outillage de build
  seulement). Le DoS de body-parser touchait bien le
  `express.json` global ; qs n'est pas atteint (Express 5 lit les requêtes
  avec son parseur `simple`, aucun `urlencoded`).
- **qs épinglé en 6.16.1 par `overrides`** : la 6.17.0 (publiée le jour même
  de la mise à jour) n'ajoute rien de sécuritaire à la 6.16.1, qui porte le
  correctif. Épinglage de prudence, **à retirer au cycle suivant**.
- **Aucun corps de requête compressé n'est plus lu** (`inflate: false` sur
  les lecteurs JSON et brut) : `Content-Encoding` gzip, br, deflate ou zstd
  reçoit 415. body-parser 2.4.0 avait ajouté le zstd à la décompression ;
  aucun client de FriRSS n'envoie de corps compressé.
- **API, ajouts compatibles** :
  - les réponses de `/api/auth/login` et `/api/auth/register` portent
    `auth_provider`, et celles de la connexion, de `/api/auth/me` et de
    `/api/admin/users` portent `sso_linked` ;
  - quatre routes : `POST /api/auth/oidc/link`, `POST /api/auth/oidc/link/complete`,
    `DELETE /api/auth/oidc/link` et `DELETE /api/admin/users/:id/sso` ;
  - le travail de relève porte `continuing` (504 de FreshRSS) ;
  - un refus 400 de `PUT /api/preferences` nomme la clé refusée (`key`) ;
  - nouveaux refus 400 : une URL de serveur qui n'est pas en http(s) ou dépasse
    2 048 caractères (`Invalid server URL`), une adresse e-mail de plus de
    254 caractères, `PUT /api/servers/:id` qui change l'origine ou le compte sans
    nouveau jeton, des champs de serveur ou de compte trop longs, plus de
    50 serveurs ;
  - `PUT /api/preferences` au-delà de 4 Mo (413, `preferences_too_large`) ou de
    120 requêtes par minute (429), plus de 5 inscriptions par heure (429,
    `too_many_accounts`).
- **API, retrait** : trois routes de préférences que le client n'appelait
  plus répondent désormais 404 — `PUT /api/preferences/:key`,
  `DELETE /api/preferences/:key` et `DELETE /api/preferences`. Un script qui
  s'en servait passe par `PUT /api/preferences`, qui accepte une ou plusieurs
  clés.
- **Proxy** : un client qui part en cours de lecture libère la requête vers
  FreshRSS, et une écriture déjà partie (marquer lu, tout marquer lu) est
  menée à terme même si le navigateur coupe la connexion.
- **Ménage : `feedStore.selectFeed`, sans appelant, est supprimé** (toute
  navigation passe par `selectView`) ; ses tests sont migrés.

## Actions requises à la mise à jour

- **`PROXY_REWRITES`** : les règles sont maintenant comparées à l'URL une fois
  analysées (barre finale, majuscules et `:443` ne comptent plus), et seule
  l'origine exacte de chaque règle est de confiance. Un serveur enregistré sur un autre schéma ou un autre port que la
  règle n'est plus réécrit ; s'il se résout vers une adresse privée, il répond
  403 : corriger son URL, ou ajouter une règle pour cette origine. `PROXY_INTERNAL_HOSTS` ne change pas :
  il porte sur l'hôte, tous ports confondus. La relève ne se rabat plus non plus sur
  l'adresse publique si l'adresse interne est injoignable (`Proxy rewrite unreachable …,
  no public fallback` dans le journal) : une règle cassée, invisible jusqu'ici, la fait
  échouer. La corriger.
- **Hors ligne : relancer « Préparer le hors-ligne » après la mise à jour.** Ce qui est
  gardé hors ligne est désormais rangé par compte et par serveur, et les listes gardées
  par la version précédente ne sont plus lues. Ouvrir l'app une fois en ligne, puis
  préparer de nouveau avant de partir sans réseau (la préparation automatique le fait
  seule). Les images et les articles déjà gardés sont repris sans être retéléchargés.
- **SSO** : un compte local qui n'a encore jamais été ouvert par le SSO ne
  s'y rattache plus tout seul. Son propriétaire se connecte avec son mot de
  passe, puis clique « Lier à … » dans Préférences › Général › Compte. Les
  comptes déjà rattachés ne sont pas concernés. En mode « SSO uniquement », le
  formulaire local apparaît après ce refus (ou par `?local=1`).
- **Vérifier les comptes liés** : l'onglet Administration marque désormais
  « Local + SSO » les comptes locaux qui s'ouvrent aussi par le SSO. Ceux qui
  l'ont été par l'ancien rattachement automatique par adresse e-mail le sont
  restés : si l'un ne devrait pas l'être, 🔗 le délie.
- **Atteindre FriRSS par le reverse proxy, jamais en direct** : la limite de
  connexion compte par adresse client, et l'image ne croit l'adresse transmise
  que d'un proxy du réseau privé. Ne pas publier le port du conteneur en direct :
  avec Docker Desktop, Docker sans root et certains montages IPv6, les visiteurs
  arrivent par une adresse privée, et peuvent alors annoncer n'importe quelle
  adresse et passer la limite de connexion. Un proxy à adresse publique n'est pas
  cru : ses clients partagent un seul compteur. Voir SECURITY.md.
- **SSO : c'est le fournisseur qui décide de qui obtient un compte.** Une
  première connexion SSO crée un compte, inscriptions ouvertes ou non (le
  réglage ne gouverne que le formulaire local). Si ce n'est pas voulu,
  restreindre l'application FriRSS chez le fournisseur (Authentik : groupe ou
  politique). Rien n'a changé ici en 1.8.0 : c'est désormais écrit dans
  SECURITY.md.
- **SSO derrière un reverse proxy : vérifier l'adresse de retour enregistrée chez le
  fournisseur.** Sans `FRIRSS_BASE_URL`, FriRSS annonçait `http://…` derrière un proxy
  TLS, et le port tombait sur un port non standard. Il annonce désormais le schéma du
  proxy (`https://…`) et garde le port. Une adresse enregistrée en `http://` est alors
  refusée par le fournisseur : la corriger. Elle ne lit plus non plus l'en-tête
  `X-Forwarded-Host` (un client pouvait la dicter), seulement `Host` : un reverse proxy
  qui remplace `Host` par un nom interne la fausserait. Définir `FRIRSS_BASE_URL`
  (l'URL publique de FriRSS) la fixe dans tous les cas.
- **Restaurer une sauvegarde de plus de 1 Mo derrière nginx** : augmenter
  `client_max_body_size` sur le reverse proxy (jusqu'à 64 Mo). L'image de FriRSS est
  déjà réglée, c'est le proxy placé devant qui refuse.

## Documentation

- **README : FriRSS n'embarque aucune IA**, il se branche sur le modèle de
  votre choix (déjà visible sur `main`), et il compte 38 couleurs (pas 36).
- **README à jour pour la 1.8.0** (sur `dev`, visible à la release) : affichage
  aléatoire, vue grille réglable, changement de mot de passe, confirmations généralisées,
  accessibilité, titre devenu lien (le clic molette n'ouvre plus la source au
  premier plan), nouvelles garanties de sécurité ; libellés alignés sur
  l'interface (*Summarize with…*, *Source text*, *View at startup*, Tags). Et
  une nuance : les jetons FreshRSS transitent par le navigateur à l'ajout
  d'un serveur et à chaque changement de son mot de passe API — le README
  disait « jamais ».

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
