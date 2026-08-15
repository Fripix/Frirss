# Mode SSO-only

**Date :** 2026-08-15 · **Cible :** 1.3.4 (dev) · **Origine :** demande Reddit

## Problème
Quand l'OIDC/SSO est activé, on ne peut pas masquer le formulaire de connexion
locale (identifiant/mot de passe). Utile pour les installs où l'authentification
est centralisée (Authelia, Authentik, Keycloak…).

## Solution
Réglage admin « Mode d'authentification » : **Local + SSO** (défaut) / **SSO
uniquement**. En mode SSO-only, le formulaire local est masqué sur l'écran de
connexion ; seul le bouton SSO reste.

### Serveur
- Nouveau réglage `oidc_sso_only` (comme `oidc_enabled`).
- `GET`/`PUT /api/admin/settings` : lit/écrit `ssoOnly`.
- `server/oidc.ts` `getOidcConfig()` : expose `ssoOnly`.
- **Public** `/api/auth/oidc/config` renvoie `ssoOnly`, **mais seulement si
  l'OIDC est activé** (`cfg.enabled && cfg.ssoOnly`) — garde-fou : OIDC désactivé
  ⇒ le formulaire local revient.

### Login (`Login.tsx`)
- Décision via helper pur `shouldHideLocalLogin({ oidcEnabled, ssoOnly, hasUsers,
  forceLocal })` = `oidcEnabled && ssoOnly && hasUsers && !forceLocal`.
- Masqué ⇒ champs + bouton local + bascule login/register cachés ; seul le bouton
  SSO affiché.
- **Garde-fous anti-verrouillage :**
  - **Premier utilisateur** (`!hasUsers`) → formulaire local toujours visible.
  - **Échappatoire** : `?local=1` (état `forceLocal`) + lien discret
    « Connexion locale » qui réaffiche le formulaire.

### Admin (préférences)
- Dans la section OIDC (visible quand OIDC activé) : groupe **radio** « Mode
  d'authentification » → « Local + SSO » / « SSO uniquement », lié à `ssoOnly`
  (sauvegarde immédiate via `updateAdminSettings`).

### i18n
Nouvelles chaînes dans **les 9 langues** (admin : mode + 2 options ; login : lien
« Connexion locale »).

## Vérification
- TDD `shouldHideLocalLogin` (garde-fous inclus).
- `:dev` : OIDC on + SSO-only → écran de login sans formulaire local, bouton SSO
  seul, lien « Connexion locale » qui le réaffiche.
