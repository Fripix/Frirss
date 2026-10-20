# Résumés IA — plan 2 (réglages de chacun) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque utilisateur la main sur ses résumés IA — fournisseur
préféré, repli, résumé automatique, fournisseur par flux et par catégorie, clés
personnelles — et finir les restes du plan 1 (effacer une clé admin, raccourci
et palette, nettoyage à la déconnexion).

**Architecture:** Le serveur sait déjà résoudre forçage > flux > catégorie >
préféré > défaut admin et replier (`server/ai/resolve.ts`, `summarize.ts`) :
ce plan ajoute la route des clés personnelles et les écrans. Les choix de
chacun sont des préférences synchronisées de `uiStore`, traduites en champs
de la requête de résumé par une fonction pure. La section « IA » des
Préférences est découpée en un fichier par bloc sous
`src/components/Preferences/ai/`.

**Tech Stack:** TypeScript strict, React 18, zustand, Express 5,
better-sqlite3, vitest + Testing Library, i18next (10 locales).

**Spec:** `docs/superpowers/specs/2026-10-15-ai-summaries-design.md` — §5
(préférences), §6 (clés, résolution, repli), §8 (résumé automatique), §10
(section « IA »), §15 étapes 4 et 5. Plan précédent :
`docs/superpowers/plans/2026-10-15-ai-summaries-core.md`.

## Global Constraints

- Branche `ai-summaries` ; jamais `dev` ni `main` sans le propriétaire.
- Gates avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- Garde-fou de fuite avant chaque commit, sortie vide exigée :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`.
  Valeurs de test fictives seulement (`example.com`, `10.0.0.1`).
- Messages de commit conventionnels, **sans** trailer `Co-Authored-By` ni mention d'assistant.
- Toute chaîne visible dans les **10 locales** (fr, en, de, es, it, nl, pl, pt, uk, zh) ;
  pluriels `_one`/`_other`, plus `_few`/`_many` pour pl et uk. Parité vérifiée par la
  commande de `CLAUDE.md`. Le chinois dit « 服务商 » pour « fournisseur ». Le portugais
  est européen (« A carregar… »).
- `docs/FEATURES.md` (famille « Résumés par IA ») mis à jour **dans le commit** qui change
  le comportement ; toute route nouvelle va dans son tableau des routes
  (`featuresDoc.test.ts` le vérifie).
- Une clé n'est **jamais** renvoyée, journalisée ni mise dans une URL ; seulement `hasUserKey` / `hasAdminKey`.
- Préférences de l'utilisateur : en clair, synchronisées, jamais une clé (spec §5).
- Cibles tactiles de 44 pt (`prefs-tap-row` / `prefs-tap-btn`), libellés liés, surfaces
  flottantes par portail (`ConfirmDialog` le fait déjà).
- Trois formats à chaque fois ; mise en page mobile vérifiée **à 320 px**.
- Aucune dépendance nouvelle.
- Texte de confirmation du résumé automatique, **mot pour mot** (spec §8) :
  « Chaque résumé automatique est un appel à votre fournisseur d'IA. Selon le
  fournisseur et votre abonnement, il peut vous être facturé. Un modèle local
  comme Ollama ne coûte rien. »
- Aide du repli (spec §10) : « Si votre fournisseur échoue, le suivant de la liste prend le relais. »

## Décisions prises en écrivant ce plan

- **Noms des préférences** : à plat, comme `aiSummaryRatio` déjà livré, et non
  `ai.preferredProvider` comme l'écrit la spec §5 : `aiPreferredProvider`,
  `aiFallback`, `aiAutoSummary`, `aiCategoryProviders`, et `feedSettings[flux].aiProvider`.
- **Clés personnelles quand l'admin retire l'autorisation** : elles restent en base
  mais ne servent plus, et `/api/ai/config` répond `hasUserKey: false`. Remettre
  l'autorisation les rétablit. La spec ne dit rien ; les effacer serait irréversible.
- **Usage du jour** : affiché dans le bloc « Résumés », pas dans « Mes clés » comme
  le dit la spec §10. « Mes clés » n'existe que si les clés personnelles sont
  permises ; or c'est justement quand elles ne le sont pas que tout passe par la
  clé de l'instance et que le plafond compte.
- **Clé personnelle refusée** : le message dit « Vérifiez-la dans Préférences › IA »
  (`ai.errors.auth`) même pour un non-admin, puisque c'est la sienne ; la réponse
  d'erreur porte `ownKey: true` pour que le client le sache.
- **Résumé automatique raté parce que l'article est trop court** : rien ne s'affiche,
  le panneau reste à « Pas encore résumé ». Toute autre erreur s'affiche comme pour
  un clic.
- **Catégorie** : repérée par son **nom** (`aiCategoryProviders[nom]`, spec §5). Une
  catégorie renommée perd son réglage ; c'est écrit dans l'inventaire comme limite connue.
- **Pas d'entrée IA dans le menu contextuel d'un flux** dans ce plan : le bloc « Par
  flux et catégorie » est l'endroit unique, avec sa vue d'ensemble. Le menu
  contextuel porte déjà extraction, disposition et ordre ; l'y ajouter reste
  possible ensuite sans rien défaire.
- **Raccourci** : `s` par défaut (« Résumer »), réassignable comme les autres.

## Review Focus

- **L'admin retire l'autorisation des clés personnelles après que des utilisateurs en ont saisi** : leurs clés ne servent plus, `hasUserKey` passe à faux, et la remettre les rétablit. → test de la tâche 1.
- **Un fournisseur assigné (préféré, flux ou catégorie) est supprimé par l'admin** : le serveur saute l'étage, et le sélecteur l'affiche « Fournisseur supprimé » au lieu de retomber en silence sur « Par défaut ». → tests des tâches 6 et 7.
- **Résumé automatique sur un flux à extraction automatique** : il attend la fin de l'extraction et résume l'article complet, pas l'extrait RSS ; si l'extraction échoue, il résume l'extrait. → test de la tâche 9.
- **Résumé automatique hors ligne, IA inutilisable, ou article trop court** : aucune requête dans les deux premiers cas, aucune erreur affichée dans le troisième. → test de la tâche 9.
- **Un appareil plus ancien synchronise un objet `shortcuts` sans `summarize`** : le raccourci par défaut `s` reste en place. → test de la tâche 10.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `server/routes/ai.ts` | + `PUT /api/ai/keys/:providerId` ; clés personnelles ignorées si non permises ; `ownKey` sur un refus de clé |
| `server/ai/resolve.ts` | `Availability.own` |
| `server/ai/summarize.ts` | marque l'erreur finale `ownKey` |
| `server/ai/errors.ts` | `AiError.ownKey?` |
| `src/api/backend.ts` | `setAiUserKey()` |
| `src/lib/aiErrorKey.ts` | `ownKey` → `ai.errors.auth` |
| `src/stores/uiStore.ts` | quatre préférences synchronisées + `FeedSetting.aiProvider` ; raccourci `summarize` |
| `src/lib/aiRouting.ts` (nouveau) | préférences → champs de la requête de résumé |
| `src/stores/aiStore.ts` | `reset()` à la déconnexion |
| `src/components/Preferences/AiTab.tsx` | compose les blocs, rien d'autre |
| `src/components/Preferences/ai/shared.tsx` (nouveau) | `BlockTitle`, `inputClass`, `inputStyle`, `quietBtn` |
| `src/components/Preferences/ai/AdminProviders.tsx` (nouveau) | bloc « Fournisseurs » + `ModelList`, déplacés tels quels ; « Effacer la clé » |
| `src/components/Preferences/ai/SummariesBlock.tsx` (nouveau) | longueur (déplacée), préféré, repli, automatique, usage |
| `src/components/Preferences/ai/RoutingBlock.tsx` (nouveau) | « Par flux et catégorie » |
| `src/components/Preferences/ai/KeysBlock.tsx` (nouveau) | « Mes clés » |
| `src/components/ReadingPane/ReadingPane.tsx` | champs de routage dans la requête ; résumé automatique ; écoute du raccourci |
| `src/components/ReadingPane/AiSummary.tsx` | exporte `expandOnFirstSummary()` |
| `src/hooks/useKeyboardNav.ts`, `src/components/CommandPalette.tsx` | raccourci et entrée de palette |
| `src/locales/*.json` | chaînes nouvelles |
| `docs/FEATURES.md`, `SECURITY.md`, `docs/RELEASE-NEXT.md` | inventaire, sécurité, journal du cycle |

---

### Task 1: Clés personnelles côté serveur

**Files:**
- Modify: `server/routes/ai.ts`, `server/ai/resolve.ts`, `server/ai/summarize.ts`, `server/ai/errors.ts`, `src/lib/aiErrorKey.ts`, `src/api/backend.ts`
- Test: `server/test/ai.test.ts`, `server/ai/resolve.test.ts`, `server/ai/summarize.test.ts`, `src/lib/aiErrorKey.test.ts`
- Docs: `docs/FEATURES.md` (puce « Clés », tableau des routes), `SECURITY.md` (section « AI providers »)

**Interfaces:**
- Produces: `PUT /api/ai/keys/:providerId` body `{ key: string | null }` → `200 { ok: true, hasUserKey: boolean }` ; erreurs `404 { error: 'ai_disabled' }`, `403 { error: 'user_keys_disabled' }`, `404 { error: 'not_found' }`, `400 { error: 'invalid_key' }`.
- Produces: réponse d'échec de `POST /api/ai/summary` : `502 { error: 'ai_failed', kind, ownKey?: true }`.
- Produces (client): `setAiUserKey(providerId: number, key: string | null): Promise<{ ok: true; hasUserKey: boolean }>` dans `src/api/backend.ts`.
- Produces: `Availability` gagne `own: boolean` (vrai seulement pour une clé personnelle).

- [ ] **Step 1: Write the failing tests**

Dans `server/test/ai.test.ts`, un `describe('ai personal keys')` avec un fournisseur partagé créé par l'admin et l'IA activée :

```ts
it('refuses while user keys are not allowed, then stores, reports and clears a key', async () => {
  // ai_user_keys_allowed = false
  expect((await put(userToken, id, { key: 'mine' })).status).toBe(403);
  // admin : PUT /api/admin/ai/settings { userKeysAllowed: true }
  const ok = await put(userToken, id, { key: '  mine  ' });
  expect(ok.body).toEqual({ ok: true, hasUserKey: true });
  expect(JSON.stringify(ok.body)).not.toContain('mine');
  expect((await cfg(userToken)).providers.find((p) => p.id === id).hasUserKey).toBe(true);
  expect((await put(userToken, id, { key: null })).body).toEqual({ ok: true, hasUserKey: false });
  expect((await put(userToken, id, { key: '' })).body.hasUserKey).toBe(false);
});
it('validates the body and the provider', async () => {
  expect((await put(userToken, id, { key: 42 })).status).toBe(400);
  expect((await put(userToken, id, { key: 'x'.repeat(4097) })).status).toBe(400);
  expect((await put(userToken, 999999, { key: 'k' })).status).toBe(404);
});
it('ignores stored personal keys while the admin disallows them, and restores them after', async () => {
  // clé enregistrée, puis userKeysAllowed: false
  expect((await cfg(userToken)).providers.find((p) => p.id === id).hasUserKey).toBe(false);
  // le résumé part avec la clé admin partagée : en-tête Authorization du fetch stubé = 'Bearer <clé admin>'
  // userKeysAllowed: true → hasUserKey redevient vrai, le résumé part avec 'Bearer mine'
});
it('says ownKey when the refused key was the user\'s own', async () => {
  // fetch stubé en 401 ; réponse 502 { error: 'ai_failed', kind: 'auth', ownKey: true }
  // même chose avec la clé admin partagée : pas de champ ownKey
});
```

Dans `server/ai/resolve.test.ts` : `availableFor` renvoie `own: true` pour une clé personnelle, `false` pour une clé admin et pour un `openai` sans clé.
Dans `server/ai/summarize.test.ts` : un appel en échec `auth` avec un candidat `own: true` et `fallback: false` rejette une `AiError` dont `ownKey === true`.
Dans `src/lib/aiErrorKey.test.ts` :

```ts
expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth', ownKey: true }, false)).toBe('ai.errors.auth');
expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth' }, false)).toBe('ai.errors.authUser');
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/test/ai.test.ts server/ai/resolve.test.ts server/ai/summarize.test.ts src/lib/aiErrorKey.test.ts`
Expected: FAIL (route absente → 404 au lieu de 403 ; `own` et `ownKey` indéfinis).

- [ ] **Step 3: Implement**

- `errors.ts` : `AiError` gagne une propriété publique mutable `ownKey?: boolean`.
- `resolve.ts` : `own: true` sur la branche clé personnelle, `false` ailleurs.
- `summarize.ts` : avant de lever ou de retenir une erreur d'appel, `e.ownKey = cand.own`.
- `ai.ts` : dans `availability()`, la fonction `user` renvoie `null` quand `!userKeysAllowed()` ; `/config` répond `hasUserKey: userKeysAllowed() && hasUserKey(...)` ; la réponse 502 ajoute `ownKey: true` quand `err.ownKey`. Route `PUT /keys/:providerId` : `404 ai_disabled` si l'IA est éteinte, `403 user_keys_disabled` si non permis, `404 not_found` si `getProvider` est nul, `400 invalid_key` si `key` n'est ni chaîne ni `null` ou dépasse 4096 caractères une fois rognée ; chaîne vide ou `null` → `setUserKey(…, null)`.
- `aiErrorKey.ts` : `data.ownKey === true` avec `kind === 'auth'` → `'ai.errors.auth'` quel que soit le rôle. Type du paramètre `data` étendu de `ownKey?: boolean`.
- `backend.ts` : `setAiUserKey(providerId, key)` → `PUT /ai/keys/${providerId}`.

- [ ] **Step 4: Run the tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Docs, gates, guard, commit**

`docs/FEATURES.md` : la puce « Clés » ne dit plus « aucune route ni écran » pour les clés personnelles ; elle décrit la route, la règle « non permises = ignorées, pas effacées » et `ownKey`. Ligne `| PUT | /api/ai/keys/:providerId | Clé personnelle (enregistrer ou effacer) |` dans le tableau des routes. `SECURITY.md` : une phrase sur la clé personnelle (chiffrée, jamais renvoyée, ignorée quand l'admin ne la permet plus).

```bash
git add server src/lib/aiErrorKey.ts src/lib/aiErrorKey.test.ts src/api/backend.ts docs/FEATURES.md SECURITY.md
git commit -m "feat(ai): personal API keys route"
```

---

### Task 2: Préférences synchronisées

**Files:**
- Modify: `src/stores/uiStore.ts`
- Test: `src/stores/uiStore.test.ts`

**Interfaces:**
- Produces (state + setters de `useUiStore`) :
  - `aiPreferredProvider: number | null` / `setAiPreferredProvider(id: number | null)`
  - `aiFallback: boolean` (défaut `true`) / `setAiFallback(on: boolean)`
  - `aiAutoSummary: boolean` (défaut `false`) / `setAiAutoSummary(on: boolean)`
  - `aiCategoryProviders: Record<string, number>` (défaut `{}`) / `setAiCategoryProvider(name: string, id: number | null)` — `null` retire l'entrée
  - `FeedSetting.aiProvider?: number` / `setFeedAiProvider(feedId: string, id: number | null)` — par `withFeedOverride`, `null` → `''` (retrait)
- Produces: `normalizeAiProviderId(v: unknown): number | null` (entier > 0, sinon `null`) et `normalizeAiCategoryProviders(v: unknown): Record<string, number>` (objet ; garde les clés chaîne non vides dont la valeur passe `normalizeAiProviderId`), exportées.

- [ ] **Step 1: Write the failing tests**

```ts
it('AI routing prefs: defaults, persistence, sync and normalisation', () => {
  const s = useUiStore.getState();
  expect([s.aiPreferredProvider, s.aiFallback, s.aiAutoSummary, s.aiCategoryProviders]).toEqual([null, true, false, {}]);
  for (const k of ['aiPreferredProvider', 'aiFallback', 'aiAutoSummary', 'aiCategoryProviders']) expect(UI_SYNC_KEYS).toContain(k);
  s.setAiCategoryProvider('Tech', 3); s.setAiCategoryProvider('News', 4); s.setAiCategoryProvider('News', null);
  expect(useUiStore.getState().aiCategoryProviders).toEqual({ Tech: 3 });
  expect(JSON.parse(localStorage.getItem('frirss_aiCategoryProviders')!)).toEqual({ Tech: 3 });
  s.applyServerPrefs({ aiPreferredProvider: '7', aiFallback: 'no', aiAutoSummary: true, aiCategoryProviders: { A: 2, B: -1, '': 3, C: 'x' } });
  const n = useUiStore.getState();
  expect([n.aiPreferredProvider, n.aiFallback, n.aiAutoSummary, n.aiCategoryProviders]).toEqual([null, true, true, { A: 2 }]);
});
it('per-feed AI provider is set and cleared through feedSettings', () => {
  useUiStore.getState().setFeedAiProvider('feed/1', 5);
  expect(useUiStore.getState().feedSettings['feed/1'].aiProvider).toBe(5);
  useUiStore.getState().setFeedAiProvider('feed/1', null);
  expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
});
```

(`aiFallback: 'no'` venu d'un client étranger laisse la valeur courante, comme `autoExtractDefault`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/stores/uiStore.test.ts` — Expected: FAIL (propriétés absentes).

- [ ] **Step 3: Implement** sur le modèle exact de `aiSummaryRatio` : `loadJson` + normaliseur au chargement, setter qui écrit `frirss_<clé>`, entrée dans `jsonKeys` de `applyServerPrefs` avec son normaliseur (`aiFallback` / `aiAutoSummary` : booléen sinon valeur courante), entrée dans `UI_SYNC_KEYS`.

- [ ] **Step 4: Run to verify it passes** — même commande, PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/uiStore.ts src/stores/uiStore.test.ts
git commit -m "feat(ai): synced provider, fallback and auto-summary preferences"
```

---

### Task 3: Routage de la requête de résumé

**Files:**
- Create: `src/lib/aiRouting.ts`, `src/lib/aiRouting.test.ts`
- Modify: `src/components/ReadingPane/ReadingPane.tsx` (`handleSummarize`), `src/api/backend.ts` (type du corps de `requestAiSummary`)
- Test: `src/components/ReadingPane/ReadingPane.ai.test.tsx`
- Docs: `docs/FEATURES.md` (puce « Résolution » : les étages ont maintenant un écran et partent avec chaque requête)

**Interfaces:**
- Consumes: préférences de la tâche 2 ; `Subscription.categories` (`src/types`).
- Produces: `aiRouting(sourceId: string | undefined, subscriptions: Subscription[], prefs: { feedSettings: Record<string, FeedSetting>; aiCategoryProviders: Record<string, number>; aiPreferredProvider: number | null; aiFallback: boolean }): { feedProvider?: number; categoryProvider?: number; preferredProvider?: number; fallback: boolean }`.
- `requestAiSummary` accepte `feedProvider?`, `categoryProvider?`, `preferredProvider?`, `fallback?` (le serveur les lit déjà).

- [ ] **Step 1: Write the failing tests** (`aiRouting.test.ts`)

```ts
const subs = [{ id: 'feed/1', title: 'A', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }, { id: 'user/-/label/Dev', label: 'Dev' }] }];
it('sends each stage that is set, and only those', () => {
  expect(aiRouting('feed/1', subs, { feedSettings: {}, aiCategoryProviders: {}, aiPreferredProvider: null, aiFallback: true })).toEqual({ fallback: true });
  expect(aiRouting('feed/1', subs, { feedSettings: { 'feed/1': { aiProvider: 4 } }, aiCategoryProviders: { Dev: 2 }, aiPreferredProvider: 9, aiFallback: false }))
    .toEqual({ feedProvider: 4, categoryProvider: 2, preferredProvider: 9, fallback: false });
});
it('takes the first of the feed\'s categories that carries a provider', () => {
  expect(aiRouting('feed/1', subs, { feedSettings: {}, aiCategoryProviders: { Dev: 2, Tech: 5 }, aiPreferredProvider: null, aiFallback: true }).categoryProvider).toBe(5);
});
it('an unknown feed sends no feed or category stage', () => {
  expect(aiRouting('feed/404', subs, { feedSettings: {}, aiCategoryProviders: { Tech: 5 }, aiPreferredProvider: null, aiFallback: true })).toEqual({ fallback: true });
});
```

Dans `ReadingPane.ai.test.tsx` :

```ts
it('sends the routing stages and the fallback choice with the request', () => {
  useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }] }] } as never);
  useUiStore.setState({ feedSettings: {}, aiCategoryProviders: { Tech: 1 }, aiPreferredProvider: 1, aiFallback: false });
  // clic sur « Résumer »
  expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ categoryProvider: 1, preferredProvider: 1, fallback: false }));
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/aiRouting.test.ts src/components/ReadingPane/ReadingPane.ai.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `aiRouting` ; `handleSummarize` étale `aiRouting(selectedArticle.sourceId, subscriptions, ui)` dans la requête, lu par `useUiStore.getState()` et `useFeedStore.getState()` au moment du clic.
- [ ] **Step 4: Run to verify pass** — même commande, PASS.
- [ ] **Step 5: Commit** — `feat(ai): send the user's routing choices with each summary request`.

---

### Task 4: Découper la section « IA » (aucun changement de comportement)

**Files:**
- Create: `src/components/Preferences/ai/shared.tsx`, `src/components/Preferences/ai/AdminProviders.tsx`, `src/components/Preferences/ai/SummariesBlock.tsx`
- Modify: `src/components/Preferences/AiTab.tsx`

**Interfaces:**
- Produces: `shared.tsx` exporte `BlockTitle({ children }: { children: string })`, `inputClass`, `inputStyle`, `quietBtn`.
- Produces: `AdminProviders({ active }: { active: boolean })` (défaut), avec `ModelList` dans le même fichier.
- Produces: `SummariesBlock({ showIntro }: { showIntro: boolean })` (défaut).
- `AiTab` ne fait plus que composer : `SummariesBlock`, puis (tâches 7 et 8) `RoutingBlock` et `KeysBlock`, puis `AdminProviders` pour l'admin.

- [ ] **Step 1: Déplacer le code tel quel** — couper / coller, imports ajustés ; aucun texte, aucune classe, aucun commentaire changé.
- [ ] **Step 2: Vérifier** — `npx vitest run src/components/Preferences/` : PASS sans toucher à un seul test (`AiTab.test.tsx`, `Preferences.ai.test.tsx`, `settingsCoverage.test.ts` qui parcourt les sous-dossiers).
- [ ] **Step 3: Commit** — `refactor(ai): one file per block in the AI preferences`.

---

### Task 5: Effacer la clé d'un fournisseur (admin)

**Files:**
- Modify: `src/components/Preferences/ai/AdminProviders.tsx`, `src/locales/*.json`
- Test: `src/components/Preferences/AiTab.test.tsx`
- Docs: `docs/FEATURES.md` (retirer « Aucun écran ne permet encore d'effacer une clé admin »)

**Interfaces:**
- Consumes: `updateAiProvider(id, { adminKey: null })` (existe ; l'API efface sur `null`).

Chaînes (fr) : `ai.admin.clearKey` « Effacer la clé » ; `ai.admin.clearKeyTitle` « Effacer la clé de {{name}} ? » ; `ai.admin.clearKeyWarning` « Les résumés qui passent par cette clé s'arrêteront jusqu'à ce qu'une nouvelle soit saisie. »

- [ ] **Step 1: Write the failing test**

```ts
it('clears a saved admin key after confirmation, never without', async () => {
  // éditeur ouvert sur un fournisseur hasAdminKey: true
  fireEvent.click(getByRole('button', { name: 'ai.admin.clearKey' }));
  expect(updateAiProvider).not.toHaveBeenCalled();
  fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'ai.admin.clearKey' }));
  await waitFor(() => expect(updateAiProvider).toHaveBeenCalledWith(7, { adminKey: null }));
  // la ligne ne montre plus « ai.admin.keySet » ; le bouton disparaît
});
it('offers no clear button when there is no saved key', /* hasAdminKey: false */);
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Preferences/AiTab.test.tsx`.
- [ ] **Step 3: Implement** — bouton discret sous le champ clé, visible seulement si le fournisseur édité a une clé ; `ConfirmDialog` (titre, `warning`, `confirmLabel = ai.admin.clearKey`) ; au succès, la liste locale reçoit le fournisseur renvoyé et `useAiStore.getState().load()` est rappelé. Chaînes dans les dix locales.
- [ ] **Step 4: Run to verify pass**, parité des traductions.
- [ ] **Step 5: Commit** — `feat(ai): let the admin clear a provider key`.

---

### Task 6: Bloc « Résumés » — préféré, repli, automatique, usage

**Files:**
- Modify: `src/components/Preferences/ai/SummariesBlock.tsx`, `src/locales/*.json`
- Test: `src/components/Preferences/AiTab.test.tsx`
- Docs: `docs/FEATURES.md` (« Interface — Préférences »)

**Interfaces:**
- Consumes: tâche 2 ; `useAiStore` (`config.providers`, `config.defaultProvider`, `dailyCap`, `usageToday`) ; `ConfirmDialog`.
- Produces: `ProviderOptions({ providers, value, defaultLabel }: { providers: AiProviderView[]; value: number | null; defaultLabel: string })`, exporté de `ai/shared.tsx` : l'option vide (`defaultLabel`), un fournisseur par option (désactivée avec « {{name}} (clé requise) » s'il n'est pas `available`), et « Fournisseur supprimé » si `value` n'est plus dans `providers`. Réutilisé par la tâche 7.

Ordre dans le bloc : Longueur (existe), Fournisseur préféré, Repli automatique, Résumé automatique à l'ouverture, puis la ligne d'usage.

Chaînes (fr) :
- `ai.user.preferred` « Fournisseur préféré »
- `ai.user.preferredDefault` « Par défaut ({{name}}) » ; `ai.user.preferredAuto` « Automatique » (aucun défaut admin)
- `ai.user.keyRequired` « {{name}} (clé requise) »
- `ai.user.removedProvider` « Fournisseur supprimé »
- `ai.user.fallback` « Repli automatique » ; `ai.user.fallbackHint` — texte des Global Constraints
- `ai.user.auto` « Résumé automatique à l'ouverture » ; `ai.user.autoHint` « Chaque article ouvert est résumé sans clic. »
- `ai.user.autoConfirmTitle` « Activer le résumé automatique ? » ; `ai.user.autoConfirmMessage` — texte des Global Constraints ; `ai.user.autoConfirm` « Activer »
- `ai.user.usage` « Résumés payés par l'instance aujourd'hui : {{used}} sur {{cap}} » (variables `used` et `cap`, pas `count` : pas de pluriel)

- [ ] **Step 1: Write the failing tests**

```ts
it('lists available providers, greys the ones without a key, and stores the choice', async () => {
  // config: [{id:1,name:'Ollama',available:true},{id:2,name:'Claude',available:false}], defaultProvider: 1
  const select = getByLabelText('ai.user.preferred') as HTMLSelectElement;
  expect([...select.options].map((o) => [o.value, o.textContent, o.disabled])).toEqual([
    ['', 'ai.user.preferredDefault', false], ['1', 'Ollama', false], ['2', 'ai.user.keyRequired', true],
  ]);
  fireEvent.change(select, { target: { value: '1' } });
  expect(useUiStore.getState().aiPreferredProvider).toBe(1);
});
it('shows a deleted preferred provider as such instead of falling back silently', () => {
  useUiStore.setState({ aiPreferredProvider: 42 });
  const select = getByLabelText('ai.user.preferred') as HTMLSelectElement;
  expect(select.value).toBe('42');
  expect(select.selectedOptions[0].textContent).toBe('ai.user.removedProvider');
});
it('fallback is a switch, on by default', /* rôle switch nommé ai.user.fallback, aria-checked true, clic → aiFallback false */);
it('auto-summary asks for confirmation before turning on, and turns off without asking', async () => {
  fireEvent.click(getByRole('switch', { name: 'ai.user.auto' }));
  expect(useUiStore.getState().aiAutoSummary).toBe(false);
  const dialog = getByRole('dialog');
  expect(within(dialog).getByText('ai.user.autoConfirmMessage')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'ai.user.autoConfirm' }));
  expect(useUiStore.getState().aiAutoSummary).toBe(true);
  fireEvent.click(getByRole('switch', { name: 'ai.user.auto' }));
  expect(useUiStore.getState().aiAutoSummary).toBe(false);
  expect(queryByRole('dialog')).toBeNull();
});
it('shows today\'s usage only when a cap applies to an instance-paid provider', () => {
  // dailyCap 50, usageToday 3, un fournisseur available + hasAdminKey + shared + !hasUserKey, utilisateur non admin → texte ai.user.usage
  // admin, ou dailyCap 0, ou aucun fournisseur payé par l'instance → pas de ligne
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Preferences/AiTab.test.tsx`.
- [ ] **Step 3: Implement** — `ProviderOptions` dans `shared.tsx`, puis `<select>` natif lié par `htmlFor` ; `ToggleSwitch` existant pour les deux interrupteurs ; `ConfirmDialog` pour l'activation seulement ; la ligne d'usage suit la condition du test. Chaînes dans les dix locales.
- [ ] **Step 4: Run to verify pass**, parité.
- [ ] **Step 5: Commit** — `feat(ai): preferred provider, fallback and auto-summary settings`.

---

### Task 7: Bloc « Par flux et catégorie »

**Files:**
- Create: `src/components/Preferences/ai/RoutingBlock.tsx`
- Modify: `src/components/Preferences/AiTab.tsx`, `src/locales/*.json`
- Test: `src/components/Preferences/AiTab.test.tsx`
- Docs: `docs/FEATURES.md` (nouvelle puce ; limite connue : catégorie renommée = réglage perdu)

**Interfaces:**
- Consumes: tâche 2 (`setAiCategoryProvider`, `setFeedAiProvider`) ; `ProviderOptions` (tâche 6) ; `groupFeedsByCategory(subscriptions)` de `src/lib/feedCategories.ts` ; `useFeedStore((s) => s.subscriptions)`.

Ce que l'on voit : un titre, une aide, puis une ligne par catégorie (ordre de `groupFeedsByCategory`) — un bouton de dépli (`aria-expanded`) portant le nom et, s'il y en a, « N flux réglés », et à droite le sélecteur de la catégorie. Dépliée, la catégorie montre ses flux, chacun avec son sélecteur. Les flux sans catégorie forment un dernier groupe « Sans catégorie », sans sélecteur de groupe. Tout est replié à l'ouverture. Options d'un sélecteur : « Par défaut » (valeur vide), puis chaque fournisseur (ceux sans clé accessible désactivés, comme à la tâche 6), plus « Fournisseur supprimé » si la valeur enregistrée n'existe plus. À 320 px, le nom passe à la ligne et le sélecteur garde au moins 8 rem.

Chaînes (fr) :
- `ai.routing.title` « Par flux et catégorie »
- `ai.routing.hint` « Un fournisseur choisi ici passe avant votre fournisseur préféré, et celui d'un flux avant celui de sa catégorie. »
- `ai.routing.default` « Par défaut »
- `ai.routing.uncategorised` « Sans catégorie »
- `ai.routing.overrides_one` « {{count}} flux réglé » / `_other` « {{count}} flux réglés » (+ `_few`/`_many` pl, uk)
- `ai.routing.categorySelect` « Fournisseur pour la catégorie {{name}} » ; `ai.routing.feedSelect` « Fournisseur pour {{name}} » (libellés accessibles des sélecteurs)

- [ ] **Step 1: Write the failing tests**

```ts
it('lists categories collapsed, with the number of tuned feeds, and sets a category provider', () => {
  // subscriptions : feed/1 et feed/2 dans Tech, feed/3 sans catégorie ; feedSettings { 'feed/2': { aiProvider: 1 } }
  const toggle = getByRole('button', { name: /Tech/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(getByText('ai.routing.overrides')).toBeTruthy();
  fireEvent.change(getByLabelText('ai.routing.categorySelect'), { target: { value: '1' } });
  expect(useUiStore.getState().aiCategoryProviders).toEqual({ Tech: 1 });
});
it('a feed provider is set and set back to default from the expanded category', () => {
  fireEvent.click(getByRole('button', { name: /Tech/ }));
  const feedSelects = getAllByLabelText('ai.routing.feedSelect');
  fireEvent.change(feedSelects[0], { target: { value: '1' } });
  expect(useUiStore.getState().feedSettings['feed/1'].aiProvider).toBe(1);
  fireEvent.change(feedSelects[0], { target: { value: '' } });
  expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
});
it('keeps feeds without a category reachable, in their own group without a group selector', /* groupe ai.routing.uncategorised ; un seul sélecteur après dépli, celui de feed/3 */);
it('shows a deleted provider as such', /* aiCategoryProviders { Tech: 42 } → le sélecteur de Tech vaut '42' et son option choisie dit 'ai.user.removedProvider' */);
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Preferences/AiTab.test.tsx`.
- [ ] **Step 3: Implement** `RoutingBlock` (défaut, sans props) et l'insérer dans `AiTab` après `SummariesBlock`, pour tous.
- [ ] **Step 4: Run to verify pass**, parité.
- [ ] **Step 5: Commit** — `feat(ai): per-feed and per-category provider overview`.

---

### Task 8: Bloc « Mes clés »

**Files:**
- Create: `src/components/Preferences/ai/KeysBlock.tsx`
- Modify: `src/components/Preferences/AiTab.tsx`, `src/locales/*.json`
- Test: `src/components/Preferences/AiTab.test.tsx`
- Docs: `docs/FEATURES.md` (l'interrupteur admin « Les utilisateurs peuvent saisir leur propre clé » n'est plus inerte)

**Interfaces:**
- Consumes: `setAiUserKey` (tâche 1) ; `useAiStore` (`config.userKeysAllowed`, `providers[].hasUserKey`, `load()`).

Rendu seulement si `config.userKeysAllowed`. Une ligne par fournisseur : nom, état (« clé enregistrée » en accent / « aucune clé »), champ `type="password"` `autoComplete="new-password"` vide, « Enregistrer » (désactivé tant que le champ est vide), « Effacer » si une clé existe. Après succès : champ vidé, `load()` rappelé, message bref en `role="status"`. Échec : `role="alert"`.

Chaînes (fr) : `ai.keys.title` « Mes clés » ; `ai.keys.hint` « Votre clé ne sert qu'à vos résumés et passe avant celle de l'administrateur. Elle n'est jamais réaffichée. » ; `ai.keys.set` « clé enregistrée » ; `ai.keys.none` « aucune clé » ; `ai.keys.field` « Clé pour {{name}} » ; `ai.keys.save` « Enregistrer » ; `ai.keys.clear` « Effacer » ; `ai.keys.saved` « Clé enregistrée. » ; `ai.keys.cleared` « Clé effacée. » ; `ai.keys.error` « Enregistrement impossible. Réessayez. »

- [ ] **Step 1: Write the failing tests**

```ts
it('is absent while personal keys are not allowed', /* userKeysAllowed false → queryByText('ai.keys.title') null */);
it('saves a typed key, empties the field and reloads the config', async () => {
  fireEvent.change(getByLabelText('ai.keys.field'), { target: { value: 'sk-mine' } });
  fireEvent.click(getByRole('button', { name: 'ai.keys.save' }));
  await waitFor(() => expect(setAiUserKey).toHaveBeenCalledWith(1, 'sk-mine'));
  expect((getByLabelText('ai.keys.field') as HTMLInputElement).value).toBe('');
  expect(getAiConfig).toHaveBeenCalled();
});
it('clears a saved key', /* hasUserKey true → bouton ai.keys.clear → setAiUserKey(1, null) */);
it('says so when saving fails', /* setAiUserKey rejette → texte ai.keys.error dans role=alert */);
```

- [ ] **Step 2–4:** échec, implémentation (insérer après `RoutingBlock`), succès, parité.
- [ ] **Step 5: Commit** — `feat(ai): personal keys in the AI preferences`.

---

### Task 9: Résumé automatique à l'ouverture

**Files:**
- Modify: `src/components/ReadingPane/ReadingPane.tsx`
- Test: `src/components/ReadingPane/ReadingPane.ai.test.tsx`
- Docs: `docs/FEATURES.md` (nouvelle puce ; `docs/RELEASE-NEXT.md` : l'entrée « Résumés par IA » mentionne le résumé automatique et les réglages de chacun)

**Interfaces:**
- Consumes: `aiAutoSummary` (tâche 2) ; `handleSummarize` ; état d'extraction existant (`extracting`, `extractedContent`, `extractError`, `effectiveAutoExtract`).
- `handleSummarize(providerId?: number, opts?: { auto?: boolean })` : en mode `auto`, une réponse `400 article_too_short` remet le statut à `idle` sans message.

Condition de déclenchement, une fois par article (`useRef` de l'id déjà traité) : `aiAutoSummary && aiUsable && online && aiStatus === 'idle'` et, si l'extraction automatique s'applique à ce flux, extraction terminée (`!extracting && (extractedContent || extractError)`). Le panneau replié reste replié (règle existante). La préparation hors-ligne n'ouvre aucun article dans le volet : elle ne peut pas déclencher de résumé, aucune garde de plus n'est nécessaire (spec §8).

- [ ] **Step 1: Write the failing tests**

```ts
it('summarises on open when auto-summary is on', async () => {
  useUiStore.setState({ aiAutoSummary: true });
  vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
  render(<ReadingPane />);
  await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
});
it('does nothing on open when auto-summary is off, offline, or no provider is usable', /* trois cas, requestAiSummary jamais appelé */);
it('waits for the auto-extraction and summarises the full article', async () => {
  // feedSettings { 'feed/1': { autoExtract: true } } ; extraction mockée qui résout '<p>' + 'complet '.repeat(80) + '</p>'
  await waitFor(() => expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('complet') })));
  expect(requestAiSummary).toHaveBeenCalledTimes(1);
});
it('falls back to the feed text when the extraction fails', /* extraction rejette → html contient 'mot' */);
it('stays quiet when the article is too short', async () => {
  vi.mocked(requestAiSummary).mockRejectedValue(httpError(400, { error: 'article_too_short' }));
  // aucun role=alert ; le statut affiché reste ai.status.none
});
it('runs once per article, not again on re-render, and again for the next article', /* changer d'article → 2 appels au total */);
```

Extraction dans les tests : le cas réussi sème le cache avant le rendu avec `putExtract('a1', { content: … })` de `src/lib/extractCache`, comme `ReadingPane.body.test.tsx` ; le cas raté simule `getExtract` de ce même module pour qu'il rejette, sans rien en mémoire.

- [ ] **Step 2–4:** échec, implémentation, succès.
- [ ] **Step 5: Commit** — `feat(ai): summarise on open when the user asks for it`.

---

### Task 10: Raccourci clavier et palette

**Files:**
- Modify: `src/stores/uiStore.ts` (`defaultShortcuts`, `shortcutActions`, `shortcutGroups.reading`), `src/hooks/useKeyboardNav.ts`, `src/components/CommandPalette.tsx`, `src/components/ReadingPane/ReadingPane.tsx`, `src/components/ReadingPane/AiSummary.tsx`, `src/locales/*.json`
- Test: `src/stores/uiStore.test.ts`, `src/components/ReadingPane/ReadingPane.ai.test.tsx`, `src/lib/commandPalette.test.ts` si la liste y est testée
- Docs: `docs/FEATURES.md` (raccourcis : `s` ; palette)

**Interfaces:**
- Produces: action `summarize`, défaut `'s'` ; événement de fenêtre `'frirss:ai-summarize'` (même mécanisme que `'frirss:open-search'`).
- Produces: `expandOnFirstSummary(): void` exporté de `AiSummary.tsx` — la logique « une fois par appareil, déplier si replié » sortie de `summarize()`, appelée aussi par l'écouteur du raccourci.

Chaîne (fr) : `preferences.shortcuts.summarize` « Résumer l'article (IA) » ; la palette réutilise cette clé.

- [ ] **Step 1: Write the failing tests**

```ts
it('summarize defaults to s and survives an older synced shortcuts object', () => {
  expect(useUiStore.getState().shortcuts.summarize).toBe('s');
  useUiStore.getState().applyServerPrefs({ shortcuts: { nextArticle: 'j' } });
  expect(useUiStore.getState().shortcuts).toMatchObject({ nextArticle: 'j', summarize: 's' });
});
it('the summarize event triggers a summary of the open article', async () => {
  render(<ReadingPane />);
  act(() => { window.dispatchEvent(new CustomEvent('frirss:ai-summarize')); });
  await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
});
it('the event does nothing when AI is unusable or offline', /* requestAiSummary jamais appelé */);
```

Palette : l'entrée `action:aiSummarize` n'est proposée que si un article est ouvert et que l'IA est utilisable (assertion dans le test de la palette s'il existe, sinon dans un test de rendu de `CommandPalette`).

- [ ] **Step 2–4:** échec ; implémentation (aujourd'hui `loadJson('frirss_shortcuts', defaultShortcuts)` ne fusionne pas : un objet enregistré sans `summarize` le perdrait ; fusion `{ ...defaultShortcuts, ...stored }` au chargement **et** dans `applyServerPrefs` ; `useKeyboardNav` n'appelle `preventDefault` et ne diffuse l'événement que si `aiEnabled` et un article est sélectionné ; `ReadingPane` écoute l'événement et appelle `expandOnFirstSummary()` puis `handleSummarize()` sous les mêmes gardes que le bouton) ; succès ; parité.
- [ ] **Step 5: Commit** — `feat(ai): keyboard shortcut and command palette entry for summaries`.

---

### Task 11: Oublier l'IA à la déconnexion

**Files:**
- Modify: `src/stores/aiStore.ts`
- Test: `src/stores/aiStore.test.ts`

**Interfaces:**
- Consumes: `useAuthStore` (`backendToken`).
- `aiStore` s'abonne à `useAuthStore` : quand `backendToken` devient nul, `reset()`. Pas d'import de `aiStore` dans `authStore` (cycle via `api/backend`).

- [ ] **Step 1: Write the failing test**

```ts
it('drops the AI config when the user logs out', () => {
  useAuthStore.setState({ backendToken: 't' });
  useAiStore.setState({ config: ON });
  useAuthStore.getState().logoutBackend();
  expect(useAiStore.getState().config).toBeNull();
});
```

- [ ] **Step 2–4:** échec, implémentation, succès.
- [ ] **Step 5: Commit** — `fix(ai): forget the AI config on logout`.

---

### Task 12: Vérification de bout en bout

- [ ] **Step 1:** gates complètes, garde-fou, parité, puis balayage des attributs visibles des fichiers touchés (`title`, `aria-label`, `placeholder`, texte JSX littéral) : aucune chaîne hors i18next.
- [ ] **Step 2:** image de branche (`gh workflow run publish.yml --ref ai-summaries`), image tirée sur le serveur de test ; le redéploiement est celui du propriétaire.
- [ ] **Step 3:** sur l'instance de test, avec Oya au bureau et l'émulateur Android à **320 px** : section « IA » complète (préféré, repli, automatique et sa confirmation, « Par flux et catégorie » déplié, « Mes clés » avec l'autorisation admin activée), mesures `getBoundingClientRect()` sans débordement ; un résumé automatique sur un flux à extraction automatique ; le raccourci `s`. Ollama seulement pour les appels : rien de payant sans l'accord du propriétaire.
- [ ] **Step 4:** revue de toute la branche depuis le début du plan par un relecteur neuf ; corrections ; `docs/RELEASE-NEXT.md` relu contre `git log`.
