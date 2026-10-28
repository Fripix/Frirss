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

## Corrections et améliorations

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
  arrière-plan, et l'article est marqué lu sans changer celui qu'on lit. Le
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

- **Une faute de frappe ne déconnecte plus.** Changer son mot de passe avec un
  mauvais mot de passe actuel renvoyait un 401 que l'API FriRSS traitait comme
  une session expirée : l'utilisateur était éjecté. Désormais, comme pour les
  requêtes FreshRSS, seule une vraie session invalide (jeton absent, expiré ou
  invalide) ferme la session.
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
  cliquant « Afficher plus », et une étiquette posée depuis un résultat
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
- **Traduction : un clic sur « Réessayer avec… » dès son apparition n'est
  plus perdu.** Le volet lisait encore l'état « en cours » pendant un bref
  instant après l'affichage de l'erreur, et ignorait le clic.

## Sous le capot

- **Sécurité : une adresse d'article qui n'est pas `http`/`https` n'est plus
  jamais ouverte ni rendue en lien.** Une adresse `javascript:` ou `data:`
  fournie par un flux pouvait devenir un lien (icône « ouvrir à la source »,
  « Original », titre du volet, feuille du bas) ou un onglet (`window.open`,
  touche `o`, « ouvrir le site » d'un flux) ; React ne neutralisait que
  `javascript:` dans les liens, rien dans `window.open`. Toutes ces entrées
  passent désormais par un même filtre : l'élément n'est pas un lien, rien ne
  s'ouvre, « Ouvrir à la source » disparaît du menu. Partager et copier le
  lien gardent l'adresse telle quelle (ils n'exécutent rien).
- **Dépendances : body-parser 2.4.0 et qs 6.16.1** (embarqués par Express,
  donc présents dans l'image : avis DoS GHSA-27r3-jxmh-p828 et
  GHSA-6pq8-jhm2-2vcw) ; serialize-javascript 7.1.4 (outillage de build
  seulement). `npm audit` à zéro. Le DoS de body-parser touchait bien le
  `express.json` global ; qs n'est pas atteint (Express 5 lit les requêtes
  avec son parseur `simple`, aucun `urlencoded`).
- **qs épinglé en 6.16.1 par `overrides`** : la 6.17.0 (publiée le jour même
  de la mise à jour) n'ajoute rien de sécuritaire à la 6.16.1, qui porte le
  correctif. Épinglage de prudence, **à retirer au cycle suivant**.
- body-parser 2.4.0 décompresse désormais les corps `Content-Encoding: zstd`
  (avant : 415). Même limite de 5 Mo après décompression que gzip/br ; le
  proxy ne retransmet pas `Content-Encoding`.
- **Ménage : `feedStore.selectFeed`, sans appelant, est supprimé** (toute
  navigation passe par `selectView`) ; ses tests sont migrés.

## Actions requises à la mise à jour

_(aucune)_

## Documentation

- **README : FriRSS n'embarque aucune IA**, il se branche sur le modèle de
  votre choix (déjà visible sur `main`).
