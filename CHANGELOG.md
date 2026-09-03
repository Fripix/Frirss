# Changelog

All notable changes to FriRSS. Each entry is a summary — the full notes for a
release live on its [release page](https://github.com/Fripix/Frirss/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
FriRSS follows [semantic versioning](https://semver.org/).

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
