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

## Actions requises à la mise à jour

_(rien)_

## Documentation

_(rien pour l'instant)_
