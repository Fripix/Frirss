# 1.6.1 — en préparation

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

- **Connexion OIDC derrière un SSO tiers (issue #23).** Le callback OIDC
  échouait avec `URIError: URI malformed` dès qu'un cookie du domaine (Authelia
  derrière SWAG, par exemple) portait une séquence `%` invalide : le parseur
  de cookies décodait chaque valeur sans tolérance. Une valeur indécodable est
  maintenant gardée telle quelle ; seuls `oidc_verifier` et `oidc_nonce` sont
  lus, et eux sont toujours bien encodés. Parseur extrait dans
  `server/cookies.ts`, testé.
- **« Ouvrir à la source » est un lien (issue #21).** Dans les modes liste et
  grille, l'icône était un bouton sans `href` : les extensions de
  prévisualisation d'URL et « copier l'adresse du lien » ne la voyaient pas.
  C'est désormais un `<a href>` vers l'article ; le clic garde le comportement
  d'avant (nouvel onglet puis sélection de l'article), sans double ouverture.
- **Connexion SSO derrière un split-DNS.** Depuis la 1.4.4, la découverte OIDC
  passait par la garde anti-SSRF, qui refusait l'émetteur dès que son nom
  public se résolvait en IP privée depuis le conteneur (cas typique : le
  fournisseur d'identité derrière le même reverse proxy, sur le même réseau).
  Toute connexion SSO échouait alors en `login_failed`, sans explication.
  L'hôte de l'émetteur, fixé par l'administrateur, est désormais de confiance
  pour la garde ; et l'échange du code et `userinfo`, jusqu'ici des `fetch`
  hors garde, passent par elle avec la même règle. Une redirection de
  l'émetteur vers un autre hôte interne reste refusée. Décision et coût dans
  `SECURITY.md`.

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

- Aucune. Si vous aviez ajouté l'hôte de votre fournisseur OIDC à
  `PROXY_INTERNAL_HOSTS` pour contourner `login_failed`, vous pouvez le retirer
  (le garder ne change rien).

## Documentation

_(rien pour l'instant)_
