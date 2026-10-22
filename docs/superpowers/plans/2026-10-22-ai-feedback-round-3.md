# Retours IA, troisième tour (2026-10-22) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** trois retouches après le second retest du propriétaire : la barre d'outils ne doit plus déborder quand « Résumer » s'y ajoute, le panneau « Résumé IA » vide doit être petit sur smartphone, et le bloc admin « Fournisseurs » doit être joli et pratique.

**Architecture :** CSS de la barre d'outils (requête de conteneur conditionnée par une classe), le composant `AiSummary` (état vide), et une réécriture de `Preferences/ai/AdminProviders.tsx` (liste des fournisseurs, menu d'actions par portail, éditeur en deux colonnes).

**Tech Stack :** TypeScript strict, React 18, Tailwind + variables CSS, requêtes de conteneur, vitest.

**Spec :** `docs/superpowers/specs/2026-10-15-ai-summaries-design.md` (§10, §11) ; les décisions ci-dessous priment.

## Décisions du propriétaire (2026-10-22, second retest)

1. Panneau désactivé → une barre de défilement apparaît dans la barre d'outils (capture 1, fenêtre ~1137 px) : à corriger. La pastille « Panneau » n'est pas parlante : **« Panneau IA »**, avec une infobulle.
3. Le bloc « Fournisseurs » de l'admin « n'est pas très joli, ni pratique. Fais mieux ! »
9. Le panneau « Résumé IA » vide est trop gros sur smartphone et en PWA ; « Pas encore résumé » n'apporte rien : **une seule ligne compacte**. En bureau « ça passe », mais la même ligne compacte y est bienvenue.
Points 2, 4 à 8 : « parfait ».

## Global Constraints

- Chaînes dans **les 10 locales**, parité vérifiée. Trois formats, 320 px de référence, cibles tactiles 44 px, rien qui n'existe qu'au survol (un menu par portail sous `<body>` pour toute surface flottante — `Popover` / `BottomSheet` existants).
- `docs/FEATURES.md` relu et corrigé, `docs/RELEASE-NEXT.md` à l'état final. Gates + garde-fou avant chaque commit ; commits conventionnels, sans trailer ni mention d'assistant.

## Review Focus

1. Barre d'outils entre 1000 et 1100 px de volet avec « Résumer » présent : aucun défilement horizontal (tâche 1, mesure au rendu).
2. Panneau vide au doigt : hauteur ≤ 52 px, bouton « Résumer » 44 px (tâche 2, mesure).
3. Menu d'actions d'un fournisseur au doigt : feuille du bas, fermeture, focus rendu (tâche 3).
4. Supprimer le fournisseur par défaut : le badge disparaît, `defaultProvider` repasse à `null` (tâche 3).
5. Éditeur à 320 px : une colonne, aucun débordement (tâche 3).

---

### Task 1 : barre d'outils sans débordement, pastille « Panneau IA »

**Files:**
- Modify: `src/styles/index.css` (requêtes de conteneur `reading-toolbar`), `src/components/ReadingPane/ReadingPane.tsx` (classe sur `.reading-pane`), `src/locales/*.json` (`ai.routing.panel` → « Panneau IA », `ai.routing.panelTitle` nouvelle), `src/components/Preferences/ai/RoutingBlock.tsx` (`title` sur les pastilles), `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`
- Test: `src/components/ReadingPane/ReadingPane.ai.test.tsx`, `src/components/Preferences/AiTab.test.tsx`

**Interfaces:**
- Produces: `.reading-pane.has-summarize` posé quand le bouton « Résumer » de la barre est rendu (`showSummarizeBarBtn`). CSS : la règle qui replie les libellés (`@container reading-toolbar (max-width: 1000px)`) gagne une jumelle **`@container reading-toolbar (max-width: 1100px) { .has-summarize .toolbar-label { … même repli … } }`** — la barre a un bouton de plus, le seuil monte d'autant (mesure du commentaire existant : ~5 % de marge ; la marge compte le bouton ajouté, ~90 px). Le commentaire du CSS est mis à jour.
- Pastilles : libellé « Panneau IA » ; chaque pastille porte `title` = explication courte (`ai.routing.summaryTitle` « Résumer chaque article à l'ouverture », `ai.routing.translateTitle` « Traduire chaque article à l'ouverture », `ai.routing.panelTitle` « Garder le panneau Résumé IA affiché même sans résumé ») — une infobulle n'est qu'un complément, la légende reste.

- [ ] **Step 1 : tests rouges** — `ReadingPane.ai.test.tsx` : « la classe has-summarize suit le bouton Résumer de la barre » ; `AiTab.test.tsx` : « les pastilles portent un title explicatif ».
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter** (locales : « Panneau IA » dans les 10, les trois titres).
- [ ] **Step 4 : vert** ; parité ; `npm run build`.
- [ ] **Step 5 : docs + commit** — `fix(ai): toolbar labels fold earlier with the Summarise button, "AI panel" pill with tooltips`.

---

### Task 2 : panneau « Résumé IA » vide sur une seule ligne

**Files:**
- Modify: `src/components/ReadingPane/AiSummary.tsx`, `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`
- Test: `src/components/ReadingPane/AiSummary.test.tsx`

**Interfaces:**
- Produces: quand `empty` : **pas de ligne de statut** (« Pas encore résumé » n'est rendu que pendant une demande ou avec un résumé) ; l'en-tête devient une ligne : étincelle, « Résumé IA » (13 px, semibold), et à droite « Résumer » ; paddings réduits (`py-1` au lieu de `py-2`, bouton `h-8` à la souris, `min-h-[44px]` au doigt mais le conteneur `py-0.5`) : hauteur totale ≈ 40 px bureau, ≤ 52 px au doigt. Le texte « Pas encore résumé » reste utilisé quand le panneau est replié avec une demande en cours (cas existant) — relire le commentaire de tête.

- [ ] **Step 1 : tests rouges** — « vide : aucun statut, titre et bouton seulement » ; « en cours : le statut dit Résumé en cours… » (inchangé).
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vert.**
- [ ] **Step 5 : docs + commit** — `fix(ai): an empty summary panel is a single compact line`.

---

### Task 3 : bloc « Fournisseurs » joli et pratique

**Files:**
- Modify: `src/components/Preferences/ai/AdminProviders.tsx` (réécriture de la liste et de l'éditeur ; la logique — `saveProvider`, `remove`, `clearKey`, `move`, `test`, `fetchModels`, `ModelList` — est conservée), `src/components/Preferences/ai/shared.tsx` si un `TypeTag` partagé a sa place, `src/locales/*.json`, `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`
- Test: `src/components/Preferences/AiTab.test.tsx`, `Preferences.ai.test.tsx`

**Design (tranché ici) :**

```
Fournisseurs                                              [Activer l'IA  ●]

┌──────────────────────────────────────────────────────────────────────┐
│ ● Ollama (NAS)  ·par défaut·        Compatible OpenAI                 │
│   qwen2.5:7b                        [Tester] [Modifier]        [ ⋯ ] │
├──────────────────────────────────────────────────────────────────────┤
│ ● Claude                            Anthropic                        │
│   claude-haiku-5-5 · clé enregistrée[Tester] [Modifier]        [ ⋯ ] │
├──────────────────────────────────────────────────────────────────────┤
│ ○ ChatGPT                           Compatible OpenAI                │
│   gpt-6-sol · clé enregistrée       [Tester] [Modifier]        [ ⋯ ] │
└──────────────────────────────────────────────────────────────────────┘
[+ Ajouter un fournisseur]
```

- **Une liste bordée, une ligne par fournisseur** (séparateurs `--panel-border`, pas une carte par ligne). Ligne 1 : nom en `font-semibold` (`truncate`, `title`), badge discret « par défaut » (`text-[11px]`, fond `--accent-glow`, texte `--accent`) quand c'est le défaut ; à droite un **tag de type** court (`TypeTag` : « Compatible OpenAI » / « Anthropic », `text-[11px]`, contour `--panel-border`). Ligne 2 : modèle, puis « · clé enregistrée » en `--accent` si `hasAdminKey` ; à droite **« Tester »** et **« Modifier »** (`quietBtn`) et un bouton **« ⋯ »** (`aria-label` « Plus d'actions — {name} », `aria-haspopup`) qui ouvre un menu par portail (`Popover` du volet de lecture ou équivalent des préférences ; feuille du bas au doigt) : **Monter**, **Descendre**, **Définir par défaut** (coché / désactivé si déjà le défaut), **Supprimer** (en `--danger`, ouvre la confirmation existante). Le `<select>` « Fournisseur par défaut » **disparaît** (le badge et le menu le remplacent) ; `ai.admin.defaultProvider` sert d'intitulé au menu (« Définir par défaut » = nouvelle clé `ai.admin.setDefault`, `ai.admin.more` = « Plus d'actions »). Le résultat d'un test s'affiche sous la ligne (inchangé), avec une petite pastille ● verte/rouge devant le texte.
- **Au doigt / étroit (< 640 px)** : ligne 1 nom + tag, ligne 2 modèle + clé, ligne 3 les trois boutons alignés à droite, 44 px.
- **Éditeur** : sous la liste, cadre `--panel-border`, titre « Nouveau fournisseur » / « Modifier {name} » (`ai.admin.newTitle`, `ai.admin.editTitle`), champs en **deux colonnes à partir de 640 px** (Nom | Type ; URL de base | Modèle + « Lister les modèles ») et une colonne en dessous ; clé sur sa ligne avec « Effacer la clé » à droite si elle existe ; « Partager cette clé avec les utilisateurs » devient une ligne `ToggleSwitch` (comme les autres réglages) ; en bas, « Enregistrer » (accent) puis « Fermer », statut « Enregistré » à côté.
- **Réglages du bloc** (« Les utilisateurs peuvent saisir leur propre clé », « Plafond quotidien ») : inchangés, sous l'éditeur / le bouton « Ajouter ».
- Rien au survol seulement ; noms accessibles conservés (`Tester — X`, `Modifier — X`, `Supprimer — X`, `Monter`, `Descendre`).

- [ ] **Step 1 : tests rouges** (`AiTab.test.tsx`) — « une ligne par fournisseur avec Tester, Modifier et Plus d'actions » ; « le menu propose Monter, Descendre, Définir par défaut, Supprimer » ; « Définir par défaut enregistre `defaultProvider` et pose le badge » ; « le select Fournisseur par défaut n'existe plus » ; « Supprimer passe par la confirmation » ; adapter les tests existants (ordre, clé, test de connexion).
- [ ] **Step 2 : vérifier l'échec.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : vert** ; parité ; `npm run build`.
- [ ] **Step 5 : docs** — FEATURES « Interface — Fournisseurs » réécrite (liste, menu, badge, éditeur, plus de select) ; RELEASE-NEXT état final. Commit : `feat(ai): a tidier providers list with an actions menu and a two-column editor`.

---

## Auto-revue

- Couverture : 1 → tâche 1 ; 9 → tâche 2 ; 3 → tâche 3.
- Noms : `.has-summarize`, `ai.routing.panel` (« Panneau IA »), `ai.routing.{summary,translate,panel}Title`, `ai.admin.{more,setDefault,newTitle,editTitle}`, `TypeTag`.
- Fichiers partagés : `FEATURES.md` ; `ReadingPane.tsx` (tâche 1 seule) ; `AiSummary.tsx` (tâche 2 seule) ; `AdminProviders.tsx` (tâche 3 seule) — séquentiel par simplicité.
