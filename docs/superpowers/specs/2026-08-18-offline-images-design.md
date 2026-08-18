# Images hors ligne — fiables et maîtrisées — design

**Date** : 2026-08-18
**Statut** : approuvé (brainstorming) — en attente relecture spec
**Origine** : point #9 de la liste Reddit (« sauvegarder les images d'articles
pour la lecture hors ligne »).

## Contexte — ce qui existe déjà

Le mécanisme est **partiellement en place**, ce qui recentre le travail :

- Un cache d'images service-worker (Workbox `CacheFirst`, `frirss-images`,
  2000 entrées max, 30 jours, `purgeOnQuotaError`).
- `prefetchImages(html)` dans `feedStore` : télécharge jusqu'à **6 images par
  article** en `no-cors` / `force-cache`, pour que le service worker les garde.
- `prepareOffline()` : balayage manuel de tous les flux sur 30 jours, qui
  persiste les listes, extrait le contenu et appelle `prefetchImages`.

## Les 4 trous identifiés (le vrai contenu du #9)

1. **Prefetch couplé à l'extraction** : les images ne sont téléchargées que si
   l'article est extrait à cet instant (`if (a.url && !déjàExtrait)`). Extrait
   déjà en cache ⇒ aucune image. Extraction en échec ⇒ aucune image.
2. **Vignettes de liste/grille absentes** : seules les images du *contenu
   extrait* sont prises. Les vignettes viennent de `article.content` (contenu
   RSS) — c'est le manque le plus visible dans la vue grille.
3. **Plafonds arbitraires et serrés** : 6 images/article et 2000 entrées au
   total pour 30 jours × tous les flux.
4. **Aucune visibilité ni contrôle** : espace occupé inconnu, pas de purge, pas
   de réglage.

## Décisions (brainstorming)

- **Objectif** : fiabiliser **et** contrôler.
- **Volume** : préréglages, pas de limite chiffrée imposée par défaut.
- **Priorité quand le budget est atteint** : à lire plus tard + favoris, puis
  non lus du plus récent au plus ancien, puis le reste.
- **Où se règlent les préréglages** : **dans l'interface**, pas en variables
  d'environnement — voir ci-dessous.
- **Valeur personnalisée** : oui, en plus des préréglages.

### Pourquoi l'interface et non des variables docker-compose

Le stockage concerné est celui du **navigateur de chaque appareil**, pas du
serveur : ces images ne transitent même pas par le backend. Une variable
d'environnement est fixée par l'administrateur, identique pour tous les
utilisateurs et tous les appareils, et exige un redémarrage — alors que
l'arbitrage est propre à chaque appareil (téléphone vs poste fixe).

Surtout, `navigator.storage.estimate()` retourne l'espace utilisé **et le quota
réellement autorisé** sur cet appareil : l'interface peut afficher des chiffres
vrais, ce qu'une constante serveur ne permet pas.

> À noter pour plus tard (hors périmètre) : si un besoin de bridage côté serveur
> apparaît, le bon levier serait la **préparation hors ligne** elle-même (le
> balayage sollicite le backend et FreshRSS), pas le poids des images.

## Fiabilité — ce qui change

- **Découpler le prefetch d'images de l'extraction** : étape indépendante,
  exécutée que l'extrait soit déjà en cache ou non.
- **Inclure les vignettes RSS** (`article.content`) en plus des images du
  contenu extrait, dédoublonnées.
- **Plafond par article piloté par le budget** : la vignette d'abord (suffisante
  pour lister et pour la grille), puis les images du corps si le préréglage le
  permet.
- **Téléchargements par lots parallèles bornés** (~4 en parallèle) au lieu du
  `await` séquentiel actuel.

## Budget

| Préréglage | Ordre de grandeur | Contenu |
|---|---|---|
| Aucune image | — | rien n'est téléchargé |
| Léger | ~200 Mo | vignettes seules |
| Standard (défaut) | ~500 Mo | vignettes + images d'article |
| Maximum | ~1 Go | vignettes + images d'article |
| Personnalisé | valeur en Mo saisie | vignettes + images d'article |

### Contrainte technique assumée — réponses opaques

Les images sont chargées **directement depuis leur origine** (pas via le proxy
same-origin), donc en `no-cors` : les réponses sont **opaques**. JavaScript ne
peut pas lire leur taille, et le navigateur les rembourre dans le Cache Storage.

Conséquences, à assumer explicitement :

- L'espace affiché provient de `navigator.storage.estimate().usage` — le chiffre
  que le navigateur rapporte réellement (il englobe tout le stockage de
  l'origine, pas seulement les images).
- Le budget est appliqué en **surveillant la progression de cette estimation**
  pendant la préparation, et en s'arrêtant quand le delta dépasse le budget.
- Le plafond d'entrées Workbox reste en **filet de sécurité**.
- L'interface parle donc d'**« environ »** ; ce ne sont pas des limites au
  kilo-octet près. Ne jamais afficher ces valeurs comme exactes.

## Priorité de remplissage

1. Articles **à lire plus tard** et **favoris** (marqués intentionnellement).
2. **Non lus**, du plus récent au plus ancien.
3. Le reste, si la place le permet.

Arrêt net dès que le budget est atteint.

## Réglages — Préférences → Hors-ligne

La section existante accueille :

- Le choix du préréglage (contrôle segmenté, cohérent avec les autres contrôles
  de l'app) + champ Mo quand **Personnalisé** est choisi.
- **Espace utilisé** et **quota de l'appareil**, lus depuis le navigateur :
  « Espace utilisé : ~340 Mo · votre navigateur autorise ~6 Go sur cet appareil ».
- Un **avertissement** si le préréglage (ou la valeur personnalisée) dépasse le
  quota rapporté par l'appareil.
- Un bouton **« Vider les images »** (purge du cache `frirss-images`).

Le préréglage est **synchronisé par utilisateur** (comme les autres préférences
logiques) ; c'est un choix de confort, pas une donnée géométrique liée à
l'appareil.

## TDD — logique pure extraite

- `collectImageUrls(html, limit)` : extraction, filtrage (`http`) et
  dédoublonnage des URLs d'images.
- `imageBudget(preset, customMb)` : budget en octets + nombre d'images par
  article autorisé (vignette seule vs vignette + corps).
- `prioritizeForOffline(articles)` : ordre de remplissage (à lire plus tard /
  favoris → non lus récents → reste).

Le reste (fetch, cache, estimation) est de l'orchestration réseau/navigateur,
couverte par la vérification manuelle.

## i18n

Toutes les nouvelles chaînes dans **les 9 locales** (`src/locales/*.json`).

## Hors périmètre v1

- Pas de sélection des flux « à images » (flux par flux).
- Pas d'option « Wi-Fi uniquement » (l'avertissement réseau existant suffit).
- Pas de purge sélective par flux.
- Pas de variable d'environnement (voir justification ci-dessus).

## Fichiers concernés (estimation)

- `src/lib/offlineImages.ts` — **nouveau** (+ tests) : les 3 fonctions pures.
- `src/lib/storageEstimate.ts` — **nouveau** : encapsule
  `navigator.storage.estimate()` avec repli si indisponible.
- `src/stores/uiStore.ts` — préréglage + valeur personnalisée (synchronisés).
- `src/stores/feedStore.ts` — `prepareOffline` / prefetch d'images revus.
- `src/components/Preferences/Preferences.tsx` — section Hors-ligne.
- `vite.config.js` — plafond d'entrées Workbox en filet de sécurité.
- `src/locales/*.json` (×9).
