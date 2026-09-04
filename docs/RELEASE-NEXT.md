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
  ou si elle ne répond pas — au bout de 25 s, l'extraction bascule d'elle-même
  sur le navigateur plutôt que d'attendre indéfiniment.
- **Défilement plus fluide dans le volet de lecture** : la barre de progression
  se mesure une fois par image affichée, plus une fois par événement de
  défilement.

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
- **L'extraction côté serveur ne peut plus saturer l'instance.** L'analyse d'une
  page bloque l'unique processus qui sert tout le monde ; elle est désormais
  bornée (une à la fois, cinq en attente au plus), et au-delà le navigateur
  reprend la main comme avant la 1.4.10.
- **Dix appareils qui ouvrent le même article au même moment ne déclenchent plus
  qu'une seule extraction**, donc une seule requête chez le site d'origine.
- **La préparation hors-ligne ne perd plus d'articles en silence** quand elle
  atteint le plafond de cadence : elle attend le délai annoncé par le serveur
  puis réessaie, au lieu de laisser l'article absent du jeu hors ligne.
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
  consommateurs » du délai d'extraction (il y en a cinq). Le plafond de
  résolution DNS est désormais décrit pour ce qu'il est : une garde de TOUTES
  les sorties du backend, pas seulement de l'extraction.
