# 1.7.1 — en préparation

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

_(rien pour l'instant)_

## Corrections et améliorations

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
  relit ceux des autres appareils en revenant au premier plan, sans
  rechargement. Une modification qui n'a pas pu partir — réseau coupé en
  cours de route, app fermée juste après — n'est plus perdue : elle repart au
  retour du réseau, au retour dans l'app ou au démarrage suivant. Un réglage refusé par le serveur (logo trop lourd) n'empêche plus
  les autres de s'enregistrer.

- **Une faute de frappe ne déconnecte plus.** Changer son mot de passe avec un
  mauvais mot de passe actuel renvoyait un 401 que l'API FriRSS traitait comme
  une session expirée : l'utilisateur était éjecté. Désormais, comme pour les
  requêtes FreshRSS, seule une vraie session invalide (jeton absent, expiré ou
  invalide) ferme la session.
- **Retour SSO : une coupure réseau passagère ne renvoie plus à l'écran de
  connexion.** Si la lecture du profil échoue juste après la redirection, elle
  est réessayée jusqu'à quatre fois (1, 2, 4 puis 8 s). Seule une session
  réellement refusée déconnecte tout de suite ; après le dernier échec,
  l'écran de connexion dit que le serveur n'a pas répondu (clé existante
  `login.errorUnavailable`).

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

## Sous le capot

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

## Actions requises à la mise à jour

_(aucune)_

## Documentation

- **README : FriRSS n'embarque aucune IA**, il se branche sur le modèle de
  votre choix (déjà visible sur `main`).
