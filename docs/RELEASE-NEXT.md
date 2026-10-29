# 1.8.0 — en préparation

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
  par compte (voir Sécurité).

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
  oublié. L'interface n'utilisait pas ce chemin.
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
- **Cache des lectures (`REDIS_URL`) : une réponse démesurée ne remplit plus
  la mémoire.** Une lecture mise en cache s'arrête à 32 Mo, et seule une
  adresse dont le chemin est celui de l'API de FreshRSS est traitée comme
  telle (une URL quelconque qui le portait dans sa requête l'était aussi).
- **L'extraction d'un article a une échéance totale** : 45 s pour les
  en-têtes, redirections comprises. Six redirections lentes la tenaient près
  de quatre minutes.
- **SSO derrière un proxy sur un port non standard** : l'adresse de retour
  garde son port (nginx transmettait l'hôte sans lui).
- **Proxy : le jeton FreshRSS ne suit plus une redirection de `https` vers
  `http`**, même sur le même hôte : il aurait voyagé en clair.
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
- **Le cache des lectures (`REDIS_URL`) ne garde plus que celles des serveurs
  FreshRSS du compte.** N'importe quelle adresse dont le chemin ressemblait à
  l'API de FreshRSS y était écrite, jusqu'à 32 Mo par adresse : un compte
  pouvait remplir le Redis, partagé avec le reste de l'hôte.
- **La synchronisation en arrière-plan (`CACHE_SYNC_INTERVAL`) ne se bloque
  plus** sur un serveur qui ne termine jamais sa réponse (elle s'arrêtait
  pour tous les comptes jusqu'au redémarrage), et ne lit plus une réponse
  sans fin.
- **Serveurs FreshRSS : nom, identifiant et jetons ont une taille maximale**,
  50 serveurs au plus par compte, et la relève compte dans la limite de
  requêtes par minute. Quand cette limite est atteinte (une préparation hors
  ligne peut l'atteindre), « Tester » le dit au lieu d'annoncer le jeton
  refusé.
- **Avec `PROXY_REWRITES`, la relève ne se rabat plus sur l'adresse publique**
  quand l'adresse interne est injoignable : son URL porte le jeton maître, qui
  aurait fini dans le journal du reverse proxy public.
- **Supprimer un compte efface aussi ses listes en cache** (`REDIS_URL`), au
  lieu de les laisser jusqu'à 24 h.
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
- **Hors ligne : une préparation ne retire plus d'images à tort.** Un flux
  dont la liste n'a pas pu être lue (FreshRSS en panne, limite de requêtes)
  voyait ses images préparées retirées en fin de préparation — toutes, si
  FreshRSS était injoignable. Une image dont l'adresse contient un accent,
  une espace ou des majuscules était retirée à chaque fois. Et une erreur
  imprévue ne laisse plus « Préparer » en cours jusqu'au rechargement.
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
  elles attendaient sans que rien ne dise pourquoi. Elles restent en attente,
  toutes, et le bandeau dit quoi vérifier : l'utilisateur et le mot de passe
  d'API du serveur, dans Préférences › Flux. Elles repartent au chargement
  suivant.
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
- **Les grosses sauvegardes se restaurent.** Au-delà de 5 Mo, une sauvegarde
  s'exportait mais était refusée à la restauration ; la limite est désormais
  de 64 Mo, et une sauvegarde plus grosse est refusée dès l'export, avec un
  message qui le dit. Quand un proxy inverse placé devant FriRSS refuse
  l'envoi (1 Mo par défaut avec nginx), le message le dit aussi, au lieu de
  conseiller d'alléger la sauvegarde. L'aperçu d'une sauvegarde sans
  administrateur actif la refuse déjà.
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
  plusieurs messages « Enregistré » sont annoncés de façon fiable.
- **Petites finitions.** Le libellé révélé par le balayage d'un article est
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
- **Dépendances : body-parser 2.4.0 et qs 6.16.1** (embarqués par Express,
  donc présents dans l'image : avis DoS GHSA-27r3-jxmh-p828 et
  GHSA-6pq8-jhm2-2vcw), avec leurs dépendances content-type 2.1.0 et
  iconv-lite 0.7.3 ; serialize-javascript 7.1.4 (outillage de build
  seulement). `npm audit` à zéro. Le DoS de body-parser touchait bien le
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
    254 caractères.
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

- **SSO** : un compte local qui n'a encore jamais été ouvert par le SSO ne
  s'y rattache plus tout seul. Son propriétaire se connecte avec son mot de
  passe, puis clique « Lier à … » dans Préférences › Général › Compte. Les
  comptes déjà rattachés ne sont pas concernés.
- **Vérifier les comptes liés** : l'onglet Administration marque désormais
  « Local + SSO » les comptes locaux qui s'ouvrent aussi par le SSO. Ceux qui
  l'ont été par l'ancien rattachement automatique par adresse e-mail le sont
  restés : si l'un ne devrait pas l'être, 🔗 le délie.
- **Atteindre FriRSS par le reverse proxy, jamais en direct** : la limite de
  connexion compte par adresse client, et l'image ne croit l'adresse transmise
  que d'un proxy du réseau privé. Ne pas publier le port du conteneur en
  direct (Docker Desktop, Docker sans root et certains montages IPv6 font
  passer toutes les connexions par une seule adresse, qui partagerait alors un
  compteur) ; un proxy à adresse publique n'est pas cru, et ses clients
  partagent eux aussi un seul compteur. Voir SECURITY.md.
- **SSO : c'est le fournisseur qui décide de qui obtient un compte.** Une
  première connexion SSO crée un compte, inscriptions ouvertes ou non (le
  réglage ne gouverne que le formulaire local). Si ce n'est pas voulu,
  restreindre l'application FriRSS chez le fournisseur (Authentik : groupe ou
  politique). Rien n'a changé ici en 1.8.0 : c'est désormais écrit dans
  SECURITY.md.
- **SSO derrière un reverse proxy** : l'adresse de retour du SSO ne lit plus
  l'en-tête `X-Forwarded-Host` (un client pouvait la dicter), seulement
  `Host`. Un reverse proxy qui remplace `Host` par un nom interne fausserait
  donc cette adresse : définir `FRIRSS_BASE_URL` (l'URL publique de FriRSS)
  la fixe dans tous les cas.

## Documentation

- **README : FriRSS n'embarque aucune IA**, il se branche sur le modèle de
  votre choix (déjà visible sur `main`), et il compte 38 couleurs (pas 36).
- **README à jour pour la 1.8.0** (sur `dev`, visible à la release) : vue
  grille réglable, changement de mot de passe, confirmations généralisées,
  accessibilité, titre devenu lien (le clic molette n'ouvre plus la source au
  premier plan), nouvelles garanties de sécurité ; libellés alignés sur
  l'interface (*Summarize with…*, *Source text*, *View at startup*, Tags). Et
  une nuance : les jetons FreshRSS transitent une fois par le navigateur, à
  l'ajout d'un serveur — le README disait « jamais ».
