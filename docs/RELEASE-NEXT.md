# 1.4.7 — en préparation

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

- **Marquer un article lu le fait sortir de la liste « Non lus ».** Cliquer le ✓
  d'une ligne n'avait aucun effet visible sous le filtre dont c'était pourtant
  le sujet. La ligne disparaît maintenant **immédiatement** ; si le serveur
  refuse le marquage, elle revient exactement à sa place. Ouvrir un article ne
  retire pas sa ligne,
  et le marquage au défilement non plus — celle de l'article ouvert ne part
  jamais, pour que suivant/précédent continuent de fonctionner. La liste
  enchaîne les pages suivantes au fil des retraits, et n'annonce « tout est
  lu » que lorsqu'il ne reste vraiment plus rien à charger. (issue #10)
- **Marquer un article lu ne peut plus déranger la liste d'un autre flux.**
  Si le serveur refusait le marquage après un changement de flux, de filtre ou
  de recherche, l'article revenait au milieu de la liste affichée — et y
  restait après rechargement. Il n'y revient plus que si la liste est encore la
  sienne, et jamais en double si un rafraîchissement l'a déjà ramené.
- **Un article refusé retrouve sa place même quand d'autres ✓ ont suivi.**
  Deux marquages rapprochés dont un seul échouait renvoyaient l'article en fin
  de liste ; sa place se déduit maintenant de sa date de publication.
- **Hors ligne, une ligne marquée lue ne réapparaît plus.** Sans réseau, le ✓
  est mis en attente et la ligne part ; quitter la vue et y revenir la
  réaffichait pourtant, marquée lue, dans « Non lus ».
- **Une bande de date entière ne clignote plus.** Marquer lu le dernier article
  d'une journée faisait rejouer l'animation d'entrée à toutes les lignes des
  journées suivantes.
- **Un article ne clignote plus quand une ligne quitte la liste.** Chaque
  retrait faisait remonter les lignes suivantes d'un cran, et celle qui
  franchissait ainsi la dixième position rejouait l'animation d'entrée : elle
  s'effaçait puis réapparaissait alors qu'elle n'avait jamais quitté l'écran.
  L'animation ne joue plus qu'à la première apparition d'un article dans la
  vue.
- **Une liste vide ne se fige plus sur un squelette de chargement.** Quand la
  liste n'a plus rien à montrer alors que le flux n'est pas épuisé — par
  exemple en filtrant sur les favoris un flux dont les premiers articles n'en
  sont pas — elle affichait un squelette que rien ne terminait : il fallait
  changer de vue pour s'en sortir. Elle affiche désormais un message neutre et
  un bouton « Charger la suite ». Elle n'annonce toujours « tout est lu » que
  lorsque c'est vrai.
- **Le ✓ n'injecte plus d'articles étrangers dans une recherche.** Marquer un
  résultat de recherche comme lu pouvait faire apparaître à sa suite des
  articles sans rapport avec la requête. La liste ne charge plus de page
  supplémentaire tant qu'une recherche est active.
- **La liste ne se bloque plus après une série de ✓.** En marquant lus une
  vingtaine d'articles à la suite, la liste s'arrêtait sur ce qui restait de sa
  première page — une trentaine de lignes pour bien plus de non-lus — et seul un
  rechargement complet ramenait la suite. La page suivante est désormais
  demandée dès que la liste n'a plus rien à faire défiler, quelle que soit la
  taille de l'écran ; agrandir la fenêtre suffit aussi à la relancer.
- **Une ligne retirée de « À lire plus tard » ne revient plus.** Quitter la vue
  puis y revenir réaffichait l'article dont l'étiquette venait d'être enlevée.
- **Le ✓ arrive dans l'affichage compact**, où il manquait alors qu'il existait
  dans les autres dispositions.
- **Retirer « À lire plus tard » ne fait plus disparaître l'article quand le
  serveur refuse.** Depuis cette vue, la ligne partait avant même la réponse du
  serveur : sur un refus elle ne revenait pas, et le compteur annonçait un
  élément au-dessus d'une liste vide. La ligne ne part désormais qu'une fois le
  retrait confirmé — même correction que celle appliquée aux favoris en 1.4.4.
- **Un jeton d'écriture périmé ne condamne plus toutes les écritures.** Le
  jeton CSRF de FreshRSS était obtenu une fois pour toute la session et rien ne
  le renouvelait : dès qu'il expirait — session FreshRSS renouvelée, serveur
  redémarré —, chaque ✓, chaque favori et chaque « à lire plus tard » échouait
  jusqu'au rechargement de la page. Comme la ligne part désormais sans attendre
  la réponse du serveur, les articles disparaissaient de l'écran sans que le
  compteur de non-lus bouge, et revenaient tous non lus au rechargement.
  FriRSS redemande maintenant un jeton et rejoue l'écriture **une fois** ; un
  second échec est traité comme avant.
- **Une écriture perdue le dit.** Un marquage refusé par le serveur remettait
  la ligne en place sans un mot, et une écriture mise en file d'attente laissait
  la ligne partie en silence. Un message d'erreur explique désormais les deux
  cas — y compris quand la connexion est bonne mais que FreshRSS ne répond pas.
  Hors ligne pour de bon, rien ne s'affiche : le bandeau hors-ligne le dit déjà.
- **Le bouton « Charger la suite » de la liste vide ne clique plus jamais dans
  le vide.** Trois cas où il ne se passait rien de visible : un échec réseau
  ou serveur remettait le bouton à son état de départ sans un mot (il affiche
  désormais un message d'erreur) ; une page dont les favoris filtrés ne
  rendent aucune ligne repeignait le même écran vide sans le dire (un message
  confirme que la page suivante a bien été chargée) ; et un clic pendant la
  revalidation d'arrière-plan d'une vue déjà affichée depuis le cache pouvait
  perdre la course contre elle et jeter le travail du clic — le bouton reste
  désormais inactif le temps que cette revalidation se termine.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
