# 1.4.10 — en préparation

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

_(rien pour l'instant)_

## Corrections et améliorations

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

_(à compléter)_

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
