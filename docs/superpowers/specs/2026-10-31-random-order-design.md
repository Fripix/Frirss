# Affichage aléatoire de la liste (issue #27)

## Intention

Pouvoir piocher au hasard dans une liste quand on a trop à lire : les flux très
denses et les publications par lots cachent le reste. Le demandeur cite
FreshRSS, où l'ordre aléatoire est une façon de plus de trier une liste. FriRSS
reprend ce fonctionnement : un tirage, pas une suite stable.

Le propriétaire a retenu un bouton de liste et des paramètres communs. Il a
écarté : un réglage global d'ordre, les défauts par flux et par catégorie, un
mode à part sans lien avec FreshRSS, les dossiers intelligents.

## Objectifs

- Un bouton « Aléatoire » dans la barre de la liste, qui s'utilise comme
  « Non lus » : il s'active et se désactive sur la vue affichée.
- Deux paramètres communs dans les Préférences, en champs libres : le nombre
  d'articles par tirage, et l'ancienneté (tous les articles, ou les N dernières
  heures ou jours).
- Un moyen de recharger, qui fait un nouveau tirage avec les mêmes paramètres et
  tient compte des articles arrivés entre-temps.

## Hors sujet

- Aucun ordre enregistré : ni global, ni par flux, ni par catégorie.
  `ArticleOrder`, `effectiveOrder` et les clés de vue ne changent pas.
- Pas de suite stable : chaque tirage est indépendant, un article peut revenir.
- Pas de mode hors ligne.
- Pas de règles par mots, sources multiples ou dossiers.
- Pas de raccourci clavier dans cette version.

## À ne pas produire

- Un tirage rangé sous la clé d'une vue. Une liste hors ligne ou un cache mémoire
  mélangé fausserait la lecture normale : c'est le pire défaut possible ici.
- Une liste qui change sous les yeux sans geste de l'utilisateur.
- « Tout lu » qui marque une vue entière alors que l'écran n'en montre que 50.

## Comportement

### Le bouton

- Présent dans les trois barres de `ArticleList.tsx`, avec l'état actif habituel de
  `ToolbarBtn`. Libellé `articleList.random`. Toujours après « Non lus » : en toutes
  lettres en Liste et en Grille, en icône sur téléphone et en 3 colonnes, où
  « Rechercher » passe aussi en icône pour la largeur de 340 px.
- Visible sous les filtres Tous et Non lus, sur l'accueil, une catégorie, un
  flux ou une étiquette. Absent sous Favoris et À lire plus tard : les favoris
  d'un flux sont filtrés côté client, leurs identifiants ne s'obtiennent pas.
- Absent pendant une recherche ; lancer une recherche quitte le mode.
- Désactivé hors ligne (`navigator.onLine === false`), avec un libellé qui dit
  pourquoi.
- Tient à 320 px, où la barre compte déjà cinq boutons `flex1`, et à 340 px en
  3 colonnes : mesuré dans Chrome sur la feuille construite.

### Le mode

- État transitoire `randomView` du `feedStore`, jamais persisté ni synchronisé.
- Il suit la vue : il survit au passage Tous ↔ Non lus, et prend fin au changement
  de flux, de catégorie ou d'étiquette, au passage à Favoris ou À lire plus tard,
  au lancement d'une recherche, au changement de compte ou de serveur, au
  rechargement de la page.
- Le quitter relance `loadArticles()` normalement.

### Le tirage

1. Relever les identifiants de la vue par `stream/items/ids`, du plus récent au
   plus ancien, avec `xt=` lu sous Non lus. Le flux demandé est celui de
   `resolveSearchStreamId`, donc le flux principal à l'accueil.
2. S'arrêter à la portée ou à 10 000 identifiants, par pages de 1 000.
3. Tirer `randomCount` identifiants au hasard (fonction pure, générateur injecté
   pour les tests). Moins d'identifiants que `randomCount` : tous, mélangés.
4. Charger les articles par `POST stream/items/contents`, par lots de 100 `i=`.
5. Les remettre dans l'ordre du tirage : FreshRSS les rend triés par identifiant.
   Un identifiant sans article (purgé entre-temps) est ignoré.
6. Passer par `reconcile` puis écrire `articles`, avec `continuation: null`.

La portée se compare à l'**identifiant d'entrée**, qui porte l'instant d'arrivée
dans FreshRSS (`entryIdUsec`), pas à `ot=` : FreshRSS lit `ot` comme « publié
après OU modifié après », et un vieux billet corrigé s'y glisserait. « Dernières
24 heures » veut donc dire « arrivés depuis 24 heures », comme `date:` et `hours`
dans FreshRSS.

### Recharger

- **Bouton « Nouveau tirage »** en fin de liste, à la place du bouton de page
  suivante. Il remplace la liste et remonte en haut, comme FreshRSS.
- **Rafraîchir et tirer-pour-rafraîchir** font un nouveau tirage, une seule fois,
  à la fin de leur travail habituel. Pendant une relève, la boucle qui rappelle
  `silentRefresh` toutes les ~3 s ne touche pas à la liste : le tirage part quand
  la relève se termine, et prend ainsi les articles qu'elle a ramenés. C'est la
  seule fois où la liste change quelques secondes après le geste qui l'a demandé.
- **Passer de Tous à Non lus**, ou l'inverse, fait un nouveau tirage : le filtre a
  changé, la liste affichée n'y correspond plus, et c'est un geste.
- Le retour au premier plan (`silentRefresh` depuis `App.tsx`) ne touche pas à la
  liste : seuls les compteurs se mettent à jour.
- Le bandeau « nouveaux articles » est muet dans ce mode (`newInView` reste à 0).

### Ce qui change dans le mode

- « Tout lu » est masqué, en barre comme en fin de liste.
- « Marquer au-dessus / en dessous » est masqué (`canMarkRange`).
- Lu, favori, À lire plus tard, étiquettes et file hors ligne fonctionnent
  normalement. Une ligne lue sous Non lus suit le comportement habituel.
- Pas de préchargement des extractions (`warmExtracts`).
- Pas de séparateurs de date, en liste comme en grille : dans un tirage, ils se
  répéteraient à chaque ligne (« Aujourd'hui », « Hier », « Aujourd'hui »…) avec
  des totaux faux. La date reste sur chaque article.
- Liste vide : un message dédié (`articleList.randomEmpty`) plutôt que « Tout est lu ».
- Échec du tirage : l'état d'échec habituel avec « Réessayer », mode conservé.
- Tirage vide, ou vidé par des lignes lues : ni l'allure d'une réussite, ni
  « Tout est lu », et un bouton « Nouveau tirage ».

## Paramètres

Dans **Préférences › Général**, juste sous « Ordre des articles » : c'est là que
vivent déjà les choix sur ce que montre la liste.

Une saisie s'enregistre en sortant du champ ou en fermant le panneau.

- **Nombre d'articles** : champ numérique libre, **20** par défaut, de 1 à 500.
- **Ancienneté** : champ numérique libre et choix heures ou jours. Vide veut dire
  tous les articles, soit les 10 000 plus récents : aucun texte ne promet tout
  l'historique. C'est le défaut.

Stockage : `randomCount`, `randomWindowAmount` (0 = tous) et `randomWindowUnit`
(`hours` ou `days`), synchronisés comme les préférences voisines (listes de clés
de `uiStore`). Toute valeur illisible, hors bornes ou non entière revient au
défaut à la lecture. Les changer pendant que le mode est actif ne relance rien :
la valeur sert au prochain tirage.

## Contraintes

- Le mode n'écrit jamais de liste : `persistCurrentView`, `memSet` et `listPut`
  sont gardés. Tout point qui range `articles` sous `viewKey` doit être passé en
  revue, `loadArticles`, `silentRefresh`, le rollback de `toggleRead` et les
  marquages compris.
- Toute surface flottante passe par un portail ; 10 locales ; desktop, tablette
  et 320 px ; `docs/FEATURES.md` et `docs/RELEASE-NEXT.md` dans le même commit.
- Une réponse d'un tirage périmé est jetée : la garde couvre la vue, la portée
  (`offlineScope`) et un numéro de tirage.
- Le relevé compte dans le plafond du proxy (`FRIRSS_PROXY_RATE_LIMIT`) : 10 appels
  au plus pour les identifiants, et 1 à 5 pour les contenus.

## À vérifier en premier

Non prouvé à ce jour, lu dans le code de FreshRSS 1.30.4 seulement :

- `POST stream/items/contents` ne demande pas de jeton d'écriture (aucun
  `checkToken` sur ce chemin) ;
- il accepte les identifiants décimaux de `stream/items/ids` ;
- il passe par `/api/proxy`.

Premier test, sur l'instance de test, avant toute interface. S'il échoue, on
revient au propriétaire : le reste en dépend.

## Laissé au constructeur

- L'icône, à choisir dans le style de la barre.
- Le texte exact des chaînes, à valider à la relecture.
- Le découpage entre `src/lib/` et `feedStore.ts`, la logique pure allant dans
  `src/lib/` avec ses tests.
