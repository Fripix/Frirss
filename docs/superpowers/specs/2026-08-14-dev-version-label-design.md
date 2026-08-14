# Étiquette de version dev (beta)

**Date :** 2026-08-14 · **Cible :** 1.3.4 (dev)

## Problème
Impossible de savoir quel build `:dev` on teste : la version affichée en bas de
la sidebar est la même que prod (`v1.3.3`).

## Solution
Sur un build **dev**, afficher une étiquette `v<version>b<N>` (ex. `v1.3.4b3`,
« beta N ») en couleur accent. Sur prod, l'affichage reste `v<version>` discret.
`N` s'incrémente automatiquement à chaque push sur `dev`.

### Mécanique
1. `dev` bumpé en **1.3.4** (`package.json` + `server/index.ts`) → ligne 1.3.4 ;
   prod reste 1.3.3 jusqu'à la release.
2. Constante build `__APP_DEV_VERSION__` via Vite `define` depuis
   `FRIRSS_DEV_VERSION` (vide par défaut → prod).
3. Dockerfile : `ARG FRIRSS_DEV_VERSION` + `ENV` avant `npm run build`.
4. `publish.yml` (branche `dev` uniquement) : calcule
   `v$(pkg.version)b$(git rev-list --count --no-merges <dernier-tag>..HEAD)` et le
   passe en build-arg. `fetch-depth: 0` requis pour le tag + le comptage. Sur
   main/tags → vide.
5. Sidebar : `resolveVersionLabel(devVersion, appVersion)` ; teinte accent quand
   `__APP_DEV_VERSION__` est défini.

### Numérotation
`N` = nombre de commits **hors merges** depuis la dernière release taguée →
1 par fonctionnalité, remis à 0 à chaque release. (startup = b1, catégories =
b2, cette fonctionnalité = b3.)

## Vérification
- TDD `resolveVersionLabel` : renvoie le label dev si défini, sinon `v<app>`.
- `:dev` doit afficher `v1.3.4b<N>` en accent ; prod reste `v1.3.3`.
