# Catégories pour les articles gardés — design

**Date** : 2026-08-20
**Statut** : approuvé (brainstorming)
**Origine** : point #10 de la liste Reddit — *« being able to save articles to
read later into categories that you can create or use one that you have created
already (much like Instagram when u choose to save a post u can sort them into
categories) (or maybe this isn't that necessary since we have tags) »*

## Ce que la demande vise réellement

La parenthèse finale de la demande est décisive : son auteur pressentait déjà que
les étiquettes couvrent le besoin côté données. C'est exact — dans le modèle
Google Reader exposé par FreshRSS, **une catégorie créée par l'utilisateur EST
une étiquette**. Il n'existe aucun autre moyen d'attacher un regroupement
personnel à un article. La preuve est dans l'app : « À lire plus tard » est
elle-même l'étiquette `user/-/label/À lire plus tard`.

Le manque n'est donc pas le modèle de données mais **le geste** : Instagram
propose de ranger dans une collection *au moment où l'on enregistre*. Dans
FriRSS, mettre de côté est un clic, et étiqueter une action séparée, ailleurs.
C'est cet écart que la fonctionnalité comble.

Référence du motif ailleurs : **Feedly** (Boards, « Read Later » n'étant qu'un
board par défaut), **Inoreader** (tags, avec « Saved for later » intégré),
**Pocket** et **Instapaper** (tags sur les éléments sauvegardés).

## Le modèle : aucune nouveauté

Une catégorie = une **sous-étiquette préfixée** :
`À lire plus tard/Veille`, `Favoris/Recettes`.

`src/utils/labels.ts` (`groupLabels`) affiche **déjà** les étiquettes
`Parent/Enfant` comme un parent et ses enfants. Donc : pas de nouveau modèle,
pas de migration, et compatibilité directe avec FreshRSS et les autres clients.

**Point signalé** : le préfixe est littéral et français (`À lire plus tard/…`),
car l'app utilise déjà un identifiant français en dur pour cette étiquette quelle
que soit la langue de l'interface. On reste cohérent avec l'existant plutôt que
d'introduire une seconde convention. À reconsidérer si FriRSS est distribué plus
largement.

Pour **Favoris**, le préfixe `Favoris/…` est introduit par cette fonctionnalité
(« favori » est un état natif, pas une étiquette). Un article rangé est donc
étiqueté ; l'étoile reste indépendante.

## Le geste de sauvegarde — le cœur de la demande

- **Clic simple** sur ★ ou ◷ → comportement actuel, instantané, sans friction.
- **Appui long** (tactile) ou **clic sur le chevron** (bureau) → un sélecteur
  compact : les catégories existantes du contexte, plus un champ pour en créer
  une.

Le cas courant n'est jamais ralenti ; le classement est offert à qui le veut.

## La sidebar

Déplier « À lire plus tard » ou « Favoris » révèle leurs catégories, avec
compteurs, **uniquement celles qui contiennent au moins un élément**. L'état de
repli est persisté, comme celui des catégories de flux et de la section
ÉTIQUETTES.

Ces sous-étiquettes sont **retirées de la section ÉTIQUETTES** : les voir à deux
endroits serait la principale source de confusion de ce design.

Cliquer une catégorie ouvre son **flux d'étiquette** — pagination, recherche et
mode hors ligne fonctionnent donc sans travail supplémentaire.

## Glisser-déposer — acquis dès le départ

La sidebar **accepte déjà** le dépôt d'un article sur une ligne d'étiquette
(`application/frirss-article` → `onArticleDrop`), et les lignes d'article sont
déjà `draggable`. Les catégories étant des lignes d'étiquette, **glisser un
article dans une catégorie fonctionne en réutilisant le composant existant**,
sans mécanique nouvelle.

## TDD — logique pure extraite

- `savedCategories(labels, prefix)` : les sous-étiquettes d'un préfixe donné,
  nom affiché sans le préfixe, triées.
- `categoryLabelId(prefix, name)` : construction de l'identifiant, avec
  nettoyage (barres obliques interdites dans un nom de catégorie).
- `hideSavedCategories(labels)` : filtre retirant ces sous-étiquettes de la
  liste ÉTIQUETTES.

Le reste (rendu, dépôt, sélecteur) réutilise des composants déjà éprouvés.

## i18n

Toutes les nouvelles chaînes dans **les 9 locales**, parité vérifiée par le
script d'audit avant livraison.

## Hors périmètre

- Catégories imbriquées sur plusieurs niveaux (`Favoris/A/B`).
- Règles de classement automatique.
- Déplacement d'un article d'une catégorie à une autre par glisser-déposer
  (l'ajout fonctionne ; le retrait passe par le sélecteur).

## Fichiers concernés (estimation)

- `src/lib/savedCategories.ts` — **nouveau** (+ tests) : les trois fonctions.
- `src/components/Sidebar/Sidebar.tsx` — catégories sous Favoris / À lire plus
  tard, dépôt, filtrage de la section ÉTIQUETTES.
- `src/components/ArticleList/ArticleActions.tsx` — le geste secondaire.
- `src/components/ArticleList/SavedCategoryPicker.tsx` — **nouveau** : le
  sélecteur (liste + création).
- `src/stores/uiStore.ts` — état de repli des deux nouvelles sections.
- `src/locales/*.json` (×9).
