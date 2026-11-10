# 1.9.0 — en préparation

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
