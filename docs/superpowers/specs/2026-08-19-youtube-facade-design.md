# Lecture YouTube en façade — design

**Date** : 2026-08-19
**Statut** : approuvé (brainstorming)
**Origine** : point #3 de la liste Reddit (« lecture YouTube inline »).

## Décision d'architecture : côté FriRSS, pas côté FreshRSS

Une extension FreshRSS modifie le rendu de *sa* propre interface, sans garantie
que le résultat ressorte par l'API Google Reader que consomme FriRSS. Et FriRSS
est distribué à d'autres personnes : dépendre d'une extension serveur rendrait la
fonctionnalité indisponible pour qui ne l'a pas installée. FreshRSS reste le
moteur, FriRSS décide de la présentation.

## Deux contraintes vérifiées dans le code (pas supposées)

1. **DOMPurify supprime les iframes.** `sanitizeHtml` utilise le profil `html`,
   qui n'inclut pas `<iframe>`. Vérifié : `<p>avant</p><iframe …></iframe><p>après</p>`
   ressort en `<p>avant</p><p>après</p>` — la vidéo disparaît **sans laisser de
   trace**. Conséquence : les vidéos intégrées aux billets de blog sont
   aujourd'hui **invisibles** dans FriRSS. Cette fonctionnalité répare donc une
   perte de contenu silencieuse, en plus de répondre à la demande.
2. **La CSP autorise déjà les iframes distants.** nginx envoie
   `frame-src 'self' https:`. Aucune modification de configuration n'est
   nécessaire — contrairement à ce qu'on pourrait craindre.

Vérifié également : un balisage de façade (`div` + attributs `data-*` + `img` +
`button`) **traverse la sanitisation intact**. C'est ce qui rend l'approche
possible.

## Pourquoi une façade plutôt qu'un iframe direct

Même en `youtube-nocookie`, un iframe contacte Google **dès le chargement de
l'article** : adresse IP, référent, et environ 1 Mo de JavaScript — pour chaque
article vidéo ouvert, avant même que l'utilisateur décide de regarder.

La façade affiche la miniature et un bouton lecture ; l'iframe n'est créé
**qu'au clic**. Bénéfices cumulés :

- **Vie privée** : aucun contact tant que la lecture n'est pas demandée.
- **Performance** : parcourir dix articles vidéo ne charge plus dix lecteurs.
- **Hors ligne** : la miniature est déjà en cache → on voit la vignette au lieu
  d'un cadre d'erreur.

## Périmètre — quels articles

- **Article de flux YouTube** : l'URL de l'article est une vidéo (abonnement à
  une chaîne).
- **Vidéo intégrée** : iframe YouTube ou lien vers une vidéo dans le corps d'un
  article, y compris les iframes actuellement supprimés.

Formats d'URL couverts : `youtube.com/watch?v=`, `youtu.be/`, `/embed/`,
`/shorts/`, avec paramètres additionnels. Le paramètre de temps (`t=90`,
`start=90`) est **préservé** et transmis au lecteur.

## Position du lecteur

- **Article de flux YouTube** : façade **en tête**, avant la description — c'est
  le sujet de l'article. Rendue comme composant React, avant le conteneur de
  contenu. Déduplication si le corps référence déjà la même vidéo.
- **Vidéo intégrée** : façade **à sa position d'origine** dans le texte, là où
  l'auteur l'avait placée.

## Mécanique

1. **Avant sanitisation** : les iframes et liens YouTube du contenu sont
   remplacés par le balisage de façade (balises autorisées uniquement).
2. **Sanitisation** : le balisage passe intact.
3. **Au clic** : un écouteur délégué sur le conteneur de contenu remplace la
   façade par un iframe construit via l'API DOM (donc hors sanitizer) :
   `https://www.youtube-nocookie.com/embed/<id>?autoplay=1[&start=<s>]`, avec
   `referrerpolicy="strict-origin-when-cross-origin"`, `allowfullscreen`, et les
   permissions minimales.

## Miniature

Priorité à celle **fournie par l'article** (cas des flux YouTube) : aucune
requête supplémentaire, et elle est déjà dans le cache hors ligne. Repli sur
`i.ytimg.com/vi/<id>/hqdefault.jpg` quand l'article n'en fournit pas —
typiquement une vidéo intégrée à un billet.

## Hors ligne

La façade s'affiche normalement (miniature en cache). Le bouton lecture indique
que la vidéo nécessite une connexion plutôt que d'ouvrir un iframe voué à
l'échec.

## Préférence

Interrupteur **« Lire les vidéos dans l'article »**, activé par défaut, synchronisé
par utilisateur. Désactivé : un lien « Ouvrir sur YouTube » remplace la façade.

## Vue grille et liste

Badge lecture discret sur la miniature des cartes dont l'article est une vidéo,
pour repérer les vidéos sans ouvrir l'article.

## TDD — logique pure extraite

- `extractYouTubeId(url)` : identifiant + temps de départ, tous formats.
- `youtubeThumbnail(id)` : URL de miniature de repli.
- `injectVideoFacades(html)` : remplace iframes et liens YouTube du contenu par
  le balisage de façade, et signale les identifiants trouvés (pour la
  déduplication avec la façade de tête).

Le reste (écouteur de clic, création de l'iframe) est de l'orchestration DOM,
couverte par la vérification navigateur.

## i18n

Toutes les nouvelles chaînes dans **les 9 locales**.

## Hors périmètre v1

- Autres plateformes (Vimeo, PeerTube, Dailymotion…).
- Playlists, chapitres, lecture en arrière-plan.
- Téléchargement de vidéos pour le hors ligne.

## Fichiers concernés (estimation)

- `src/lib/youtube.ts` — **nouveau** (+ tests) : détection, miniature, injection.
- `src/components/ReadingPane/ReadingPane.tsx` — façade de tête, écouteur de clic.
- `src/components/ArticleList/ArticleCard.tsx` — badge lecture.
- `src/stores/uiStore.ts` — préférence (synchronisée).
- `src/components/Preferences/Preferences.tsx` — l'interrupteur.
- `src/styles/index.css` — styles de la façade et du badge.
- `src/locales/*.json` (×9).
