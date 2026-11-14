# Installation pour débutants et guide IA — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un README qu'un débutant suit étape par étape, un guide `docs/INSTALL-WITH-AI.md` qu'un assistant IA lit pour guider l'installation, gardé juste par un test, et le site vitrine qui y renvoie.

**Architecture :** une seule source (README + `docker-compose.yml`) ; le guide IA en dérive et un test vitest vérifie qu'il ne s'en écarte pas ; le site ne fait que désigner le guide (phrase à copier, `llms.txt`). Travail FriRSS sur `main` (lien brut), puis `main` fusionné dans `dev` ; site sur une branche de son dépôt.

**Tech Stack :** Markdown rendu GitHub (`gfm`), vitest, Astro (site).

**Spec :** `docs/superpowers/specs/2026-11-14-beginner-install-and-ai-guide-design.md` (sur `dev`, commit 8e33437). La lire avant chaque tâche.

## Global Constraints

- Anglais simple dans le README et le guide ; français dans les `CLAUDE.md` et la conversation.
- Commandes : image `ghcr.io/fripix/frirss:latest`, montage `/app/data`, port `8080:80`, `--restart unless-stopped`, `-e TZ=Europe/Zurich` — identiques partout.
- Unraid (modèle `Fripix/unraid-templates/templates/frirss.xml`) : port hôte `8787`, `PUID` `99`, `PGID` `100`, champ « FreshRSS Internal Host ».
- Aucune variable inventée : seules celles du tableau Configuration du README existent.
- Le titre `## Configuration` et le format de ligne `` | `NOM` | `` restent (lus par `sync-check.mjs` du site).
- Aucun texte du README ne disparaît : il est déplacé (paragraphe d'extraction en `<details>`, blocs reverse proxy et Ollama à l'étape 4).
- Garde-fou de fuite avant chaque commit, valeurs fictives (`192.168.1.20`, `example.com`).
- Commits sans trailer `Co-Authored-By`, sans mention d'IA.
- **Pousser `main` attend l'accord explicite du propriétaire.** Site : « fusionne » puis « pousse ».

## Review Focus

1. **`localhost` saisi comme adresse de FreshRSS** alors que FreshRSS tourne sur le même hôte : dans le conteneur, `localhost` est FriRSS lui-même. Le guide et l'étape 3 du README disent d'utiliser l'IP de l'hôte ou le nom du service Docker (test en tâche 2).
2. **Mauvais port selon la méthode** : 8080 pour Docker/Compose, 8787 pour Unraid (test en tâche 2).
3. **Assistant qui demande un mot de passe** : le guide l'interdit explicitement (test en tâche 2, vérification en tâche 4).
4. **Docker absent ou Raspberry en OS 32 bits** : l'étape 0 renvoie à l'installation de Docker et dit « OS 64 bits » (vérification en tâche 4).
5. **Lien brut périmé ou en 404** tant que `main` n'est pas poussé (contrôle `curl` en tâche 5).

---

### Task 1 : README en étapes et `docker-compose.yml`

**Files :**
- Modify : `README.md` (haut de page, `## Installation`, `## Configuration`)
- Modify : `docker-compose.yml`

**Interfaces :**
- Produces : la phrase à copier, exactement
  `Read https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md and help me install FriRSS step by step.`
  dans un bloc de code de l'étape 0 (la tâche 2 la teste) ; le tableau Configuration groupé avec `TZ` en plus.

- [ ] **Step 1 : se placer sur `main` à jour**

Run : `git checkout main && git pull --ff-only`
Expected : `main` = `origin/main`, arbre propre.

- [ ] **Step 2 : haut de page**

Juste avant `## Preview`, deux phrases : FreshRSS récupère et garde les flux, FriRSS est l'interface où on les lit ; il faut une instance FreshRSS et une machine avec Docker. *About* inchangé.

- [ ] **Step 3 : `## Installation` en étapes**

Sous-titres `### 0. Before you start`, `### 1. Start FriRSS`, `### 2. Create your account`, `### 3. Connect FreshRSS`, `### 4. Going further (optional)`, contenu selon la spec §1. Étape 0 : prérequis FreshRSS, lien `https://docs.docker.com/get-docker/`, « 64-bit OS » pour un Raspberry, encadré *Install with an AI assistant* avec la phrase. Étape 1 : `#### Docker` (ajouter `--restart unless-stopped`), `#### Docker Compose`, `#### Unraid` (port 8787), puis `curl http://localhost:8080/api/health`. Étape 3 : l'encadré adresse privée tel quel, plus une ligne sur `localhost`. Étape 4 : blocs reverse proxy, 120 s et Ollama déplacés tels quels, plus une ligne Redis renvoyant à Configuration.

- [ ] **Step 4 : `## Configuration` groupée**

Quatre `###` (*Start*, *Network*, *Cache (Redis)*, *Limits and storage*), une phrase « when you need it » chacun, un tableau par groupe, répartition de la spec. Ligne ajoutée : `` | `TZ` | Container time zone, for dates and logs (e.g. `Europe/Paris`) | `UTC` | `` — vérifier le défaut réel dans `Dockerfile` avant d'écrire. Le paragraphe d'extraction passe intégralement dans `<details><summary>How article extraction works</summary>` ; la ligne SSO reste.

- [ ] **Step 5 : `docker-compose.yml`**

Sous `FRIRSS_BASE_URL`, ajouter :
```yaml
      # FreshRSS on a private address (LAN IP or Docker service name)? Trust it here:
      # - PROXY_INTERNAL_HOSTS=192.168.1.20
```

- [ ] **Step 6 : vérifier qu'aucun texte n'a disparu**

Run : `git diff -U0 main -- README.md | grep '^-' | grep -v '^---'` et vérifier que chaque ligne retirée se retrouve, déplacée, dans le nouveau README (hors lignes réécrites des étapes).
Expected : aucune phrase perdue.

- [ ] **Step 7 : aperçu du rendu**

Run : `jq -Rs '{text: ., mode: "gfm", context: "Fripix/Frirss"}' README.md | gh api /markdown --input - > "<scratchpad>/readme.html"`, ouvrir dans le navigateur intégré, capture.
Expected : sections numérotées lisibles, `<picture>` des bannières intactes, `<details>` replié.

Pas de commit séparé : le commit groupé est en tâche 3.

### Task 2 : guide IA et son test garde-fou

**Files :**
- Create : `src/lib/installWithAiDoc.test.ts`
- Create : `docs/INSTALL-WITH-AI.md`

**Interfaces :**
- Consumes : README de la tâche 1 (section `## Configuration`, phrase à copier), `docker-compose.yml`.
- Produces : `docs/INSTALL-WITH-AI.md` avec une section `## Environment variables` (tableau `` | `NOM` | rôle | défaut | ``).

- [ ] **Step 1 : écrire le test**

```ts
const vars = (md: string, heading: string) => {
  const part = md.split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1]?.split(/^## /m)[0] ?? '';
  return [...part.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]).sort();
};
describe('docs/INSTALL-WITH-AI.md', () => {
  it('lists exactly the variables of the README Configuration section', () => {
    expect(vars(GUIDE, 'Environment variables')).toEqual(vars(README, 'Configuration'));
    expect(vars(README, 'Configuration').length).toBeGreaterThan(10);
  });
  it('uses the image, volume and ports of the README and compose file', () => {
    for (const s of ['ghcr.io/fripix/frirss:latest', '/app/data', '8080:80', '--restart unless-stopped'])
      { expect(GUIDE).toContain(s); expect(README).toContain(s); }
    expect(COMPOSE).toContain('ghcr.io/fripix/frirss:latest');
    expect(GUIDE).toContain('8787');
  });
  it('is the link the README tells people to copy', () => {
    expect(README).toContain('https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md');
  });
  it('keeps the safety rules and the known traps', () => {
    expect(GUIDE).toMatch(/^## Never do this/m);
    expect(GUIDE).toMatch(/password/i);
    expect(GUIDE).toContain('POST /api/proxy 403');
    expect(GUIDE).toMatch(/localhost/);
    expect(GUIDE).toContain('OLLAMA_CONTEXT_LENGTH=16384');
  });
});
```
`README`, `GUIDE`, `COMPOSE` lus avec `fs.readFileSync(path.join(process.cwd(), …))` ; un en-tête de commentaire dit ce que le test n'attrape pas (prose fausse), comme `featuresDoc.test.ts`.

- [ ] **Step 2 : le voir échouer**

Run : `npx vitest run src/lib/installWithAiDoc.test.ts`
Expected : FAIL (ENOENT sur `docs/INSTALL-WITH-AI.md`).

- [ ] **Step 3 : écrire le guide**

Sections, dans l'ordre : `## How to use this guide` (règles : une étape à la fois, langue de la personne, vérifier avant de continuer, le README fait foi, aucune variable hors du tableau) ; `## What FriRSS is` ; `## Ask first` ; `## Install` (Docker, Compose = renvoi au `docker-compose.yml` du dépôt, Unraid) ; `## After it starts` (`/api/health`, premier compte = admin, connexion FreshRSS, choix `PROXY_INTERNAL_HOSTS` / `PROXY_REWRITES` selon la spec) ; `## Troubleshooting` (symptôme → cause → correctif, liste de la spec + `localhost`) ; `## Never do this` ; `## Environment variables` (tableau recopié du README).

- [ ] **Step 4 : le voir passer**

Run : `npx vitest run src/lib/installWithAiDoc.test.ts`
Expected : PASS, 4 tests.

- [ ] **Step 5 : prouver qu'il sait échouer**

Ajouter une ligne `` | `FAKE_VAR` | x | — | `` au guide → le test 1 rougit ; la retirer. Retirer `TZ` du tableau du README → rougit ; la remettre.
Expected : rouge, puis vert.

### Task 3 : règles de tenue à jour et commit sur `main`

**Files :**
- Modify : `CLAUDE.md` (bloc après « Inventaire des fonctionnalités » ; étape 3 de « Release »)

- [ ] **Step 1 : règle permanente**

Nouveau bloc `## Guide d'installation pour les IA` : `docs/INSTALL-WITH-AI.md` est servi en brut depuis `main` et lu par les assistants des utilisateurs ; tout changement d'installation, de variable, de défaut, de port ou de message d'erreur qu'il cite le met à jour **dans le même commit**, prose relue ; `installWithAiDoc.test.ts` n'attrape que les variables. Un guide faux est pire qu'absent.

- [ ] **Step 2 : procédure de release**

À l'étape 3 : « relire `docs/INSTALL-WITH-AI.md` avec le README, et le `llms.txt` du site avec le site ».

- [ ] **Step 3 : gates, garde-fou, commit**

Run : `npm run typecheck && npm run lint && npx vitest run && npm run build && git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
Expected : gates verts, garde-fou sans sortie (code 1).
Puis : `git add README.md docker-compose.yml docs/INSTALL-WITH-AI.md src/lib/installWithAiDoc.test.ts CLAUDE.md && git commit -m "docs: step-by-step install and a guide for AI assistants"`.

### Task 4 : vérifications avant la poussée

- [ ] **Step 1 : l'assistant simulé**

Agent sans contexte, trois passes (profils de la spec : Raspberry + FreshRSS sur IP privée ; Unraid + même réseau Docker ; VPS + reverse proxy + FreshRSS public). Il reçoit le contenu local du guide à la place du lien et une personne simulée qui répond. Un second agent compare ses commandes au README.
Expected : commandes conformes, bon port, aucun mot de passe demandé, aucune variable inventée, `localhost` évité.

- [ ] **Step 2 : `docker run` réel**

Sur le NAS (accès SSH habituel, mémoire `frirss-release-state`), la commande du guide avec `--name frirss-guide-check`, port hôte `18080`, dossier de données temporaire ; `curl http://localhost:18080/api/health` après ~15 s ; puis `docker rm -f frirss-guide-check` et suppression du dossier temporaire.
Expected : JSON de santé avec la version.

- [ ] **Step 3 : lecture débutant**

Agent sans contexte qui ne connaît ni FreshRSS ni Docker : lit le haut du README rendu.
Expected : il sait dire ce qu'est FriRSS, ce qu'il lui faut, par où commencer. Sinon, corriger, recommiter (`--amend` tant que non poussé), refaire.

### Task 5 : publication sur `main`, alignement de `dev`

- [ ] **Step 1 : montrer et demander**

Envoyer la capture de l'aperçu et le résumé des vérifications ; **demander l'accord de pousser `main`**.

- [ ] **Step 2 : pousser et contrôler**

Run : `git push origin main`, puis `curl -sf https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md | head -3`, puis `gh run list --branch main --limit 2`.
Expected : le guide est servi ; CI et Publish verts.

- [ ] **Step 3 : `dev`**

Run : `git checkout dev && git merge origin/main && git merge-base --is-ancestor origin/main dev && echo ok && git push origin dev && gh run list --branch dev --limit 2`
Expected : `ok`, les deux workflows verts.

### Task 6 : site vitrine (dépôt `../FriRSS-Site`)

**Files :**
- Modify : `src/components/Installation.astro` (section `#prerequisites`), `src/i18n/fr/installation.json`, `src/i18n/en/installation.json`
- Create : `public/llms.txt`
- Modify : `scripts/sync-check.mjs` (comparaison des variables)
- Modify : `src/config/installation.ts` (constante `aiPrompt`)

Suivre le `CLAUDE.md` du site et sa charte `docs/DESIGN.md`.

- [ ] **Step 1 : branche**

Run : `git -C ../FriRSS-Site checkout -b install-with-ai`

- [ ] **Step 2 : `sync-check` et `TZ`**

Dans `sync-check.mjs`, compter `TZ` comme montrée quand `installation.docker` contient `-e TZ=`. Run : `npm run sync:check -- --frirss ../FriRSS` (ou `node scripts/sync-check.mjs --frirss ../FriRSS`).
Expected : aucune « nouvelle variable : TZ » ; les sections README modifiées sont signalées pour relecture.

- [ ] **Step 3 : bloc « Installer avec une IA »**

`installation.ts` : `export const aiPrompt = 'Read https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md and help me install FriRSS step by step.'` (version française de la phrase dans `fr/installation.json`, avec la même URL). Dans `#prerequisites`, après la liste : un titre, une phrase, `<CodeBlock code={…} label={…} t={t} />`. Clés `aiTitle`, `aiText`, `aiPrompt`, `aiLabel` dans les deux langues. Texte proposé au propriétaire avant fusion.

- [ ] **Step 4 : `public/llms.txt`**

Format llms.txt : `# FriRSS`, une ligne de résumé en `>`, puis `## Docs` avec les liens : guide IA brut, README GitHub, page Installer anglaise et française.

- [ ] **Step 5 : revue et gates du site**

Relire les sections README signalées en step 2 contre les textes du site ; corriger uniquement un écart de fait. Puis `--accept` selon `docs/RELEASES.md`. Run : `npm run check && npm run build && PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npx playwright test --workers=1`
Expected : tout vert.

- [ ] **Step 6 : captures et audit**

Aperçu `frirss-site`, page Installer fr et en, desktop et 320 px ; audit impeccable du bloc ; captures envoyées au propriétaire. Commit sur la branche, chercher les traces privées avant.
Expected : attendre « fusionne », puis « pousse ».
