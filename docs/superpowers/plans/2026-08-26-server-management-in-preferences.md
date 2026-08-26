# Gestion des serveurs dans Préférences — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la gestion des serveurs FreshRSS complète et atteignable depuis Préférences → Flux, la barre du haut devenant un sélecteur qui n'y mène plus que par raccourcis.

**Architecture :** La logique pure sort dans `src/lib/serverList.ts` et sert les deux écrans. Préférences → Flux devient une liste de serveurs dépliables (`ServerList` → `ServerRow` → `RefreshTokenField`), `ServerSwitcher` perd toute mutation et ne garde que la bascule plus deux raccourcis vers Préférences. Aucun changement backend : les routes sont déjà adressées par `/:id`.

**Tech Stack :** TypeScript strict, React 18, Zustand, TailwindCSS (utilitaires de base), vitest, i18next v26 (9 locales).

**Spec :** `docs/superpowers/specs/2026-08-26-server-management-in-preferences-design.md`

## Global Constraints

- **Casse du dossier** : le chemin suivi par git est `src/components/Preferences/` (majuscule). macOS masque une erreur de casse, le CI Linux non.
- **Gates avant chaque commit** : `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **Garde-fou fuite d'infra avant chaque commit**, docs comprises :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'` — sortie vide = propre.
- **Valeurs fictives dans les tests** : `example.com`, `10.0.0.1`. Jamais de domaine, IP ou port réels.
- **Messages de commit** : neutres, conventionnels, en anglais. **Jamais** de trailer `Co-Authored-By` ni aucune mention d'IA.
- **i18n** : toute chaîne d'interface existe dans les **9** locales `src/locales/*.json` (fr, en, de, es, it, nl, pl, pt, uk). Édition par script Node, round-trip `JSON.stringify(obj, null, 2) + "\n"`.
- **Trois facteurs de forme** : desktop, tablette, smartphone. Cibles tactiles de 44 pt minimum, aucune action dépendante du survol ou du clic droit.
- **Garde-fous gelés** : `settingsCoverage.test.ts` (232 clés) et `featuresDoc.test.ts` restent verts. Un garde-fou rouge est une question, jamais un relevé à réajuster.

---

### Task 1: Logique pure de la liste de serveurs

**Files:**
- Create: `src/lib/serverList.ts`
- Test: `src/lib/serverList.test.ts`

**Interfaces:**
- Consumes: `ServerConnection` depuis `src/types` (`{ id: number; name?: string; url: string; freshrss_user: string; is_default?: number | boolean; has_token?: boolean; has_refresh_token?: boolean }`).
- Produces: `DisplayServer`, `hostnameOf(url: string): string`, `displayServers(servers, activeServerId, serverUrl): DisplayServer[]`, `nextServerAfterDelete(remaining, deletedId, activeServerId): ServerConnection | null`, `canDeleteServer(servers): boolean`.

- [ ] **Step 1: Write the failing test**

Créer `src/lib/serverList.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  hostnameOf,
  displayServers,
  nextServerAfterDelete,
  canDeleteServer,
} from './serverList';
import type { ServerConnection } from '../types';

const srv = (over: Partial<ServerConnection> & { id: number }): ServerConnection => ({
  name: `server-${over.id}`,
  url: `https://rss${over.id}.example.com`,
  freshrss_user: 'alice',
  has_token: true,
  ...over,
});

describe('hostnameOf', () => {
  it('rend l’hôte d’une URL valide', () => {
    expect(hostnameOf('https://rss.example.com/api/')).toBe('rss.example.com');
  });

  it('retire le préfixe www.', () => {
    expect(hostnameOf('https://www.example.com')).toBe('example.com');
  });

  it('rend l’entrée telle quelle si l’URL est malformée', () => {
    expect(hostnameOf('pas une url')).toBe('pas une url');
  });
});

describe('displayServers', () => {
  it('rend la liste inchangée quand l’actif a un enregistrement', () => {
    const servers = [srv({ id: 1 }), srv({ id: 2 })];
    const out = displayServers(servers, 1, 'https://rss1.example.com');
    expect(out).toHaveLength(2);
    expect(out.some((s) => s.synthetic)).toBe(false);
  });

  it('préfixe une entrée synthétique quand l’actif n’a pas d’enregistrement', () => {
    const out = displayServers([srv({ id: 2 })], 99, 'https://www.legacy.example.com');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 99,
      name: 'legacy.example.com',
      url: 'https://www.legacy.example.com',
      synthetic: true,
    });
  });

  it('compare les identifiants sans tenir compte du type', () => {
    const out = displayServers([srv({ id: 1 })], '1', 'https://rss1.example.com');
    expect(out).toHaveLength(1);
  });

  it('n’ajoute rien quand aucune URL de connexion n’est active', () => {
    expect(displayServers([srv({ id: 1 })], null, '')).toHaveLength(1);
  });

  it('nomme l’entrée synthétique __current__ quand l’identifiant actif est absent', () => {
    const out = displayServers([], null, 'https://rss.example.com');
    expect(out[0].id).toBe('__current__');
  });
});

describe('nextServerAfterDelete', () => {
  it('ne bascule pas quand le serveur supprimé n’était pas l’actif', () => {
    expect(nextServerAfterDelete([srv({ id: 2 })], 1, 2)).toBeNull();
  });

  it('choisit le serveur par défaut quand l’actif est supprimé', () => {
    const remaining = [srv({ id: 2 }), srv({ id: 3, is_default: 1 })];
    expect(nextServerAfterDelete(remaining, 1, 1)?.id).toBe(3);
  });

  it('choisit le premier restant faute de serveur par défaut', () => {
    const remaining = [srv({ id: 2 }), srv({ id: 3 })];
    expect(nextServerAfterDelete(remaining, 1, 1)?.id).toBe(2);
  });

  it('ne bascule pas vers un serveur sans jeton', () => {
    const remaining = [srv({ id: 2, has_token: false })];
    expect(nextServerAfterDelete(remaining, 1, 1)).toBeNull();
  });

  it('ne bascule pas quand il ne reste rien', () => {
    expect(nextServerAfterDelete([], 1, 1)).toBeNull();
  });
});

describe('canDeleteServer', () => {
  it('refuse la suppression du dernier serveur', () => {
    expect(canDeleteServer([srv({ id: 1 })])).toBe(false);
  });

  it('autorise la suppression dès qu’il y en a deux', () => {
    expect(canDeleteServer([srv({ id: 1 }), srv({ id: 2 })])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/serverList.test.ts`
Expected: FAIL — `Failed to resolve import "./serverList"`.

- [ ] **Step 3: Write minimal implementation**

Créer `src/lib/serverList.ts` :

```ts
import type { ServerConnection } from '../types';

/**
 * Un serveur tel qu'il s'affiche. `synthetic` marque la connexion FreshRSS
 * active qui n'a pas d'enregistrement en base (première connexion, comptes
 * anciens) : elle se voit mais ne se gère pas.
 */
export type DisplayServer = Omit<ServerConnection, 'id'> & {
  id: string | number;
  synthetic?: boolean;
};

/** Hôte abrégé d'une URL de serveur, sans `www.`. Tolérant aux URL malformées. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Liste affichable. Quand la connexion active n'est adossée à aucun
 * enregistrement, une entrée synthétique la représente en tête : le serveur
 * courant doit toujours être visible, même s'il n'est pas gérable.
 */
export function displayServers(
  servers: ServerConnection[],
  activeServerId: string | number | null,
  serverUrl: string,
): DisplayServer[] {
  const list: DisplayServer[] = [...servers];
  const hasActiveRecord = servers.some((s) => String(s.id) === String(activeServerId));
  if (serverUrl && !hasActiveRecord) {
    list.unshift({
      id: activeServerId ?? '__current__',
      name: hostnameOf(serverUrl),
      url: serverUrl,
      freshrss_user: '',
      synthetic: true,
    });
  }
  return list;
}

/**
 * Serveur sur lequel basculer après une suppression, ou `null` s'il n'y a pas
 * lieu de basculer. Ne bascule que si le serveur supprimé était l'actif, et
 * jamais vers un serveur sans jeton — il ne saurait pas répondre.
 */
export function nextServerAfterDelete(
  remaining: ServerConnection[],
  deletedId: string | number,
  activeServerId: string | number | null,
): ServerConnection | null {
  if (String(deletedId) !== String(activeServerId)) return null;
  const next = remaining.find((s) => s.is_default) ?? remaining[0];
  return next?.has_token ? next : null;
}

/** Le dernier serveur ne se supprime pas : le compte resterait sans connexion. */
export function canDeleteServer(servers: ServerConnection[]): boolean {
  return servers.length > 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/serverList.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/lib/serverList.ts src/lib/serverList.test.ts
git commit -m "feat(servers): extract the display-list logic into a tested module"
```

---

### Task 2: Rendre le garde-fou settingsCoverage récursif

Le relevé sera aveugle aux fichiers de `Preferences/servers/` créés plus loin. Il faut le corriger **avant** de déplacer quoi que ce soit, et prouver qu'il sait encore échouer.

**Files:**
- Modify: `src/components/Preferences/settingsCoverage.test.ts:33-50`

**Interfaces:**
- Consumes: rien.
- Produces: `settingsCoverage.test.ts` parcourt `src/components/Preferences/` récursivement.

- [ ] **Step 1: Rendre le parcours récursif**

Dans `src/components/Preferences/settingsCoverage.test.ts`, ajouter la fonction juste après la déclaration de `PLURAL_SUFFIXES` :

```ts
/**
 * Tous les fichiers source du panneau, sous-dossiers compris. Le parcours était
 * à plat : déplacer un réglage dans un sous-dossier le rendait invisible au
 * relevé, et le garde-fou rougissait sans que rien ne soit cassé. Un
 * sous-dossier du panneau reste le panneau.
 */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
```

Puis, dans `referencedKeys()`, remplacer :

```ts
  const src = fs.readdirSync(DIR)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8'))
    .join('\n');
```

par :

```ts
  const src = sourceFiles(DIR)
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
```

- [ ] **Step 2: Vérifier que le garde-fou reste vert**

Run: `npx vitest run src/components/Preferences/settingsCoverage.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 3: Prouver qu'il sait encore échouer**

Introduire une dérive réelle : dans `src/components/Preferences/FeedsTab.tsx`, remplacer temporairement `t('preferences.refresh.tokenLabel')` par `t('preferences.refresh.tokenLabelXX')`.

Run: `npx vitest run src/components/Preferences/settingsCoverage.test.ts`
Expected: FAIL — `réglages perdus par la refonte : preferences.refresh.tokenLabel`.

- [ ] **Step 4: Retirer la dérive et revérifier**

Restaurer `t('preferences.refresh.tokenLabel')`.

Run: `npx vitest run src/components/Preferences/settingsCoverage.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Prouver qu'il voit les sous-dossiers**

Créer un fichier jetable `src/components/Preferences/servers/__probe.tsx` :

```tsx
export const probe = (t: (k: string) => string) => t('preferences.refresh.tokenLabel');
```

Retirer à nouveau la clé de `FeedsTab.tsx` (`tokenLabelXX`), puis :

Run: `npx vitest run src/components/Preferences/settingsCoverage.test.ts`
Expected: PASS — la clé est trouvée dans le sous-dossier, ce que l'ancien parcours à plat ne pouvait pas faire.

Restaurer `FeedsTab.tsx` et supprimer la sonde :

```bash
rm src/components/Preferences/servers/__probe.tsx
```

- [ ] **Step 6: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git status --short
```
Expected: seul `src/components/Preferences/settingsCoverage.test.ts` est modifié. Aucune trace de `__probe.tsx` ni de `tokenLabelXX`.

```bash
git add src/components/Preferences/settingsCoverage.test.ts
git commit -m "test(preferences): scan the settings panel recursively"
```

---

### Task 3: Les nouvelles clés i18n dans les 9 locales

**Files:**
- Modify: `src/locales/fr.json`, `en.json`, `de.json`, `es.json`, `it.json`, `nl.json`, `pl.json`, `pt.json`, `uk.json` (bloc `servers`)

**Interfaces:**
- Consumes: rien.
- Produces: `servers.manage`, `servers.active`, `servers.defaultBadge`, `servers.switchTo`, `servers.expand`, `servers.collapse`, `servers.errorGeneric`, `servers.cannotDeleteLast`. Les clés existantes `servers.label`, `addTitle`, `rename`, `setDefault`, `delete`, `confirmDelete`, `errorDuplicate` sont réutilisées telles quelles.

- [ ] **Step 1: Écrire les clés par script**

```bash
node -e '
const fs = require("fs");
const T = {
  fr: { manage: "Gérer les serveurs…", active: "Actif", defaultBadge: "Par défaut", switchTo: "Basculer sur ce serveur", expand: "Afficher les détails", collapse: "Masquer les détails", errorGeneric: "L’action a échoué. Réessayez.", cannotDeleteLast: "Le dernier serveur ne peut pas être supprimé." },
  en: { manage: "Manage servers…", active: "Active", defaultBadge: "Default", switchTo: "Switch to this server", expand: "Show details", collapse: "Hide details", errorGeneric: "The action failed. Try again.", cannotDeleteLast: "The last server cannot be deleted." },
  de: { manage: "Server verwalten…", active: "Aktiv", defaultBadge: "Standard", switchTo: "Zu diesem Server wechseln", expand: "Details anzeigen", collapse: "Details ausblenden", errorGeneric: "Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.", cannotDeleteLast: "Der letzte Server kann nicht gelöscht werden." },
  es: { manage: "Gestionar servidores…", active: "Activo", defaultBadge: "Por defecto", switchTo: "Cambiar a este servidor", expand: "Mostrar detalles", collapse: "Ocultar detalles", errorGeneric: "La acción ha fallado. Inténtalo de nuevo.", cannotDeleteLast: "No se puede eliminar el último servidor." },
  it: { manage: "Gestisci i server…", active: "Attivo", defaultBadge: "Predefinito", switchTo: "Passa a questo server", expand: "Mostra i dettagli", collapse: "Nascondi i dettagli", errorGeneric: "Azione non riuscita. Riprova.", cannotDeleteLast: "L’ultimo server non può essere eliminato." },
  nl: { manage: "Servers beheren…", active: "Actief", defaultBadge: "Standaard", switchTo: "Naar deze server wisselen", expand: "Details tonen", collapse: "Details verbergen", errorGeneric: "De actie is mislukt. Probeer het opnieuw.", cannotDeleteLast: "De laatste server kan niet worden verwijderd." },
  pl: { manage: "Zarządzaj serwerami…", active: "Aktywny", defaultBadge: "Domyślny", switchTo: "Przełącz na ten serwer", expand: "Pokaż szczegóły", collapse: "Ukryj szczegóły", errorGeneric: "Akcja nie powiodła się. Spróbuj ponownie.", cannotDeleteLast: "Nie można usunąć ostatniego serwera." },
  pt: { manage: "Gerir servidores…", active: "Ativo", defaultBadge: "Predefinido", switchTo: "Mudar para este servidor", expand: "Mostrar detalhes", collapse: "Ocultar detalhes", errorGeneric: "A ação falhou. Tente novamente.", cannotDeleteLast: "O último servidor não pode ser eliminado." },
  uk: { manage: "Керувати серверами…", active: "Активний", defaultBadge: "Стандартний", switchTo: "Перейти на цей сервер", expand: "Показати деталі", collapse: "Сховати деталі", errorGeneric: "Дію не виконано. Спробуйте ще раз.", cannotDeleteLast: "Останній сервер не можна видалити." },
};
for (const [loc, keys] of Object.entries(T)) {
  const p = `src/locales/${loc}.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  Object.assign(j.servers, keys);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
}
console.log("9 locales mises à jour");
'
```

- [ ] **Step 2: Vérifier la parité**

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk"];const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":"parité ok")'
```
Expected: `parité ok`

- [ ] **Step 3: Vérifier le round-trip JSON**

```bash
git diff --stat src/locales/
```
Expected: 9 fichiers, ~8 lignes ajoutées chacun. Aucun reformatage massif — si un fichier montre des centaines de lignes modifiées, le round-trip a échoué : annuler et reprendre.

- [ ] **Step 4: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/locales
git commit -m "i18n(servers): add the management screen strings in all locales"
```

---

### Task 4: Intention de deep-link dans le themeStore

**Files:**
- Modify: `src/stores/themeStore.ts:377-421`

**Interfaces:**
- Consumes: rien.
- Produces: `preferencesIntent: string | null`, `openPreferences(tab?: string | null, intent?: string | null): void`, `clearPreferencesIntent(): void`. `closePreferences()` remet `preferencesIntent` à `null`.

- [ ] **Step 1: Déclarer le champ dans le type du store**

Dans `src/stores/themeStore.ts`, sous `preferencesTab: string | null;` (ligne 377) :

```ts
  preferencesTab: string | null;
  // Intention ponctuelle portée par l'ouverture : la section seule ne dit pas
  // ce qu'on vient y faire. Consommée puis vidée au montage, sinon rouvrir le
  // panneau relancerait l'action.
  preferencesIntent: string | null;
```

Et dans la liste des actions, sous `openPreferences` (ligne 380) :

```ts
  openPreferences: (tab?: string | null, intent?: string | null) => void;
  clearPreferencesIntent: () => void;
```

- [ ] **Step 2: Implémenter**

Remplacer les lignes 417-421 :

```ts
    preferencesTab: null, // null = default ('general'), or force a specific tab on open
    preferencesOpenId: 0,  // increments each open — forces useEffect to re-fire
```

par :

```ts
    preferencesTab: null, // null = default ('general'), or force a specific tab on open
    preferencesIntent: null, // null = just open the section
    preferencesOpenId: 0,  // increments each open — forces useEffect to re-fire
```

puis :

```ts
    openPreferences: (tab = null) => set((s) => ({ preferencesOpen: true, preferencesTab: tab, preferencesOpenId: s.preferencesOpenId + 1 })),
    closePreferences: () => set({ preferencesOpen: false, preferencesTab: null }),
```

par :

```ts
    openPreferences: (tab = null, intent = null) => set((s) => ({ preferencesOpen: true, preferencesTab: tab, preferencesIntent: intent, preferencesOpenId: s.preferencesOpenId + 1 })),
    clearPreferencesIntent: () => set({ preferencesIntent: null }),
    closePreferences: () => set({ preferencesOpen: false, preferencesTab: null, preferencesIntent: null }),
```

- [ ] **Step 3: Vérifier que les appelants existants compilent**

Run: `npm run typecheck`
Expected: PASS. Les trois appels existants (`RefreshBanner.tsx:75`, `Sidebar.tsx:633`, `Sidebar.tsx:1357`) restent valides, le second paramètre étant optionnel.

- [ ] **Step 4: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/stores/themeStore.ts
git commit -m "feat(preferences): carry an intent alongside the opened section"
```

---

### Task 5: Extraire le champ jeton en composant par serveur

**Files:**
- Create: `src/components/Preferences/servers/RefreshTokenField.tsx`
- Move: `src/components/ServerSwitcher/AddServerDialog.tsx` → `src/components/Preferences/servers/AddServerDialog.tsx`
- Modify: `src/components/ServerSwitcher/ServerSwitcher.tsx:14` (chemin d'import d'`AddServerDialog`)

**Interfaces:**
- Consumes: `updateServer(id: number, updates: Record<string, unknown>)`, `startActualize(id: number, kind: RefreshKind, maxFeeds?: number, token?: string)`, `getActualizeStatus(id: number, kind: RefreshKind)` depuis `src/api/backend`.
- Produces: `RefreshTokenField` avec les props `{ serverId: number; isActive: boolean; configured: boolean; onSaved: () => void }`. `AddServerDialog` conserve ses props `{ onClose: () => void; onAdded: (server: ServerConnection) => void }`.

**Ce qui change par rapport à `FeedsTab` :** le composant ne va plus chercher lui-même l'état du serveur — `configured` lui est fourni par la liste, qui l'a déjà. Et il ne met à jour le drapeau global `hasRefreshToken` **que si le serveur est l'actif** : ce drapeau décrit le serveur courant, l'écrire depuis la ligne d'un autre serveur serait un mensonge.

- [ ] **Step 1: Déplacer AddServerDialog**

```bash
mkdir -p src/components/Preferences/servers
git mv src/components/ServerSwitcher/AddServerDialog.tsx src/components/Preferences/servers/AddServerDialog.tsx
```

Dans `src/components/Preferences/servers/AddServerDialog.tsx`, les imports remontent d'un niveau supplémentaire. Remplacer :

```ts
import { addServer as apiAddServer, updateServer } from '../../api/backend';
import { login as freshrssLogin } from '../../api/auth';
import { useFeedStore } from '../../stores/feedStore';
import type { ServerConnection } from '../../types';
```

par :

```ts
import { addServer as apiAddServer, updateServer } from '../../../api/backend';
import { login as freshrssLogin } from '../../../api/auth';
import { useFeedStore } from '../../../stores/feedStore';
import type { ServerConnection } from '../../../types';
```

Dans `src/components/ServerSwitcher/ServerSwitcher.tsx`, remplacer :

```ts
import AddServerDialog from './AddServerDialog';
```

par :

```ts
import AddServerDialog from '../Preferences/servers/AddServerDialog';
```

- [ ] **Step 2: Vérifier que rien n'est cassé par le déplacement**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Créer RefreshTokenField**

Créer `src/components/Preferences/servers/RefreshTokenField.tsx` :

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updateServer, startActualize, getActualizeStatus } from '../../../api/backend';
import { useFeedStore } from '../../../stores/feedStore';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

interface RefreshTokenFieldProps {
  serverId: number;
  /** Le drapeau global `hasRefreshToken` décrit le serveur courant : ne
   *  l'écrire que depuis la ligne de ce serveur-là. */
  isActive: boolean;
  configured: boolean;
  onSaved: () => void;
}

/**
 * Jeton maître de rafraîchissement d'UN serveur. Le jeton est en écriture
 * seule : le backend ne renvoie jamais sa valeur, seulement s'il en existe un.
 */
export default function RefreshTokenField({ serverId, isActive, configured, onSaved }: RefreshTokenFieldProps) {
  const { t } = useTranslation();
  const setHasRefreshToken = useFeedStore((s) => s.setHasRefreshToken);

  const [token, setToken] = useState('');
  // Le champ est vide mais affiche des puces quand un jeton est stocké, ce qui
  // se lit comme pré-rempli. Save envoie ce que contient le champ, et le
  // backend traite '' comme un effacement explicite — un Save non touché
  // effaçait donc un jeton qui marchait. Seule une édition réelle arme le
  // bouton. Vider le champ EST une édition, effacer volontairement marche donc.
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>('idle');
  // runTest scrute jusqu'à 30 s ; Préférences peut être fermé bien avant.
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);

  async function save() {
    if (!edited) return;
    setSaving(true);
    setTest('idle');
    try {
      await updateServer(serverId, { refreshToken: token });
      if (isActive) setHasRefreshToken(token !== '');
      setToken('');
      setEdited(false);
      onSaved();
    } catch {
      // Save a échoué : laisser le jeton tapé en place pour que le bouton ne
      // mente pas sur ce qui a été enregistré, et réutiliser la formulation
      // d'échec du test plutôt que d'ajouter une clé.
      setTest('fail');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTest('testing');
    try {
      // Éprouver la valeur du champ, pas le jeton stocké : celui qui colle un
      // jeton fraîchement tourné et lance Test avant Save ne doit pas recevoir
      // un refus portant sur le jeton qu'il remplace. Un champ édité laissé
      // vide veut dire « effacer au Save » — pour Test, on retombe alors sur le
      // jeton stocké plutôt que d'en envoyer un vide.
      const testToken = edited && token !== '' ? token : undefined;
      // maxFeeds=1 : prouve que le jeton est accepté sans lancer une passe
      // complète. kind 'test' : son propre créneau, pour qu'une passe déjà en
      // vol ne soit pas rendue ici et n'expire pas en « jeton refusé ».
      const job = await startActualize(serverId, 'test', 1, testToken);
      if (!job) {
        setTest('fail');
        return;
      }
      // Le POST confirme seulement qu'un jeton est stocké ; l'appel réel à
      // FreshRSS a lieu ensuite, sans retour. Scruter le vrai résultat plutôt
      // que de croire le 202. Borné à ~30 s.
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (unmounted.current) return;
        const status = await getActualizeStatus(serverId, 'test');
        if (unmounted.current) return;
        if (status?.status === 'done') {
          setTest('ok');
          return;
        }
        if (status?.status === 'failed') {
          setTest('fail');
          return;
        }
      }
      setTest('fail');
    } catch {
      if (!unmounted.current) setTest('fail');
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.refresh.tokenLabel')}
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={token}
          onChange={(e) => { setToken(e.target.value); setEdited(true); }}
          placeholder={configured ? '••••••••' : ''}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{
            border: '1px solid var(--panel-border)',
            color: 'var(--list-title)',
            background: 'var(--panel-header-bg)',
          }}
        />
        <span className="block text-[11px] opacity-70 mt-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.refresh.tokenHelp')}
        </span>
      </div>

      {/* Avertissement de portée — ce jeton donne aussi accès en lecture à
          tout, pas seulement au rafraîchissement : il reste dans le flux
          plutôt que replié derrière un dépliant. */}
      <div
        className="px-4 py-3 rounded-lg text-xs flex items-start gap-2"
        style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
      >
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span>{t('preferences.refresh.scopeWarning')}</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={saving || !edited}
          aria-busy={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[44px]"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {saving && (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {t('preferences.refresh.save')}
        </button>
        <button
          type="button"
          onClick={runTest}
          // Actif dès qu'il y a un jeton à éprouver — stocké, ou tapé à
          // l'instant. Le conditionner au seul `configured` piégeait celui qui
          // collait un jeton de remplacement : Test restait lié à l'ancien
          // jusqu'au Save, donc vérifier avant de valider était impossible.
          disabled={(!configured && token === '') || saving || test === 'testing'}
          aria-busy={test === 'testing'}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:bg-black/5 disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[44px]"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {test === 'testing' && (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {t('preferences.refresh.test')}
        </button>
        {test === 'ok' && (
          <span className="text-[11px]" role="status" style={{ color: 'var(--accent)' }}>
            {t('preferences.refresh.testOk')}
          </span>
        )}
        {test === 'fail' && (
          <span className="text-[11px]" role="status" style={{ color: 'var(--danger)' }}>
            {t('preferences.refresh.testFail')}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier que le garde-fou reste vert**

`FeedsTab.tsx` n'est pas encore modifié : les clés `preferences.refresh.*` sont désormais référencées à deux endroits, ce qui convient au relevé.

Run: `npx vitest run src/components/Preferences/settingsCoverage.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add -A src/components/Preferences/servers src/components/ServerSwitcher
git commit -m "refactor(servers): make the refresh-token field a per-server component"
```

---

### Task 6: La ligne de serveur

**Files:**
- Create: `src/components/Preferences/servers/ServerRow.tsx`

**Interfaces:**
- Consumes: `DisplayServer`, `hostnameOf` depuis `src/lib/serverList` ; `RefreshTokenField` de la tâche 5.
- Produces: `ServerRow` avec les props
  `{ server: DisplayServer; isActive: boolean; expanded: boolean; canDelete: boolean; onToggle: () => void; onSwitch: () => void; onRename: (name: string) => Promise<void>; onSetDefault: () => Promise<void>; onDelete: () => Promise<void>; onSaved: () => void }`.
  Les quatre gestionnaires asynchrones **rejettent** en cas d'échec : la ligne affiche l'erreur elle-même.

**Interaction :** deux cibles de 44 pt. Le corps de la ligne bascule sur ce serveur, le chevron à droite déplie les détails. Le chevron prend toute la hauteur de la ligne pour que sa zone tactile ne dépende pas de la taille du glyphe.

- [ ] **Step 1: Créer le composant**

Créer `src/components/Preferences/servers/ServerRow.tsx` :

```tsx
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { hostnameOf, type DisplayServer } from '../../../lib/serverList';
import RefreshTokenField from './RefreshTokenField';

interface ServerRowProps {
  server: DisplayServer;
  isActive: boolean;
  expanded: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onSwitch: () => void;
  onRename: (name: string) => Promise<void>;
  onSetDefault: () => Promise<void>;
  onDelete: () => Promise<void>;
  onSaved: () => void;
}

/**
 * Un serveur dans l'écran de gestion. Repliée, la ligne montre l'essentiel et
 * bascule d'un tap ; dépliée, elle porte toutes les actions de gestion.
 * La connexion héritée (`synthetic`) se voit mais ne se gère pas : aucun
 * enregistrement en base ne lui correspond.
 */
export default function ServerRow({
  server, isActive, expanded, canDelete,
  onToggle, onSwitch, onRename, onSetDefault, onDelete, onSaved,
}: ServerRowProps) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(server.name || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Les gestionnaires rejettent : sans ce relais, un renommage refusé ne
  // produisait rien à l'écran — six `catch { /* ignore */ }` dans l'ancien
  // menu contextuel. Tolérable dans un menu fugace, pas dans un écran de
  // gestion.
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError(t('servers.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  const isDefault = !!server.is_default;

  return (
    <li className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--panel-border)' }}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onSwitch}
          disabled={isActive || !!server.synthetic}
          title={isActive ? undefined : t('servers.switchTo')}
          className="flex-1 text-left px-3 py-2 min-h-[44px] flex flex-col justify-center gap-0.5 transition-colors hover:bg-black/5 disabled:hover:bg-transparent min-w-0"
        >
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--list-title)' }}>
              {server.name}
            </span>
            {isActive && <Badge label={t('servers.active')} accent />}
            {isDefault && <Badge label={t('servers.defaultBadge')} />}
          </span>
          <span className="text-[11px] truncate" style={{ color: 'var(--list-summary)' }}>
            {hostnameOf(server.url)}
            {server.freshrss_user ? ` · ${server.freshrss_user}` : ''}
          </span>
        </button>

        {!server.synthetic && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? t('servers.collapse') : t('servers.expand')}
            className="w-11 flex-shrink-0 flex items-center justify-center transition-colors hover:bg-black/5"
            style={{ borderLeft: '1px solid var(--panel-border)', color: 'var(--list-summary)' }}
          >
            <svg
              className="w-4 h-4 transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {expanded && !server.synthetic && (
        <div className="px-3 py-3 space-y-3" style={{ borderTop: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}>
          {renaming ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                const name = renameValue.trim();
                if (!name || name === server.name) { setRenaming(false); return; }
                run(() => onRename(name)).then(() => setRenaming(false));
              }}
              className="flex items-center gap-2 flex-wrap"
            >
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false); }}
                className="flex-1 min-w-[8rem] text-sm px-2.5 py-1.5 rounded-lg outline-none"
                style={{ border: '1px solid var(--accent)', color: 'var(--list-title)', background: 'var(--panel-bg)' }}
              />
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-white min-h-[44px] disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {t('servers.rename')}
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <RowAction label={t('servers.rename')} onClick={() => { setRenameValue(server.name || ''); setRenaming(true); }} disabled={busy} />
              {!isDefault && (
                <RowAction label={t('servers.setDefault')} onClick={() => run(onSetDefault)} disabled={busy} />
              )}
            </div>
          )}

          <RefreshTokenField
            serverId={Number(server.id)}
            isActive={isActive}
            configured={!!server.has_refresh_token}
            onSaved={onSaved}
          />

          <div className="pt-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
            {confirmDelete ? (
              <div className="flex items-center gap-2 flex-wrap pt-2">
                <span className="text-xs" style={{ color: 'var(--list-title)' }}>
                  {t('servers.confirmDelete', { name: server.name })}
                </span>
                <RowAction label={t('sidebar.cancel')} onClick={() => setConfirmDelete(false)} disabled={busy} />
                <button
                  type="button"
                  onClick={() => run(onDelete)}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-white min-h-[44px] disabled:opacity-50"
                  style={{ background: 'var(--danger)' }}
                >
                  {t('servers.delete')}
                </button>
              </div>
            ) : (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy || !canDelete}
                  title={canDelete ? undefined : t('servers.cannotDeleteLast')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] transition-colors hover:bg-black/5 disabled:opacity-50"
                  style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}
                >
                  {t('servers.delete')}
                </button>
                {!canDelete && (
                  <span className="block text-[11px] mt-1.5 opacity-70" style={{ color: 'var(--list-summary)' }}>
                    {t('servers.cannotDeleteLast')}
                  </span>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-[11px]" role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0"
      style={
        accent
          ? { background: 'var(--accent)', color: '#fff' }
          : { border: '1px solid var(--panel-border)', color: 'var(--list-summary)' }
      }
    >
      {label}
    </span>
  );
}

function RowAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] transition-colors hover:bg-black/5 disabled:opacity-50"
      style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Vérifier la clé d'annulation réutilisée**

`sidebar.cancel` est déjà employée par l'ancien menu contextuel et existe donc dans les 9 locales.

```bash
node -e 'const fs=require("fs");for(const l of ["fr","en","de","es","it","nl","pl","pt","uk"]){const j=JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8"));console.log(l, j.sidebar?.cancel)}'
```
Expected: neuf valeurs non vides.

- [ ] **Step 3: Vérifier la compilation**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Le composant n'est pas encore monté : c'est attendu.

- [ ] **Step 4: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/components/Preferences/servers/ServerRow.tsx
git commit -m "feat(servers): add the expandable server row"
```

---

### Task 7: La liste, et Flux qui la monte

**Files:**
- Create: `src/components/Preferences/servers/ServerList.tsx`
- Modify: `src/components/Preferences/FeedsTab.tsx` (remplacement intégral du contenu)

**Interfaces:**
- Consumes: `displayServers`, `nextServerAfterDelete`, `canDeleteServer` de la tâche 1 ; `ServerRow` de la tâche 6 ; `AddServerDialog` et `RefreshTokenField` de la tâche 5 ; `preferencesIntent` / `clearPreferencesIntent` de la tâche 4.
- Produces: `ServerList`, sans props. `FeedsTab` se réduit à le monter.

- [ ] **Step 1: Créer la liste**

Créer `src/components/Preferences/servers/ServerList.tsx` :

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../stores/authStore';
import { useFeedStore } from '../../../stores/feedStore';
import { useThemeStore } from '../../../stores/themeStore';
import {
  getServers,
  updateServer,
  deleteServer,
  setDefaultServer,
} from '../../../api/backend';
import {
  displayServers,
  nextServerAfterDelete,
  canDeleteServer,
} from '../../../lib/serverList';
import type { ServerConnection } from '../../../types';
import ServerRow from './ServerRow';
import AddServerDialog from './AddServerDialog';

/**
 * Écran de gestion des serveurs FreshRSS — le seul endroit complet. La barre
 * du haut n'y mène que par raccourcis ; masquée, elle ne doit rien emporter
 * avec elle, bascule comprise.
 */
export default function ServerList() {
  const { t } = useTranslation();
  const servers = useAuthStore((s) => s.servers);
  const setServers = useAuthStore((s) => s.setServers);
  const switchServer = useAuthStore((s) => s.switchServer);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const intent = useThemeStore((s) => s.preferencesIntent);
  const clearPreferencesIntent = useThemeStore((s) => s.clearPreferencesIntent);

  const [addOpen, setAddOpen] = useState(false);
  // Le serveur actif est déplié d'office : RefreshBanner pointe ici en
  // promettant le champ jeton, il doit s'y trouver sans repli à ouvrir.
  const [expandedId, setExpandedId] = useState<string | null>(
    activeServerId != null ? String(activeServerId) : null,
  );

  async function reload(): Promise<ServerConnection[]> {
    try {
      const list = await getServers();
      setServers(list);
      const active = list.find(
        (s) => String(s.id) === String(useAuthStore.getState().activeServerId),
      );
      useFeedStore.getState().setHasRefreshToken(!!active?.has_refresh_token);
      return list;
    } catch {
      return servers;
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Intention consommée puis vidée : sans cela, rouvrir Préférences
  // relancerait le dialogue d'ajout.
  useEffect(() => {
    if (intent === 'addServer') {
      setAddOpen(true);
      clearPreferencesIntent();
    }
  }, [intent, clearPreferencesIntent]);

  async function handleAdded(server: ServerConnection) {
    setAddOpen(false);
    const list = await reload();
    switchServer(server);
    // Le drapeau se lit dans la liste rechargée, pas dans le paramètre, qui
    // peut être en retard sur l'état réel.
    const added = list.find((s) => String(s.id) === String(server.id));
    useFeedStore.getState().setHasRefreshToken(!!added?.has_refresh_token);
    setExpandedId(String(server.id));
  }

  function handleSwitch(server: ServerConnection) {
    if (String(server.id) === String(activeServerId)) return;
    switchServer(server);
    useFeedStore.getState().setHasRefreshToken(!!server.has_refresh_token);
  }

  // Les trois gestionnaires ci-dessous laissent remonter leur échec : c'est
  // ServerRow qui l'affiche, sur la ligne concernée.
  async function handleRename(server: ServerConnection, name: string) {
    await updateServer(Number(server.id), { name });
    await reload();
  }

  async function handleSetDefault(server: ServerConnection) {
    await setDefaultServer(Number(server.id));
    await reload();
  }

  async function handleDelete(server: ServerConnection) {
    await deleteServer(Number(server.id));
    const list = await reload();
    const next = nextServerAfterDelete(list, server.id, activeServerId);
    if (next) switchServer(next);
  }

  const rows = displayServers(servers, activeServerId, serverUrl);
  const deletable = canDeleteServer(servers);

  return (
    <div className="space-y-4">
      <ul className="space-y-2" aria-label={t('servers.label')}>
        {rows.map((server) => (
          <ServerRow
            key={server.id}
            server={server}
            isActive={String(server.id) === String(activeServerId)}
            expanded={expandedId === String(server.id)}
            canDelete={deletable}
            onToggle={() =>
              setExpandedId((cur) => (cur === String(server.id) ? null : String(server.id)))
            }
            onSwitch={() => handleSwitch(server as ServerConnection)}
            onRename={(name) => handleRename(server as ServerConnection, name)}
            onSetDefault={() => handleSetDefault(server as ServerConnection)}
            onDelete={() => handleDelete(server as ServerConnection)}
            onSaved={() => { reload(); }}
          />
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="w-full px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] transition-colors inline-flex items-center justify-center gap-1.5"
        style={{ border: '1px dashed var(--panel-border)', color: 'var(--list-title)' }}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        {t('servers.addTitle')}
      </button>

      {addOpen && <AddServerDialog onClose={() => setAddOpen(false)} onAdded={handleAdded} />}
    </div>
  );
}
```

- [ ] **Step 2: Réduire FeedsTab**

Remplacer **tout** le contenu de `src/components/Preferences/FeedsTab.tsx` par :

```tsx
import ServerList from './servers/ServerList';

/**
 * Section Flux — la gestion des serveurs FreshRSS et, par serveur, son jeton
 * maître de rafraîchissement. La logique vit dans `servers/` ; cette section
 * n'est plus que le point de montage.
 */
export default function FeedsTab() {
  return <ServerList />;
}
```

- [ ] **Step 3: Vérifier que le garde-fou tient**

Les 7 clés `preferences.refresh.*` ne sont plus référencées que dans `servers/RefreshTokenField.tsx`, en sous-dossier. C'est précisément ce que la tâche 2 a rendu visible.

Run: `npx vitest run src/components/Preferences/settingsCoverage.test.ts`
Expected: PASS — 4 tests. **Un échec ici signifie que la récursion de la tâche 2 n'a pas été appliquée** ; ne pas toucher au relevé.

- [ ] **Step 4: Vérifier dans le navigateur**

Démarrer la prévisualisation, ouvrir Préférences → Flux et vérifier :

1. la liste montre chaque serveur, badge « actif » sur le bon, badge « par défaut » sur le bon ;
2. le serveur actif est déplié d'office et son champ jeton est visible ;
3. le chevron déplie et replie une autre ligne ;
4. taper le corps d'une ligne inactive bascule dessus ;
5. « Ajouter un serveur » ouvre le dialogue.

- [ ] **Step 5: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/components/Preferences/servers/ServerList.tsx src/components/Preferences/FeedsTab.tsx
git commit -m "feat(preferences): manage FreshRSS servers from the Feeds section"
```

---

### Task 8: La barre du haut redevient un sélecteur

**Files:**
- Modify: `src/components/ServerSwitcher/ServerSwitcher.tsx` (remplacement intégral)

**Interfaces:**
- Consumes: `displayServers`, `type DisplayServer` de la tâche 1 ; `openPreferences(tab, intent)` de la tâche 4.
- Produces: rien de nouveau. `ServerSwitcher` ne mute plus aucun serveur.

- [ ] **Step 1: Remplacer le composant**

Remplacer **tout** le contenu de `src/components/ServerSwitcher/ServerSwitcher.tsx` par :

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useFeedStore } from '../../stores/feedStore';
import { useThemeStore } from '../../stores/themeStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { getServers } from '../../api/backend';
import { displayServers, type DisplayServer } from '../../lib/serverList';

// ═════════════════════════════════════════════════════════════════════
// Sélecteur de serveur — pastilles horizontales dans la barre du haut.
//
// Il ne gère plus rien : ajouter, renommer, définir par défaut et supprimer
// vivent dans Préférences → Flux, atteignables même barre masquée et sans
// dépendre du clic droit — que Safari iOS n'émet pas. Le `+` et le menu
// contextuel n'y mènent que par raccourci.
// ═════════════════════════════════════════════════════════════════════
export default function ServerSwitcher() {
  const { t } = useTranslation();
  const servers = useAuthStore((s) => s.servers);
  const setServers = useAuthStore((s) => s.setServers);
  const switchServer = useAuthStore((s) => s.switchServer);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const openPreferences = useThemeStore((s) => s.openPreferences);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isMobile = useBreakpoint() === 'mobile';

  useEffect(() => {
    getServers()
      .then(setServers)
      .catch(() => { /* garder la liste connue */ });
  }, [setServers]);

  function handleSwitch(server: DisplayServer) {
    if (server.synthetic || String(server.id) === String(activeServerId)) return;
    switchServer(server as { id: string | number; url: string });
    useFeedStore.getState().setHasRefreshToken(!!server.has_refresh_token);
  }

  const rows = displayServers(servers, activeServerId, serverUrl);

  return (
    <div
      className={`flex justify-center flex-shrink-0 ${isMobile ? 'px-2 py-1' : 'px-3 py-2'}`}
      style={{
        background: 'var(--topbar-bg)',
        borderBottom: '1px solid var(--sidebar-divider)',
      }}
    >
      {/* Contrôle segmenté — piste discrète portant les serveurs */}
      <div className="server-track flex items-center gap-0.5 p-[3px] rounded-full max-w-full overflow-x-auto no-scrollbar">
        {rows.map((server) => {
          const isActive = !!server.synthetic || String(server.id) === String(activeServerId);
          return (
            <button
              key={server.id}
              onClick={() => handleSwitch(server)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY });
              }}
              className={`server-seg ${isActive ? 'server-seg-active' : ''} flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap flex-shrink-0 ${isMobile ? 'px-3 py-0.5 text-[11px]' : 'px-3.5 py-1 text-xs'}`}
              style={{ color: isActive ? 'var(--topbar-text-active)' : 'var(--topbar-text)' }}
              title={server.url}
            >
              <span>{server.name}</span>
              {server.is_default ? (
                <svg className="w-2.5 h-2.5 opacity-70 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M9.05 3.69c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.36 1.12l1.07 3.29c.3.92-.76 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.84-.2-1.54-1.12l1.07-3.29a1 1 0 00-.36-1.12l-2.8-2.03c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69l1.07-3.29z" />
                </svg>
              ) : null}
            </button>
          );
        })}

        {/* Fin séparateur, puis le raccourci d'ajout */}
        <span className="w-px self-stretch my-1.5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.10)' }} />
        <button
          onClick={() => openPreferences('feeds', 'addServer')}
          className="server-seg-add flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
          title={t('servers.addTitle')}
          aria-label={t('servers.addTitle')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {menu && (
        <ManageMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} onManage={() => { setMenu(null); openPreferences('feeds'); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Menu contextuel réduit à un raccourci. Il n'exécute plus d'action : rien
// d'essentiel ne doit dépendre du clic droit, absent au tactile.
function ManageMenu({ x, y, onClose, onManage }: { x: number; y: number; onClose: () => void; onManage: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const style: CSSProperties = {
    position: 'fixed', left: x, top: y, zIndex: 300,
    background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
    borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    minWidth: '200px', overflow: 'hidden',
  };

  return (
    <div ref={ref} style={style} className="py-1">
      <button
        onClick={onManage}
        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-black/5"
        style={{ color: 'var(--list-title)' }}
      >
        {t('servers.manage')}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier que plus rien ne référence les morceaux retirés**

```bash
grep -rn "ServerContextMenu\|hostnameOf\|AddServerDialog" src/components/ServerSwitcher/
```
Expected: aucune sortie. `hostnameOf` vit désormais dans `src/lib/serverList.ts`, `AddServerDialog` dans `Preferences/servers/`.

```bash
wc -l src/components/ServerSwitcher/ServerSwitcher.tsx
```
Expected: ~150 lignes, contre 320 avant.

- [ ] **Step 3: Vérifier dans le navigateur**

1. Une pastille inactive bascule d'un tap.
2. Le `+` ouvre Préférences → Flux **avec le dialogue d'ajout déjà ouvert**.
3. Fermer Préférences, le rouvrir par la barre latérale : le dialogue d'ajout **ne se rouvre pas** (l'intention a bien été vidée).
4. Le clic droit sur une pastille ouvre un menu à une entrée qui mène à Préférences → Flux.
5. Masquer la barre du haut : la gestion **et** la bascule restent accessibles par Préférences → Flux.

- [ ] **Step 4: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/components/ServerSwitcher/ServerSwitcher.tsx
git commit -m "refactor(servers): reduce the topbar to a selector with shortcuts"
```

---

### Task 9: Inventaire des fonctionnalités et vérification finale

**Files:**
- Modify: `docs/FEATURES.md:61-71` et `docs/FEATURES.md:280`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: un inventaire qui ne ment pas.

`featuresDoc.test.ts` n'attrape que le structurel : une description devenue fausse reste verte. Le piège décrit lignes 68-71 est précisément celui que ce travail supprime.

- [ ] **Step 1: Réécrire la section Serveurs**

Dans `docs/FEATURES.md`, remplacer :

```markdown
- **Où** : `server/routes/servers.ts`, `server/crypto.ts`, `src/components/ServerSwitcher/`
- **Piège connu** : `ServerSwitcher` est **le seul** endroit permettant d'ajouter,
  renommer, supprimer ou changer de serveur, et il ne se monte que si la barre
  supérieure est visible. La masquer rend la gestion des serveurs inaccessible.
  Déplacement vers Préférences → Flux prévu au backlog.
```

par :

```markdown
- **Où** : `server/routes/servers.ts`, `server/crypto.ts`,
  `src/components/Preferences/servers/` (gestion complète),
  `src/components/ServerSwitcher/` (sélecteur), `src/lib/serverList.ts`
  (logique partagée).
- **Deux endroits, un seul complet** : Préférences → Flux liste les serveurs et
  porte toutes les actions — basculer, ajouter, renommer, définir par défaut,
  supprimer, et le jeton maître de chaque serveur. La barre du haut ne fait que
  basculer ; son `+` et son clic droit sont des raccourcis vers Préférences,
  ils n'exécutent rien.
- **Jeton par serveur** : le jeton maître se configure et s'éprouve depuis la
  ligne de n'importe quel serveur, sans y basculer — les routes sont adressées
  par `/:id`. Le drapeau global `hasRefreshToken` ne décrit que le serveur
  actif : `RefreshTokenField` ne l'écrit que depuis la ligne de celui-ci.
- **Piège corrigé le 2026-08-26** : la gestion vivait uniquement dans
  `ServerSwitcher`, qui ne se monte que si la barre du haut est visible — la
  masquer emportait la bascule avec elle. Pire, renommer, définir par défaut et
  supprimer passaient par `onContextMenu`, que Safari iOS n'émet pas : trois
  actions sur cinq n'existaient pas dans la PWA installée.
- **Piège subsistant** : la connexion FreshRSS sans enregistrement en base
  (première connexion, comptes anciens) s'affiche en entrée synthétique, en
  lecture seule et non dépliable. Elle n'a pas d'identifiant en base : aucune
  action de gestion ne peut la viser.
```

- [ ] **Step 2: Relire la ligne 280**

```bash
sed -n '276,284p' docs/FEATURES.md
```

Vérifier que la description des sections de Préférences reste exacte — le nombre de sections est inchangé (Flux existait déjà), seul son contenu s'est étoffé. Si la prose décrit Flux comme ne portant que le jeton maître, la corriger.

- [ ] **Step 3: Relire la ligne 211**

```bash
sed -n '208,214p' docs/FEATURES.md
```

La mention « jeton maître (Préférences → Flux, écran de connexion, ajout de serveur) » reste vraie. La compléter si elle laisse croire que le jeton ne concerne que le serveur actif.

- [ ] **Step 4: Faire tourner tous les garde-fous**

```bash
npx vitest run
```
Expected: PASS, y compris `featuresDoc.test.ts`, `settingsCoverage.test.ts` et `serverList.test.ts`.

- [ ] **Step 5: Vérifier la parité des traductions**

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk"];const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":"parité ok")'
```
Expected: `parité ok`

- [ ] **Step 6: Vérifier les trois facteurs de forme**

Dans le navigateur, aux trois formats — desktop, tablette, smartphone :

1. la liste de serveurs se lit sans débordement horizontal ;
2. le corps de ligne et le chevron sont deux cibles distinctes d'au moins 44 pt ;
3. tout se fait au tap : aucune action ne réclame le survol ni le clic droit ;
4. le dialogue d'ajout tient dans l'écran en portrait.

**À vérifier ensuite par un humain sur un vrai iPhone, dans la PWA installée** — le simulateur ne dit pas tout des zones sûres et du comportement au tap.

- [ ] **Step 7: Gates, garde-fou de fuite et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add docs/FEATURES.md
git commit -m "docs: record server management moving into Preferences"
```

- [ ] **Step 8: Pousser et vérifier LES DEUX workflows**

```bash
git push origin dev
```

```bash
gh run list --branch dev --limit 2
```
Expected: `CI` **et** `Publish image`, tous deux `success`. Le garde-fou de fuite tourne dans `CI` avant lint/typecheck/tests : un `CI` rouge ne veut pas dire que le code est cassé. Ne jamais annoncer « gates verts » sur la seule foi des tests locaux.
