# Cycle de dette technique (avant la prochaine release)

Date : 2026-10-28. Branche : `dev`. Suite logique : l'issue #26 (taille des
cartes en grille), conçue séparément **après** ce cycle.

## Intention

Le propriétaire veut solder la dette technique relevée en revue au fil des
cycles précédents — des défauts réels, jamais corrigés faute de symptôme
visible — **avant** de publier. Le déclencheur : un test sur iPhone du repli
du panneau IA a échoué le 2026-10-27, et le diagnostic a montré que c'était
un de ces défauts connus (la synchro des préférences). Ce qui dort finit par
mordre.

Niveau d'exigence demandé : « résultats parfaits ». Pour les gestes tactiles,
explicitement : « faire le mieux possible », donc l'unification complète, pas
seulement les deux défauts visibles.

## Objectifs

Corriger, chacun avec un test qui échoue avant le correctif :

1. Synchronisation des préférences entre appareils.
2. Déconnexion déclenchée par n'importe quel 401.
3. Absence de délai sur les requêtes du navigateur.
4. Recherche : cinq défauts (voir détail).
5. Marquages « au-dessus / en dessous » : progression et chevauchement.
6. Bandeau des nouveaux articles : arrivées absorbées, chevauchement du
   séparateur de date.
7. Gestes et clavier : raccourcis actifs sous un menu, appui long + balayage,
   quatre implémentations d'appui long, clic molette au premier plan.
8. Ménage : `feedStore.selectFeed` sans appelant.

## Non-objectifs

- **Accessibilité** (champs à 34 px, libellés non reliés, contraste de la
  navigation des préférences, contrôles segmentés sans flèches) : mise de
  côté par le propriétaire, à évaluer plus tard.
- **Base de données** (`preferences.user_id` INTEGER/TEXT) : idem.
- L'issue #26 : cycle suivant.
- Aucune fonctionnalité nouvelle, aucun réglage nouveau dans le panneau des
  préférences (donc `settingsCoverage.test.ts` ne doit pas bouger).
- Aucune dépendance nouvelle.

## Anti-objectifs (ce qui serait un échec même si « ça marche »)

- Une correction qui déplace le bug : un appareil qui perd une modification
  locale au profit du serveur, une session expirée qui ne déconnecte plus,
  un délai qui coupe une opération légitimement longue (IA, hors-ligne,
  restauration), un appui long qui ne se déclenche plus sur iOS.
- Toucher à la barre d'outils de la liste ou à la place de ses boutons
  (décision publique de l'issue #17).
- Réintroduire un `q=` de recherche côté FreshRSS, ou comparer le `ts` de
  `mark-all-as-read` à une date de publication (pièges de 1.4.12).
- Laisser `docs/FEATURES.md` décrire une limite qui n'existe plus : plusieurs
  « limites documentées et assumées » disparaissent dans ce cycle, leur prose
  doit être réécrite dans le même commit.

## Contraintes

- `CLAUDE.md` s'applique en entier : TDD avec la logique pure dans
  `src/lib/*.ts`, gates avant chaque commit, garde-fou de fuite d'infra,
  10 locales pour toute chaîne, trois facteurs de forme, surfaces flottantes
  par portail, mise à jour de `FEATURES.md` et `RELEASE-NEXT.md` dans le même
  commit.
- **Un morceau à la fois** : chaque point est poussé sur `dev`, déployé sur
  l'instance de test et vérifié (Oya pour le desktop, émulateur Android pour
  le tactile) avant le suivant. Les défauts d'enchaînement ne se voient qu'en
  usage réel (leçon de la 1.4.7).
- Chaque morceau livre au propriétaire une courte liste de tests ciblés
  desktop / iPhone.
- Les tests garde-fous qui rougissent sont des questions, pas des baselines à
  réajuster (`featuresDoc`, `loginErrors` l.151-160, `i18nCoverage`, tests
  figeant `UI_SYNC_KEYS`, `extractContent`, `aiErrorKey`, `searchCorpus`
  `CORPUS_TTL_MS`, constantes de geste).

## Détail par point

### 1. Synchronisation des préférences

**Aujourd'hui** (`src/lib/prefsSync.ts`) : chaque changement pousse
l'instantané complet (~61 clés) après 800 ms ; la relecture n'a lieu qu'au
démarrage (`App.tsx:247`). Le serveur fusionne déjà clé par clé
(`INSERT OR REPLACE`). Un appareil resté ouvert renvoie donc ses anciennes
valeurs pour toutes les clés qu'il n'a pas touchées. Reproduit le 2026-10-27
avec Android + Oya.

**Décidé** (proposé au propriétaire le 2026-10-27, cycle accepté) :

- **N'envoyer que les clés modifiées.** Le client garde la dernière valeur
  connue du serveur pour chaque clé (posée à la lecture et après chaque envoi
  réussi) ; un envoi ne contient que les clés dont la valeur locale diffère.
  Un envoi en échec garde ses clés « sales » pour le suivant.
- **Relire le serveur au retour au premier plan** (`visibilitychange` →
  `visible`, aligné sur l'écouteur existant d'`App.tsx:332`).

**Pièges à traiter** (relevés dans le code) :

- Un envoi en attente (minuteur de 800 ms) au moment de la relecture : le
  vider d'abord, puis relire ; une clé encore sale localement n'est jamais
  écrasée par la relecture.
- `applyServerPrefs` force des défauts quand une clé manque
  (`uiStore.ts:1074-1134`) : à la relecture, seules les clés **présentes**
  et **différentes** s'appliquent.
- Une édition de thème en cours (couleurs modifiées en direct dans le store)
  et `feedSettings` (objet imbriqué remplacé d'un bloc) : ne pas écraser une
  valeur sale ; au-delà, dernier écrivain gagne au niveau de la clé.
- Si `articleOrder` ou l'ordre d'un flux change à la relecture, recharger la
  liste (aujourd'hui seul l'appelant de l'interface recharge).
- La relecture ne relance `aiStore.load()` que si nécessaire (au builder).
- *Choix (mien) — aucune modification perdue* : les clés sales et la dernière
  valeur connue du serveur sont **persistées** (localStorage), pour survivre à
  un rechargement, à l'app iOS tuée ou à un envoi hors ligne ; au démarrage,
  une clé sale l'emporte sur le serveur et repart. Nouvel essai d'envoi au
  retour du réseau (`online`), au retour au premier plan et avec attente
  croissante — jamais seulement « au prochain changement ».
- *Choix (mien)* : une clé refusée par le serveur (400, ex. `value_too_large`)
  ne bloque pas les autres et ne reste pas sale pour toujours : elle sort du
  lot et reprend la valeur du serveur. Un lot refusé ne doit pas empêcher
  l'envoi des clés valides.

**Non couvert, assumé** : deux appareils qui modifient au même moment deux
flux différents dans `feedSettings` — le dernier gagne pour toute la clé.
Rare avec la relecture au premier plan.

### 2. Déconnexion sur tout 401

**Aujourd'hui** : l'intercepteur de `src/api/backend.ts:29-37` déconnecte sur
n'importe quel 401. `src/api/client.ts` est déjà filtré par
`isBackendAuthFailure` (`src/lib/loginErrors.ts`). Le serveur ne distingue une
session invalide que par le texte du message (`server/middleware/auth.ts`).

**À faire** : `backend.ts` ne déconnecte que sur une vraie session invalide,
avec le même critère que `client.ts`. Ajouter un `code` stable aux 401 du
middleware d'auth est au choix du builder ; s'il le fait, adapter
`loginErrors.test.ts:151-160` et `BACKEND_AUTH_MARKERS` dans le même commit
(le test relit le middleware par regex). Écrire d'abord le test d'intercepteur
qui manque. Le retour OIDC (`App.tsx:180-182`) qui déconnecte sur toute
erreur de `getMe()` suit la même règle (une erreur réseau ne déconnecte pas).
*Choix (mien)* : sur erreur réseau, `getMe()` est réessayé avec attente
croissante ; jamais d'écran bloqué avec un jeton et un utilisateur vide.
`BackupBlock.tsx:47-49` (déconnexion volontaire après restauration) reste.

### 3. Délais des requêtes

**Aujourd'hui** : aucune instance axios n'a de `timeout` ; seule l'extraction
est bornée (20 s). Le serveur borne déjà ses appels sortants (proxy 30 s par
saut, IA 60 s par appel, traduction jusqu'à 110 s, nginx 120 s).

**Règle** : **le serveur doit toujours répondre avant que le client
abandonne.** Un abandon client sans réponse est lu par `isUpstreamCut`
(`src/lib/aiErrorKey.ts:83-90`) comme une coupure amont et fait rejouer la
traduction coupée en deux — un délai client trop court fabriquerait ce cas.

- *Choix (mien)* : le proxy n'a pas aujourd'hui de budget total — les 30 s
  par saut s'arrêtent aux en-têtes, jusqu'à 6 sauts, plus un repli vers
  l'URL publique (`server/routes/proxy.ts:509-544`) ; seule la limite nginx
  de 120 s borne un appel. On **ajoute au proxy une échéance totale**
  (en-têtes ET corps, tous sauts et repli compris), qui répond une erreur
  claire (504) à son terme.
- Délai par défaut pour les appels courts (liste, compteurs, écritures
  lu/favori/étiquette, préférences, favicons) : au-dessus de cette échéance
  totale du proxy (valeurs au builder, documentées).
- IA (résumé, traduction, test et liste des modèles) : au-dessus de 120 s.
- Sauvegarde (export, aperçu, restauration) : au-dessus de 120 s.
- Extraction : inchangée (déjà bornée, `FEATURES.md:3770-3802`).
- Un délai dépassé affiche une erreur honnête (pas de cause devinée, règle
  du projet), jamais une déconnexion.

### 4. Recherche

- **Résultats périmés** : `searchResults` n'est jamais mis à jour par lu /
  favori / à lire plus tard / étiquette, donc une coche posée dans les
  résultats se défait à la tranche suivante (`showMoreSearchResults`). Les
  répercuter, comme pour `articles`.
- **Étiquettes** : `toggleArticleLabel` ne patche pas le corpus. Le faire.
- **Coût** : `corpusMatches` refiltre tout le corpus à chaque tranche et
  `addPage` reconstruit un `Set` complet. Ne filtrer que la tranche nouvelle,
  garder les correspondances accumulées.
- **`stripHtml`** : six entités nommées seulement, `String.fromCodePoint` qui
  lève hors plage (l'erreur fait échouer le balayage), contenu de
  `<script>`/`<style>` conservé. Décodage complet et sûr ; mesurer le coût
  sur un corpus de 10 000 articles avant de choisir la méthode.
- **« Tout lu » pendant une recherche** : la liste garde les résultats sous
  l'en-tête de la vue nue. Recharger la vue après fermeture de la recherche.
- **Tirer-pour-rafraîchir et bouton Rafraîchir pendant une recherche** :
  aujourd'hui le spinner tourne sans effet, et `loading`/`revalidating`
  restent vrais. *Choix (mien)* : Rafraîchir fait son travail normal
  (actualisation FreshRSS, compteurs, bandeau) **et** les nouveaux articles
  qui correspondent apparaissent dans les résultats : le corpus est complété
  par les seules entrées plus récentes que celles qu'il contient (pas de
  rebalayage complet de ~10 s), puis le spinner s'arrête.
- **Corpus en mémoire** : gardé exprès pour réafficher une recherche hors
  ligne (`FEATURES.md:1591-1597`). *Choix de conception (mien)* : le garder
  au changement de vue, le **libérer à la déconnexion** (la spec de la
  recherche l'annonçait, ce n'est pas fait ; un autre compte peut ouvrir le
  même navigateur).
- Corriger le commentaire périmé `feedStore.ts:2569`.

### 5. Marquages « au-dessus / en dessous »

- **Progression** : alimenter la barre de progression existante
  (`TopProgressBar`, via `bulkWork`) comme le fait « tout lu ». Aucun nouvel
  élément d'interface.
- **Chevauchement** : deux marquages se suivent (le second attend la fin du
  premier) au lieu de se croiser. Cela règle les deux défauts observés :
  corpus resté optimiste jusqu'à 5 min, et retour en arrière du premier qui
  repasse non lues des lignes que le second a marquées.
- La prose `FEATURES.md:1169-1178` et `:1204-1206` est réécrite.

### 6. Bandeau des nouveaux articles

- **Arrivées absorbées** : `loadSubscriptions` relève la base des compteurs
  sans calculer les arrivées (`feedStore.ts:957-968`), donc celles des
  dernières 60 s disparaissent après un renommage, un déplacement de flux,
  un ajout, etc. Les compter comme le fait `syncCounts`. Exception :
  `refresh()`, qui a son propre bandeau calculé depuis `before`, ne doit pas
  compter deux fois. *Choix (mien)* : un flux **absent** de la base
  précédente (flux qu'on vient d'ajouter) ne compte pas comme des arrivées —
  ajouter un flux de 30 non-lus n'affiche pas « 30 nouveaux articles ».
- **Séparateur de date recouvert** : le bandeau (sticky, z-index 15, hauteur
  nulle, 40/44 px) recouvre le séparateur (sticky, z-index 10). Le choix
  « hauteur nulle, posé par-dessus » est délibéré (`FEATURES.md:1375-1381`) et
  reste : c'est le séparateur qui doit se décaler sous le bandeau tant que
  celui-ci est affiché. Vérifier à 320 px, en colonne étroite, et en grille.

### 7. Gestes et clavier

- **Raccourcis sous un menu** : la garde de `useKeyboardNav.ts:26-45` ne voit
  pas le menu contextuel d'article sur bureau, `FeedContextMenu`,
  `SavedCategoryPicker`, ni un `Popover` ouvert sans focus. Les surfaces
  flottantes ouvertes doivent couper les raccourcis, quel que soit le focus.
- **Unifier les appuis longs** (quatre implémentations à 500 ms :
  `useLongPress`, `useFileGesture`, `FeedItem` de la barre latérale,
  `ActionBtn` du volet de lecture) en **une seule**, qui réunit le meilleur
  de chacune : tolérance de mouvement de quelques pixels (aujourd'hui tout
  mouvement annule), `touchcancel`, garde multi-doigts, nettoyage au
  démontage, absorption du clic et du `contextmenu` d'écho (Chrome Android),
  souris en option pour les deux appelants qui la gèrent aujourd'hui.
  Durée inchangée (500 ms). Les tests existants (`useLongPress`,
  `FeedItem.longpress`, `useArticleMenuGestures`, `ArticleRow.menu`,
  `ArticleCard.menu`) doivent passer, adaptés seulement là où ils figent une
  implémentation disparue — chaque adaptation justifiée.
- **Appui long + balayage** (`SwipeableArticleRow.tsx`) : une fois le menu
  ouvert par l'appui long, le balayage ne déclenche plus rien ; une fois la
  direction du balayage décidée, l'appui long est annulé. Ajouter les tests
  qui manquent sur `SwipeableArticleRow`.
- **Clic molette sur un article** : il passe par `window.open`, qui ouvre au
  premier plan (`useArticleMenuGestures` → `openArticleAtSource` →
  `openExternal`, documenté comme écart connu `FEATURES.md:1095-1097`). Le navigateur n'ouvre en
  arrière-plan qu'un vrai lien cliqué par l'utilisateur. *Choix (recommandé
  par moi, accepté par le propriétaire le 2026-10-28)* : **le titre** de la
  ligne et de la carte devient un vrai `<a href>` natif (comme l'icône
  « ouvrir à la source », déjà correcte) ; clic molette et ⌘/Ctrl-clic dessus
  ouvrent en arrière-plan. Ailleurs sur la ligne, comportement inchangé.
  Rejeté : toute la surface en lien (URL au survol de chaque ligne, glisser
  d'un lien, lecteur d'écran qui annonce chaque ligne comme lien). Le clic
  gauche sur le titre garde la sélection actuelle (le lien ne navigue pas) ;
  le marquage lu au clic molette reste celui d'aujourd'hui ; seuls les
  schémas `http(s)` donnent un `href` (contrôle absent aujourd'hui de
  `window.open` aussi). À valider sur Chrome, Safari et Firefox desktop.

### 8. Ménage

Supprimer `feedStore.selectFeed` et ses tests propres ; migrer vers
`selectView` les tests qui s'en servaient comme raccourci ; corriger les
commentaires qui le citent (`feedStore.ts:332,706`, `rollbackRow.ts:9`,
`FEATURES.md:738,1599`).

## Ordre proposé

1. Synchro des préférences (la cause du test iPhone en échec).
2. Déconnexion sur 401.
3. Délais des requêtes.
4. Recherche.
5. Marquages de plage.
6. Bandeau.
7. Raccourcis sous un menu.
8. Appuis longs unifiés + balayage.
9. Clic molette.
10. Ménage `selectFeed`.

Le builder peut regrouper deux points voisins dans un même déploiement s'ils
ne touchent pas les mêmes fichiers, jamais les gestes avec autre chose.

## Laissé au builder

- Les valeurs exactes des délais, dans les bornes ci-dessus, et où elles
  vivent (une constante documentée, pas de variable d'environnement).
- La forme du suivi des clés sales (comparaison par référence ou par
  sérialisation).
- La méthode de décodage HTML de la recherche, après mesure.
- La structure du hook d'appui long unifié et sa tolérance exacte.
- Le moyen technique de couper les raccourcis sous une surface flottante.

## Vérification

- Gates complètes avant chaque commit ; CI et Publish vérifiés après chaque
  push ; instance de test redéployée.
- Desktop : Oya. Tactile : émulateur Android, à 320 px pour les mises en page.
  iPhone : tests ciblés rendus au propriétaire.
- Point 1 : rejouer le scénario du 2026-10-27 (deux appareils, l'un resté
  ouvert) et vérifier que le repli survit.
- Avant la release : relectures à l'œil neuf (diff, serveur, côté lecture,
  journal du cycle), selon `CLAUDE.md`.
