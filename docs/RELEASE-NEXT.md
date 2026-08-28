# 1.4.4 — en préparation

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

- **Sécurité — le jeton FreshRSS ne peut plus partir chez un tiers.** Le proxy
  décidait d'attacher le jeton en comparant la cible à l'URL du serveur par
  simple préfixe de chaîne : `https://serveur.tld.tiers.tld/` et
  `https://serveur.tld@tiers.tld/` passaient tous deux le contrôle, alors que
  ni l'un ni l'autre n'est le serveur. Les URL d'images d'articles et de
  favicons venant du contenu des flux, un flux hostile suffisait à faire
  envoyer le jeton — un accès complet au compte FreshRSS — vers son propre
  domaine. La comparaison porte désormais sur l'origine analysée, chemin
  compris.

- **Sécurité — le proxy a désormais un plafond de cadence.** Un compte
  authentifié pouvait faire émettre au backend autant de requêtes sortantes
  qu'il le voulait : le proxy venait avec un relais anonymisant offert. Le
  plafond est de 600 requêtes par utilisateur et par minute, réglable par
  `FRIRSS_PROXY_RATE_LIMIT` (`0` désactive). Il est délibérément haut : la
  préparation hors-ligne, de loin le plus gros consommateur, reste sous la
  centaine de requêtes par minute.
- **Sécurité — l'authentification est vérifiée avant de lire le corps d'une
  requête proxifiée.** Un inconnu pouvait faire allouer jusqu'à 5 Mo par
  requête avant de recevoir son 401.
- **Sécurité — les préférences ne peuvent plus grossir sans fin.** Ni la
  longueur des clés, ni la taille des valeurs, ni leur nombre n'étaient bornés :
  un compte authentifié pouvait remplir le volume SQLite. Les plafonds (clé ≤
  128 caractères, valeur ≤ 1 Mio, 200 clés par requête, 500 par utilisateur)
  laissent une large marge au client réel.

## Sous le capot

- **La découverte OIDC passe par le garde anti-SSRF.** C'était le seul appel
  sortant du serveur à utiliser `fetch()` directement, sur une URL d'émetteur
  que l'administrateur fixe librement.
- **Le proxy ouvert du serveur de développement est supprimé.** Il relayait vers
  n'importe quelle URL en réexpédiant tous les en-têtes du client, en-têtes
  d'authentification compris — l'équivalent de l'endpoint retiré de la
  production en 1.3.1. Plus rien ne l'utilisait.

## Actions requises à la mise à jour

_(à compléter)_

## Documentation

_(rien pour l'instant)_
