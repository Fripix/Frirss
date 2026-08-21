# Refonte du panneau Préférences — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réorganiser le panneau Préférences en cinq sections plus l'administration, avec une navigation verticale, une largeur décidée, un aperçu en direct, et un fonctionnement réel sur téléphone — sans perdre un seul réglage.

**Architecture:** On pose d'abord un garde-fou automatique sur les 232 clés de réglages, **avant** de toucher au code. Puis on remplace la coque (navigation et largeur) sans déplacer de contenu. Puis on extrait chaque section dans son fichier, une par tâche. L'aperçu et l'adaptation mobile viennent en dernier, sur une structure déjà stable.

**Tech Stack:** TypeScript strict, React 18, Zustand, TailwindCSS (utilitaires de base), CSS custom properties, vitest.

**Spec de référence :** `docs/superpowers/specs/2026-08-21-preferences-rework-design.md` — à lire avant la tâche 1.

## Global Constraints

- Gates avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`
- Garde-fou fuite d'infra avant **chaque** commit, docs comprises, et **lire la sortie** (vide = propre) :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- Messages de commit neutres, style conventionnel. **Jamais** de trailer `Co-Authored-By` ni de mention d'assistant.
- Toute chaîne UI dans **les 9 locales** (`fr, en, de, es, it, nl, pl, pt, uk`), parité vérifiée.
- `src/` n'utilise **pas** l'extension `.js` sur les imports relatifs (règle réservée à `server/`).
- Couleurs issues des CSS custom properties existantes. **`var(--teal)` n'existe pas** dans ce dépôt malgré sa présence dans certaines docs.
- **Trois formats à tenir : desktop, tablette, téléphone.** `useBreakpoint()` renvoie `'mobile' | 'tablet' | 'desktop'`. Le survol se conditionne à `(hover: hover)`, **jamais** à la largeur. Cibles tactiles ≥ 44 pt.
- Travailler sur la branche `dev`.
- **Aucun réglage ne doit disparaître.** Le test de la tâche 1 est la condition de passage de toutes les suivantes.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---------|----------------|
| `src/components/Preferences/settings-baseline.json` *(créer)* | Relevé figé des 232 clés de réglages. |
| `src/components/Preferences/settingsCoverage.test.ts` *(créer)* | Échoue si une clé du relevé n'est plus référencée. |
| `src/components/Preferences/Preferences.tsx` *(modifier)* | Coque : navigation, largeur, aiguillage. ~250 lignes visées. |
| `src/components/Preferences/AdminTab.tsx` *(créer)* | Comptes, authentification, SSO. |
| `src/components/Preferences/OfflineTab.tsx` *(créer)* | Hors-ligne, budget d'images. |
| `src/components/Preferences/LabelsTab.tsx` *(créer)* | Étiquettes et leurs couleurs. |
| `src/components/Preferences/GeneralTab.tsx` *(créer)* | Langue, lecture, raccourcis. |
| `src/components/Preferences/AppearanceTab.tsx` *(créer)* | Thème, couleurs, tailles, identité, aperçu. |
| `src/components/Preferences/colorHighlight.ts` *(créer)* | Carte couleur → sélecteur réel, partagée par la coque et Apparence. |
| `src/components/Preferences/ThemePreview.tsx` *(créer)* | Miniature de FriRSS + zones nommées. |
| `src/components/Preferences/FeedsTab.tsx` *(renommer depuis `RefreshTab.tsx`)* | Relève des flux. |
| `src/locales/*.json` *(modifier, 9 fichiers)* | Libellés de sections. |

---

### Task 1 : Le garde-fou des 232 réglages

**Files:**
- Create: `src/components/Preferences/settings-baseline.json`
- Create: `src/components/Preferences/settingsCoverage.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: un test qui échoue dès qu'une clé de réglage cesse d'être référencée. Toutes les tâches suivantes doivent le garder vert.

> **Cette tâche passe en premier, avant toute modification.** Le relevé doit
> décrire l'état actuel ; le générer après un déplacement le rendrait inutile.

- [ ] **Step 1 : Générer le relevé**

Créer un script jetable hors dépôt, `/tmp/gen-baseline.mjs`, et l'exécuter depuis la racine du dépôt :

```js
import fs from 'fs';
const DIR = 'src/components/Preferences';
const fr = JSON.parse(fs.readFileSync('src/locales/fr.json', 'utf8'));
const src = fs.readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
  .map((f) => fs.readFileSync(`${DIR}/${f}`, 'utf8')).join('\n');

const statik = [...src.matchAll(/t\(\s*'((?:preferences|admin)\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
const prefixes = [...src.matchAll(/t\(\s*`((?:preferences|admin)\.[a-zA-Z0-9_.]+)\.\$\{/g)].map((m) => m[1]);
const leaves = (p) => {
  let d = fr;
  for (const part of p.split('.')) d = (d ?? {})[part];
  return d && typeof d === 'object' ? Object.keys(d).map((k) => `${p}.${k}`) : [];
};
const all = [...new Set([...statik, ...prefixes.flatMap(leaves)])]
  .filter((k) => !k.startsWith('preferences.tabs.'))
  .sort();
fs.writeFileSync(`${DIR}/settings-baseline.json`, JSON.stringify(all, null, 1) + '\n');
console.log('clés figées :', all.length);
```

```bash
node /tmp/gen-baseline.mjs
```
Attendu : `clés figées : 232`. **Si le nombre diffère, arrêter et le signaler** — le relevé ne correspond plus à ce que la spec a mesuré, et il faut comprendre pourquoi avant de continuer.

Ne pas commiter le script.

- [ ] **Step 2 : Écrire le test**

`src/components/Preferences/settingsCoverage.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Non-régression de la refonte : aucun réglage ne doit disparaître.
 *
 * Le relevé `settings-baseline.json` a été figé avant la refonte. Ce test
 * échoue si une de ces clés n'est plus référencée nulle part dans le panneau.
 *
 * Ce qu'il n'attrape PAS, et qui reste à vérifier à l'œil : un réglage encore
 * référencé mais devenu inatteignable, ou dont l'action ne fait plus rien.
 *
 * `preferences.tabs.*` est volontairement hors relevé : la refonte restructure
 * les libellés de navigation, dix onglets devenant six sections.
 */
const DIR = path.join(process.cwd(), 'src/components/Preferences');

function referencedKeys(): Set<string> {
  const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'));
  const src = fs.readdirSync(DIR)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8'))
    .join('\n');

  const keys = new Set<string>();
  for (const m of src.matchAll(/t\(\s*'((?:preferences|admin)\.[a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/t\(\s*`((?:preferences|admin)\.[a-zA-Z0-9_.]+)\.\$\{/g)) {
    let d: unknown = fr;
    for (const part of m[1].split('.')) d = (d as Record<string, unknown>)?.[part];
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d as Record<string, unknown>)) keys.add(`${m[1]}.${k}`);
    }
  }
  return keys;
}

describe('couverture des réglages du panneau Préférences', () => {
  const baseline: string[] = JSON.parse(
    fs.readFileSync(path.join(DIR, 'settings-baseline.json'), 'utf8'),
  );

  it('fige 232 réglages', () => {
    expect(baseline).toHaveLength(232);
  });

  it('référence encore chaque réglage du relevé', () => {
    const found = referencedKeys();
    const missing = baseline.filter((k) => !found.has(k));
    expect(missing, `réglages perdus par la refonte :\n${missing.join('\n')}`).toEqual([]);
  });

  it('chaque réglage du relevé existe dans les 9 locales', () => {
    const locales = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'uk'];
    const missing: string[] = [];
    for (const loc of locales) {
      const json = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), `src/locales/${loc}.json`), 'utf8'),
      );
      for (const key of baseline) {
        let d: unknown = json;
        for (const part of key.split('.')) d = (d as Record<string, unknown>)?.[part];
        if (typeof d !== 'string') missing.push(`${loc}: ${key}`);
      }
    }
    expect(missing, `traductions manquantes :\n${missing.slice(0, 20).join('\n')}`).toEqual([]);
  });
});
```

- [ ] **Step 3 : Lancer le test — il doit PASSER**

```bash
npx vitest run src/components/Preferences/settingsCoverage.test.ts
```
Attendu : 3 tests PASS. C'est l'inverse du TDD habituel : ce test décrit l'état actuel, qu'on veut préserver. S'il échoue maintenant, le relevé est faux.

- [ ] **Step 4 : Vérifier qu'il sait échouer**

Commenter temporairement une ligne `t('preferences.general.inlineVideos')` dans `Preferences.tsx`, relancer le test, constater l'échec avec la clé nommée, puis **rétablir la ligne**. Sans cette vérification, le garde-fou pourrait être vert par construction.

- [ ] **Step 5 : Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/settings-baseline.json src/components/Preferences/settingsCoverage.test.ts
git commit -m "test(preferences): freeze the settings inventory before the rework"
```

---

### Task 2 : Les libellés de sections, dans les 9 locales

**Files:**
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`

**Interfaces:**
- Produces : `preferences.sections.{general,appearance,labels,feeds,offline,admin}` et `preferences.appearance.{theme,colors,sizes,identity}`, plus `preferences.appearance.previewHint`, `.previewReal`, `.previewPreviewOnly`, `.previewNeither`, et `preferences.nav.back`.

> Les anciens libellés `preferences.tabs.*` restent en place pour l'instant : ils
> ne seront retirés qu'à la tâche 12, une fois plus aucun code ne les lisant.

- [ ] **Step 1 : Écrire le script d'insertion**

Créer `/tmp/add-sections-i18n.mjs` (hors dépôt) :

```js
import fs from 'fs';
const S = {
  fr: { general:'Général', appearance:'Apparence', labels:'Étiquettes', feeds:'Flux', offline:'Hors-ligne', admin:'Administration',
        theme:'Thème', colors:'Couleurs', sizes:'Tailles', identity:'Identité', back:'Sections',
        previewHint:'Survolez ou touchez une couleur : sa zone est cerclée dans l’aperçu.',
        previewReal:'Cerclé ici, et encadré sur l’élément réel.',
        previewPreviewOnly:'Trop d’éléments concernés pour l’encadrer dans l’interface. L’aperçu la montre.',
        previewNeither:'Ni l’aperçu ni l’interface ne peuvent la désigner. Le réglage fonctionne.' },
  en: { general:'General', appearance:'Appearance', labels:'Labels', feeds:'Feeds', offline:'Offline', admin:'Administration',
        theme:'Theme', colors:'Colours', sizes:'Sizes', identity:'Identity', back:'Sections',
        previewHint:'Hover or tap a colour: its area is ringed in the preview.',
        previewReal:'Ringed here, and outlined on the real element.',
        previewPreviewOnly:'Too many elements to outline in the interface. The preview shows it.',
        previewNeither:'Neither the preview nor the interface can point at it. The setting still works.' },
  de: { general:'Allgemein', appearance:'Erscheinungsbild', labels:'Etiketten', feeds:'Feeds', offline:'Offline', admin:'Verwaltung',
        theme:'Design', colors:'Farben', sizes:'Größen', identity:'Identität', back:'Bereiche',
        previewHint:'Farbe überfahren oder antippen: Ihr Bereich wird in der Vorschau umrandet.',
        previewReal:'Hier umrandet und am echten Element hervorgehoben.',
        previewPreviewOnly:'Zu viele Elemente für eine Hervorhebung in der Oberfläche. Die Vorschau zeigt sie.',
        previewNeither:'Weder Vorschau noch Oberfläche können darauf zeigen. Die Einstellung wirkt trotzdem.' },
  es: { general:'General', appearance:'Apariencia', labels:'Etiquetas', feeds:'Fuentes', offline:'Sin conexión', admin:'Administración',
        theme:'Tema', colors:'Colores', sizes:'Tamaños', identity:'Identidad', back:'Secciones',
        previewHint:'Pasa el cursor o toca un color: su zona se resalta en la vista previa.',
        previewReal:'Resaltado aquí y marcado en el elemento real.',
        previewPreviewOnly:'Demasiados elementos para marcarlo en la interfaz. La vista previa sí lo muestra.',
        previewNeither:'Ni la vista previa ni la interfaz pueden señalarlo. El ajuste funciona igualmente.' },
  it: { general:'Generale', appearance:'Aspetto', labels:'Etichette', feeds:'Flussi', offline:'Offline', admin:'Amministrazione',
        theme:'Tema', colors:'Colori', sizes:'Dimensioni', identity:'Identità', back:'Sezioni',
        previewHint:'Passa sopra o tocca un colore: la sua zona viene cerchiata nell’anteprima.',
        previewReal:'Cerchiato qui e evidenziato sull’elemento reale.',
        previewPreviewOnly:'Troppi elementi per evidenziarlo nell’interfaccia. L’anteprima lo mostra.',
        previewNeither:'Né l’anteprima né l’interfaccia possono indicarlo. L’impostazione funziona comunque.' },
  nl: { general:'Algemeen', appearance:'Weergave', labels:'Labels', feeds:'Feeds', offline:'Offline', admin:'Beheer',
        theme:'Thema', colors:'Kleuren', sizes:'Groottes', identity:'Identiteit', back:'Secties',
        previewHint:'Beweeg over of tik op een kleur: het gebied wordt omcirkeld in het voorbeeld.',
        previewReal:'Hier omcirkeld en gemarkeerd op het echte element.',
        previewPreviewOnly:'Te veel elementen om in de interface te markeren. Het voorbeeld toont het wel.',
        previewNeither:'Noch het voorbeeld noch de interface kan het aanwijzen. De instelling werkt gewoon.' },
  pl: { general:'Ogólne', appearance:'Wygląd', labels:'Etykiety', feeds:'Kanały', offline:'Offline', admin:'Administracja',
        theme:'Motyw', colors:'Kolory', sizes:'Rozmiary', identity:'Tożsamość', back:'Sekcje',
        previewHint:'Najedź lub dotknij koloru: jego obszar zostanie obwiedziony w podglądzie.',
        previewReal:'Obwiedzione tutaj i wyróżnione na rzeczywistym elemencie.',
        previewPreviewOnly:'Zbyt wiele elementów, by wyróżnić je w interfejsie. Podgląd je pokazuje.',
        previewNeither:'Ani podgląd, ani interfejs nie mogą go wskazać. Ustawienie i tak działa.' },
  pt: { general:'Geral', appearance:'Aparência', labels:'Etiquetas', feeds:'Fontes', offline:'Offline', admin:'Administração',
        theme:'Tema', colors:'Cores', sizes:'Tamanhos', identity:'Identidade', back:'Secções',
        previewHint:'Passe o cursor ou toque numa cor: a zona é destacada na pré-visualização.',
        previewReal:'Destacado aqui e contornado no elemento real.',
        previewPreviewOnly:'Demasiados elementos para contornar na interface. A pré-visualização mostra-a.',
        previewNeither:'Nem a pré-visualização nem a interface a conseguem apontar. A definição funciona à mesma.' },
  uk: { general:'Загальні', appearance:'Вигляд', labels:'Мітки', feeds:'Стрічки', offline:'Офлайн', admin:'Адміністрування',
        theme:'Тема', colors:'Кольори', sizes:'Розміри', identity:'Ідентичність', back:'Розділи',
        previewHint:'Наведіть або торкніться кольору: його зону буде обведено в попередньому перегляді.',
        previewReal:'Обведено тут і виділено на справжньому елементі.',
        previewPreviewOnly:'Забагато елементів, щоб виділити в інтерфейсі. Попередній перегляд показує.',
        previewNeither:'Ні перегляд, ні інтерфейс не можуть вказати на нього. Налаштування працює.' },
};

for (const [loc, s] of Object.entries(S)) {
  const p = `src/locales/${loc}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.preferences = j.preferences || {};
  j.preferences.sections = { general: s.general, appearance: s.appearance, labels: s.labels,
                             feeds: s.feeds, offline: s.offline, admin: s.admin };
  j.preferences.appearance = { theme: s.theme, colors: s.colors, sizes: s.sizes, identity: s.identity,
                               previewHint: s.previewHint, previewReal: s.previewReal,
                               previewPreviewOnly: s.previewPreviewOnly, previewNeither: s.previewNeither };
  j.preferences.nav = { back: s.back };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('ok', loc);
}
```

- [ ] **Step 2 : Exécuter et vérifier la parité**

```bash
node /tmp/add-sections-i18n.mjs
```

Puis la commande de parité du `CLAUDE.md` :

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk"];const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":"parité ok")'
```
Attendu : `parité ok`.

- [ ] **Step 3 : Gates, garde-fou, commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/locales
git commit -m "i18n: add the Preferences section labels"
```

---

### Task 3 : La coque — navigation verticale et largeur décidée

**Files:**
- Modify: `src/components/Preferences/Preferences.tsx`

**Interfaces:**
- Consumes: les libellés `preferences.sections.*` (Task 2).
- Produces: un état `section` valant `'general' | 'appearance' | 'labels' | 'feeds' | 'offline' | 'admin'`, sur lequel toutes les tâches d'extraction s'appuient.

> **Cette tâche ne déplace aucun réglage.** Elle remplace la barre d'onglets par
> une navigation verticale et regroupe les blocs existants derrière les six
> sections. Le contenu reste exactement où il est dans le fichier.

- [ ] **Step 1 : Supprimer la largeur subie**

Dans le `style` du `div` portant `ref={modalRef}` (vers la ligne 293), remplacer :

```ts
          // Hug the tab bar's natural width (the content area is neutralized via
          // w-0/min-w-full so it can't widen the panel), with a floor and viewport cap.
          width: 'fit-content',
          minWidth: 'min(92vw, 460px)',
          maxWidth: '92vw',
```

par :

```ts
          // Largeur décidée, pas subie : elle ne dépend plus du nombre de
          // sections. L'ancien `fit-content` faisait épouser au panneau la
          // largeur de sa barre d'onglets, si bien que chaque onglet ajouté
          // l'élargissait.
          width: 'min(92vw, 680px)',
          maxWidth: '92vw',
```

Et sur le conteneur de contenu (vers la ligne 383), retirer `w-0 min-w-full`, qui n'existait que pour neutraliser cette largeur :

```tsx
        <div className="flex-1 overflow-y-auto px-5 py-4 min-w-0">
```

- [ ] **Step 2 : Remplacer la barre d'onglets par une navigation verticale**

Remplacer la déclaration des onglets (vers la ligne 225) :

```ts
  const baseTabIds = ['general', 'refresh', 'branding', 'colors', 'fonts', 'labels', 'themes', 'shortcuts', 'offline'];
  const tabIds = isAdmin ? ['admin', ...baseTabIds] : baseTabIds;
  const tabs = tabIds.map((id) => ({ id, label: t(`preferences.tabs.${id}`) }));
```

par :

```ts
  const SECTIONS = ['general', 'appearance', 'labels', 'feeds', 'offline'] as const;
  const sections = SECTIONS.map((id) => ({ id, label: t(`preferences.sections.${id}`) }));
```

Et remplacer le bloc `{/* Tabs — single row… */}` (vers les lignes 358-379) par le corps à deux colonnes :

```tsx
        <div className="flex-1 flex min-h-0">
          <nav
            className="w-[178px] flex-shrink-0 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5"
            style={{ borderRight: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}
            aria-label={t('preferences.title')}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setTab(s.id)}
                aria-current={tab === s.id ? 'page' : undefined}
                className="text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors"
                style={{
                  background: tab === s.id ? 'var(--accent)' : 'transparent',
                  color: tab === s.id ? '#ffffff' : 'var(--list-title)',
                  fontWeight: tab === s.id ? 600 : 400,
                }}
              >
                {s.label}
              </button>
            ))}
            {isAdmin && (
              <>
                <div className="h-px mx-2 mt-2.5 mb-0.5" style={{ background: 'var(--panel-border)' }} />
                <button
                  onClick={() => setTab('admin')}
                  aria-current={tab === 'admin' ? 'page' : undefined}
                  className="text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors"
                  style={{
                    background: tab === 'admin' ? 'var(--accent)' : 'transparent',
                    color: tab === 'admin' ? '#ffffff' : 'var(--list-title)',
                    fontWeight: tab === 'admin' ? 600 : 400,
                  }}
                >
                  {t('preferences.sections.admin')}
                </button>
              </>
            )}
          </nav>
          <div className="flex-1 overflow-y-auto px-5 py-4 min-w-0">
```

(La balise fermante du conteneur de contenu existant sert de fermeture ; ajouter un `</div>` supplémentaire pour refermer le `flex-1 flex min-h-0`.)

- [ ] **Step 3 : Regrouper les blocs existants derrière les six sections**

Remplacer les conditions d'affichage. `appearance` regroupe pour l'instant les quatre anciens blocs à la suite ; leur fusion propre viendra à la tâche 8.

```tsx
          {tab === 'general' && (<><GeneralTab /><ShortcutsTab /></>)}
          {tab === 'feeds' && <RefreshTab />}
          {tab === 'labels' && <LabelsColorTab resetLabelColors={resetLabelColors} />}
          {tab === 'offline' && <OfflineTab />}
          {tab === 'admin' && isAdmin && <AdminTab />}
```

Le bloc `appearance` enveloppe les quatre anciens rendus (`BrandingTab`, couleurs, tailles, thèmes) dans un unique `{tab === 'appearance' && (<> … </>)}`, en conservant leur JSX à l'identique.

- [ ] **Step 4 : Corriger l'onglet par défaut**

Vers les lignes 162 et 169, `'branding'` n'existe plus comme identifiant. Remplacer les deux occurrences par `'general'` :

```ts
  const [tab, setTab] = useState<string>(preferencesTab || 'general');
```
```ts
    setTab(preferencesTab || 'general');
```

⚠️ `RefreshBanner.tsx` appelle `openPreferences('refresh')`. Remplacer cet argument par `'feeds'`, sinon le lien du bandeau n'ouvre plus rien.

- [ ] **Step 5 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS, **dont le test de couverture des réglages** — aucun réglage n'a bougé.

- [ ] **Step 6 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/Preferences.tsx src/components/RefreshBanner.tsx
git commit -m "feat(preferences): vertical navigation and a decided panel width"
```

---

### Task 4 : Extraire `AdminTab.tsx`

**Files:**
- Create: `src/components/Preferences/AdminTab.tsx`
- Modify: `src/components/Preferences/Preferences.tsx`

**Interfaces:**
- Produces: `export default function AdminTab()` — aucune prop.

> Déplacement pur : **aucune ligne de logique ne change.** C'est le plus gros
> bloc (620 lignes) et le plus indépendant, donc le meilleur premier découpage.

- [ ] **Step 1 : Déplacer le composant**

Couper de `Preferences.tsx` la fonction `AdminTab()` **et les composants qui ne servent qu'à elle** — repérables par leurs commentaires de section : `/* ── Small text input used in the admin create-user form ── */` et `/* ── Read-only value with a copy button … ── */`. Les coller dans `src/components/Preferences/AdminTab.tsx`, ajouter `export default` devant `function AdminTab`, et reporter en tête du nouveau fichier **uniquement** les imports que ce code utilise réellement (les erreurs de `npm run typecheck` les révèlent une à une).

- [ ] **Step 2 : Importer depuis la coque**

En tête de `Preferences.tsx` :

```ts
import AdminTab from './AdminTab';
```

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS. Si `settingsCoverage` échoue, une clé `admin.*` a été perdue au déplacement — le message nomme laquelle.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/AdminTab.tsx src/components/Preferences/Preferences.tsx
git commit -m "refactor(preferences): extract the administration section"
```

---

### Task 5 : Extraire `OfflineTab.tsx`

**Files:**
- Create: `src/components/Preferences/OfflineTab.tsx`
- Modify: `src/components/Preferences/Preferences.tsx`

**Interfaces:**
- Produces: `export default function OfflineTab()` — aucune prop.

- [ ] **Step 1 : Déplacer le composant**

Couper la fonction `OfflineTab()` de `Preferences.tsx` vers `src/components/Preferences/OfflineTab.tsx`, ajouter `export default`, reporter les imports réellement utilisés.

- [ ] **Step 2 : Importer depuis la coque**

```ts
import OfflineTab from './OfflineTab';
```

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS, 25 clés `preferences.offline.*` toujours référencées.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/OfflineTab.tsx src/components/Preferences/Preferences.tsx
git commit -m "refactor(preferences): extract the offline section"
```

---

### Task 6 : Extraire `LabelsTab.tsx`

**Files:**
- Create: `src/components/Preferences/LabelsTab.tsx`
- Modify: `src/components/Preferences/Preferences.tsx`

**Interfaces:**
- Consumes: `resetLabelColors` du `themeStore`, passé en prop comme aujourd'hui.
- Produces: `export default function LabelsTab({ resetLabelColors }: { resetLabelColors: () => void })`.

- [ ] **Step 1 : Déplacer le composant**

Couper `LabelsColorTab()` **et** le composant `/* ── Label Color Picker — swatches + hex input ── */` qui ne sert qu'à lui, vers `src/components/Preferences/LabelsTab.tsx`. Renommer la fonction en `LabelsTab` et l'exporter par défaut.

- [ ] **Step 2 : Importer et mettre à jour l'appel**

```ts
import LabelsTab from './LabelsTab';
```
```tsx
          {tab === 'labels' && <LabelsTab resetLabelColors={resetLabelColors} />}
```

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS, 22 clés `preferences.labels.*` toujours référencées.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/LabelsTab.tsx src/components/Preferences/Preferences.tsx
git commit -m "refactor(preferences): extract the labels section"
```

---

### Task 7 : `GeneralTab.tsx` — langue, lecture, raccourcis

**Files:**
- Create: `src/components/Preferences/GeneralTab.tsx`
- Modify: `src/components/Preferences/Preferences.tsx`

**Interfaces:**
- Produces: `export default function GeneralTab()` — aucune prop.

> Première **fusion**, pas un simple déplacement : trois blocs venant de trois
> endroits différents deviennent une seule section à trois groupes.

- [ ] **Step 1 : Créer le fichier avec les trois groupes**

Déplacer dans `src/components/Preferences/GeneralTab.tsx` :

1. le corps de l'actuelle `GeneralTab()` (les deux interrupteurs) ;
2. le bloc **langue** extrait de `BrandingTab()` — le `<h3>` portant `t('preferences.branding.language')` et la liste des neuf langues qui le suit ;
3. le corps de `ShortcutsTab()`.

Les trois se suivent dans un unique `<div className="space-y-5">`, chacun sous son propre `<h3>` repris du bloc d'origine.

**La clé `preferences.branding.language` est conservée telle quelle** : la déplacer sans la renommer évite de toucher les neuf locales, et le garde-fou l'exige.

- [ ] **Step 2 : Redessiner le sélecteur de langue**

Le sélecteur actuel n'affiche que drapeau + code, le nom complet n'étant qu'en `title`. Le remplacer par une grille de trois colonnes avec le nom écrit dans sa propre langue :

```tsx
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { code: 'fr', flag: '🇫🇷', name: 'Français' },
          { code: 'en', flag: '🇬🇧', name: 'English' },
          { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
          { code: 'es', flag: '🇪🇸', name: 'Español' },
          { code: 'it', flag: '🇮🇹', name: 'Italiano' },
          { code: 'pt', flag: '🇵🇹', name: 'Português' },
          { code: 'nl', flag: '🇳🇱', name: 'Nederlands' },
          { code: 'pl', flag: '🇵🇱', name: 'Polski' },
          { code: 'uk', flag: '🇺🇦', name: 'Українська' },
        ].map((lang) => (
          <button
            key={lang.code}
            lang={lang.code}
            onClick={async () => {
              await loadLanguage(lang.code);
              i18n.changeLanguage(lang.code);
              localStorage.setItem('frirss_language', lang.code);
            }}
            aria-pressed={i18n.language === lang.code}
            className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs min-h-[44px]"
            style={{
              border: `1px solid ${i18n.language === lang.code ? 'var(--accent)' : 'var(--panel-border)'}`,
              background: i18n.language === lang.code ? 'var(--list-selected)' : 'transparent',
              color: 'var(--list-title)',
              fontWeight: i18n.language === lang.code ? 600 : 400,
            }}
          >
            <span aria-hidden="true" className="text-base leading-none flex-shrink-0">{lang.flag}</span>
            <span className="truncate">{lang.name}</span>
          </button>
        ))}
      </div>
```

`min-h-[44px]` n'est pas décoratif : c'est la cible tactile minimale, et ce panneau s'utilise au doigt.

- [ ] **Step 3 : Importer et brancher**

```ts
import GeneralTab from './GeneralTab';
```
```tsx
          {tab === 'general' && <GeneralTab />}
```

Retirer l'ancien `<ShortcutsTab />` du rendu de la section `general` mis en place à la tâche 3.

- [ ] **Step 4 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS. Le garde-fou couvre ici trois familles à la fois : `preferences.general.*` (5), `preferences.shortcuts.*` (26) et `preferences.branding.language`.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/GeneralTab.tsx src/components/Preferences/Preferences.tsx
git commit -m "feat(preferences): gather language, reading and shortcuts under General"
```

---

### Task 8 : `AppearanceTab.tsx` — thème, couleurs, tailles, identité

**Files:**
- Create: `src/components/Preferences/AppearanceTab.tsx`
- Create: `src/components/Preferences/colorHighlight.ts`
- Modify: `src/components/Preferences/Preferences.tsx`

**Interfaces:**
- Consumes: du `themeStore` — `theme`, `savedThemes`, `setColor`, `setFontSize`, `setThemeName`, `saveCurrentTheme`, `loadSavedTheme`, `deleteSavedTheme`, `exportTheme`, `importTheme`, `resetColors`, `resetColor`, `isColorModified`, `resetFontSizes`.
- Produces: `export default function AppearanceTab({ onHighlight }: { onHighlight: (key: string | null) => void })` — la coque garde la responsabilité de l'overlay sur l'interface réelle.

> C'est la tâche la plus lourde : quatre blocs deviennent une section à
> sous-navigation. **Le mécanisme de survol existant n'est pas touché** — la
> prop `onHighlight` continue d'alimenter `COLOR_HIGHLIGHT_MAP` dans la coque.

- [ ] **Step 1 : Créer le fichier avec sa sous-navigation**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Sub = 'theme' | 'colors' | 'sizes' | 'identity';

export default function AppearanceTab({ onHighlight }: { onHighlight: (key: string | null) => void }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState<Sub>('colors');
  const SUBS: Sub[] = ['theme', 'colors', 'sizes', 'identity'];

  return (
    <div>
      <div className="flex gap-1 mb-3.5" style={{ borderBottom: '1px solid var(--panel-border)' }}>
        {SUBS.map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            aria-current={sub === s ? 'true' : 'false'}
            className="px-2.5 py-2 text-xs -mb-px min-h-[44px]"
            style={{
              color: sub === s ? 'var(--list-title)' : 'var(--list-summary)',
              fontWeight: sub === s ? 600 : 400,
              borderBottom: `2px solid ${sub === s ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            {t(`preferences.appearance.${s}`)}
          </button>
        ))}
      </div>
      {sub === 'theme' && <ThemeSection />}
      {sub === 'colors' && <ColorsSection onHighlight={onHighlight} />}
      {sub === 'sizes' && <SizesSection />}
      {sub === 'identity' && <IdentitySection />}
    </div>
  );
}
```

- [ ] **Step 2 : Remplir les quatre sous-sections par déplacement**

Chaque sous-section reçoit le JSX existant, **inchangé** :

- `ThemeSection` : le bloc `{tab === 'themes' && ( … )}` de `Preferences.tsx` (thème actif, enregistrer, charger, supprimer, exporter, importer, partager).
- `ColorsSection` : le bloc `{tab === 'colors' && ( … )}`, avec ses `COLOR_SECTIONS`, ses `ColorRow` et son `TabResetButton`. `COLOR_SECTIONS` et `ColorRow` se déplacent dans ce fichier.
- `SizesSection` : le bloc `{tab === 'fonts' && ( … )}` avec `FONT_SECTIONS`.
- `IdentitySection` : le corps de `BrandingTab()` **privé de son bloc langue**, parti à la tâche 7. Tout le reste — nom de l'app, réinitialisation, choix de fichier, logo actuel, URL, mode d'affichage complet/compact, aperçu — reste ici.

**`COLOR_HIGHLIGHT_MAP` sort dans son propre module**,
`src/components/Preferences/colorHighlight.ts`, exportant la carte et un
prédicat :

```ts
/** Sélecteur CSS de l'élément réel à encadrer, ou null quand il y en a trop. */
export const COLOR_HIGHLIGHT_MAP: Record<string, string | null> = { /* déplacé tel quel depuis Preferences.tsx */ };

/** Vrai si cette couleur peut être encadrée sur l'interface réelle. */
export function hasRealHighlight(key: string): boolean {
  return COLOR_HIGHLIGHT_MAP[key] != null;
}
```

C'est nécessaire, pas cosmétique : la coque importe `AppearanceTab`, donc si
`AppearanceTab` importait la carte depuis la coque, on créerait un cycle
d'imports. `Preferences.tsx` importe désormais la carte depuis ce module, comme
`AppearanceTab`.

- [ ] **Step 3 : Brancher depuis la coque**

```ts
import AppearanceTab from './AppearanceTab';
```
```tsx
          {tab === 'appearance' && <AppearanceTab onHighlight={setHighlightKey} />}
```

- [ ] **Step 4 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS. Le garde-fou couvre ici 36 `colorKeys` + 6 `colorSections` + 7 `fontKeys` + 3 `fontSections` + 11 `themes` + 18 `branding` restantes.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/AppearanceTab.tsx src/components/Preferences/colorHighlight.ts src/components/Preferences/Preferences.tsx
git commit -m "feat(preferences): gather theme, colours, sizes and identity under Appearance"
```

---

### Task 9 : Renommer `RefreshTab.tsx` en `FeedsTab.tsx`

**Files:**
- Rename: `src/components/Preferences/RefreshTab.tsx` → `src/components/Preferences/FeedsTab.tsx`
- Modify: `src/components/Preferences/Preferences.tsx`

**Interfaces:**
- Produces: `export default function FeedsTab()` — aucune prop.

- [ ] **Step 1 : Renommer en conservant l'historique**

```bash
git mv src/components/Preferences/RefreshTab.tsx src/components/Preferences/FeedsTab.tsx
```

Renommer la fonction `RefreshTab` en `FeedsTab` dans le fichier. **Ne rien changer d'autre** : les clés `preferences.refresh.*` restent, le jeton, le test et la logique de sondage aussi.

- [ ] **Step 2 : Mettre à jour l'import**

```ts
import FeedsTab from './FeedsTab';
```
```tsx
          {tab === 'feeds' && <FeedsTab />}
```

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS, 7 clés `preferences.refresh.*` toujours référencées.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add -A src/components/Preferences
git commit -m "refactor(preferences): rename the refresh section to Feeds"
```

---

### Task 10 : L'aperçu en direct et son couplage

**Files:**
- Create: `src/components/Preferences/ThemePreview.tsx`
- Modify: `src/components/Preferences/AppearanceTab.tsx`

**Interfaces:**
- Consumes: `focusedKey: string | null` — la clé de couleur survolée ou sélectionnée.
- Produces: `export default function ThemePreview({ focusedKey }: { focusedKey: string | null })`, et `export const PREVIEW_ZONES: Record<string, string>` — la carte clé de couleur → zone de l'aperçu, lue par `AppearanceTab` pour choisir la légende.

- [ ] **Step 1 : Créer la miniature**

`src/components/Preferences/ThemePreview.tsx` :

```tsx
import { useTranslation } from 'react-i18next';

/**
 * Miniature de FriRSS, recomposée en direct par les variables CSS du thème.
 *
 * Elle complète l'encadrement de l'élément réel (COLOR_HIGHLIGHT_MAP dans la
 * coque) sans le remplacer : celui-ci répond à « où », celle-ci à « de quoi ça
 * aura l'air ». Elle couvre notamment `accent` et `accent-dark`, que
 * l'encadrement réel ne sait pas montrer (trop d'éléments concernés).
 *
 * Règle de conception : ne rien éteindre autour de la zone visée. Une version
 * qui assombrissait le reste a été jugée illisible — on perd le contexte au
 * moment où on en a besoin. Un anneau et une étiquette suffisent.
 */
export const PREVIEW_ZONES: Record<string, string> = {
  'sidebar-bg': 'sidebar-bg',
  'sidebar-header-from': 'sidebar-header',
  'sidebar-header-to': 'sidebar-header',
  'sidebar-text': 'sidebar-text',
  'sidebar-text-active': 'sidebar-text-active',
  accent: 'accent',
  'accent-dark': 'sidebar-header',
  'panel-bg': 'panel-bg',
  'list-selected': 'list-selected',
  'list-source': 'list-source',
  'list-title': 'list-title',
  'list-summary': 'list-summary',
  'reading-title': 'reading-title',
  'reading-text': 'reading-text',
};

export default function ThemePreview({ focusedKey }: { focusedKey: string | null }) {
  const { t } = useTranslation();
  const zone = focusedKey ? PREVIEW_ZONES[focusedKey] : undefined;
  const on = (names: string) => (zone && names.split(' ').includes(zone) ? 'preview-zone preview-zone--on' : 'preview-zone');

  return (
    <div
      className="preview rounded-lg overflow-hidden flex mb-1.5"
      style={{ border: '1px solid var(--panel-border)', height: 168 }}
      aria-label={t('preferences.appearance.previewHint')}
    >
      <div className={`${on('sidebar-bg')} flex-shrink-0`} style={{ width: 92, background: 'var(--sidebar-bg)' }}>
        <div className={on('sidebar-header accent')} style={{ height: 30, background: 'linear-gradient(135deg, var(--sidebar-header-from), var(--sidebar-header-to))' }} />
        <div className={on('sidebar-text-active')} style={{ height: 7, margin: '9px 10px', borderRadius: 3, background: 'var(--sidebar-text-active)', opacity: 0.95 }} />
        <div className={on('sidebar-text')} style={{ height: 7, margin: '9px 10px', borderRadius: 3, background: 'var(--sidebar-text)', opacity: 0.6 }} />
        <div className={on('sidebar-text')} style={{ height: 7, margin: '9px 10px', borderRadius: 3, background: 'var(--sidebar-text)', opacity: 0.6 }} />
      </div>
      <div className={`${on('panel-bg')} flex-shrink-0 p-2.5`} style={{ width: 148, borderRight: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
        <div className={`${on('list-selected')} p-1.5 rounded`} style={{ background: 'var(--list-selected)', marginBottom: 5 }}>
          <div className={on('list-source accent')} style={{ height: 5, width: '44%', background: 'var(--list-source)', borderRadius: 3, marginBottom: 4 }} />
          <div className={on('list-title')} style={{ height: 6, width: '88%', background: 'var(--list-title)', borderRadius: 3, marginBottom: 4, opacity: 0.88 }} />
          <div className={on('list-summary')} style={{ height: 5, width: '66%', background: 'var(--list-summary)', borderRadius: 3, opacity: 0.55 }} />
        </div>
        <div className="p-1.5">
          <div className={on('list-source accent')} style={{ height: 5, width: '44%', background: 'var(--list-source)', borderRadius: 3, marginBottom: 4 }} />
          <div className={on('list-title')} style={{ height: 6, width: '88%', background: 'var(--list-title)', borderRadius: 3, marginBottom: 4, opacity: 0.88 }} />
          <div className={on('list-summary')} style={{ height: 5, width: '66%', background: 'var(--list-summary)', borderRadius: 3, opacity: 0.55 }} />
        </div>
      </div>
      <div className={`${on('panel-bg')} flex-1 p-3`} style={{ background: 'var(--panel-bg)' }}>
        <div className={on('reading-title')} style={{ height: 9, width: '74%', background: 'var(--reading-title)', borderRadius: 3, marginBottom: 9 }} />
        <div className={on('reading-text')} style={{ height: 5, width: '96%', background: 'var(--reading-text)', borderRadius: 3, marginBottom: 5, opacity: 0.45 }} />
        <div className={on('reading-text')} style={{ height: 5, width: '90%', background: 'var(--reading-text)', borderRadius: 3, marginBottom: 5, opacity: 0.45 }} />
        <div className={on('reading-text')} style={{ height: 5, width: '62%', background: 'var(--reading-text)', borderRadius: 3, opacity: 0.45 }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Styler l'anneau**

Dans `src/styles/index.css`, à la suite des règles du panneau :

```css
/* Aperçu du thème : la zone visée est cerclée, rien n'est éteint autour —
   assombrir le reste s'est révélé illisible à l'usage. */
.preview-zone { transition: box-shadow .12s; }
.preview-zone--on {
  box-shadow: 0 0 0 2px var(--panel-bg), 0 0 0 4px var(--reading-title);
  border-radius: 3px;
  position: relative;
  z-index: 2;
}
```

- [ ] **Step 3 : Brancher survol ET sélection dans `ColorsSection`**

Dans `AppearanceTab.tsx`, tenir un état local et le donner à l'aperçu :

```tsx
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const shown = focusedKey ?? pinnedKey;
```

Monter l'aperçu **en tête de `ColorsSection` et de `SizesSection`** — la spec
prévoit qu'il se recompose « à chaque changement de couleur ou de taille », et
c'est dans Tailles qu'il n'existe aujourd'hui aucun retour visuel :

```tsx
      <ThemePreview focusedKey={shown} />
```

Dans `SizesSection`, le monter avec `focusedKey={null}` : les tailles n'ont pas
de zone à désigner, mais l'aperçu suit les variables de police en direct.

L'état `focusedKey` / `pinnedKey` vit dans `AppearanceTab` et descend en prop
vers `ColorsSection`, afin qu'un seul aperçu serve les deux sous-sections.

Chaque `ColorRow` reçoit, en plus de son `onHighlight` actuel :

- `onMouseEnter` → `setFocusedKey(key)` **et** `onHighlight(key)` (inchangé) ;
- `onMouseLeave` → `setFocusedKey(null)` **et** `onHighlight(null)` ;
- `onClick` sur la ligne → `setPinnedKey(key === pinnedKey ? null : key)`.

Le clic est ce qui rend le mécanisme utilisable au doigt : sans lui, la mise en évidence n'existe pas sur téléphone, où `mouseenter` ne se produit jamais. Ne pas le conditionner à la largeur d'écran — une tablette avec un clavier reste au pointeur fin.

- [ ] **Step 4 : Afficher la légende honnête**

Sous l'aperçu, dans `ColorsSection` :

```tsx
      <p className="text-[11px] mb-3" style={{ color: 'var(--list-summary)' }}>
        {!shown
          ? t('preferences.appearance.previewHint')
          : PREVIEW_ZONES[shown]
            ? (hasRealHighlight(shown)
                ? t('preferences.appearance.previewReal')
                : t('preferences.appearance.previewPreviewOnly'))
            : t('preferences.appearance.previewNeither')}
      </p>
```

`hasRealHighlight` vient du module créé à la tâche 8 :

```ts
import { hasRealHighlight } from './colorHighlight';
```

Six couleurs — séparateur, bordures, danger, fond d'alerte et les deux barres de défilement — n'ont ni zone d'aperçu ni encadrement réel. La légende le dit, plutôt que de laisser croire à une mise en évidence qui n'arrive pas.

- [ ] **Step 5 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS.

- [ ] **Step 6 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/ThemePreview.tsx src/components/Preferences/AppearanceTab.tsx src/components/Preferences/Preferences.tsx src/styles/index.css
git commit -m "feat(preferences): live theme preview, on hover and on tap"
```

---

### Task 11 : Téléphone et tablette

**Files:**
- Modify: `src/components/Preferences/Preferences.tsx`
- Modify: `src/styles/index.css`

**Interfaces:**
- Consumes: `useBreakpoint()` de `src/hooks/useBreakpoint.ts`, qui renvoie `'mobile' | 'tablet' | 'desktop'`.

> Le panneau n'a **aujourd'hui aucune gestion du mobile** — aucun appel à
> `useBreakpoint()` — alors que `Sidebar`, `ArticleList`, `ReadingPane` et
> `ServerSwitcher` en ont tous une. Cette tâche comble ce trou.

- [ ] **Step 1 : Navigation en profondeur sur téléphone**

Dans `Preferences.tsx` :

```ts
import { useBreakpoint } from '../../hooks/useBreakpoint';
```
```ts
  const isMobile = useBreakpoint() === 'mobile';
  const [showNav, setShowNav] = useState(true);
```

Sur mobile, on affiche **soit** la liste des sections, **soit** le contenu :

- la `<nav>` reçoit `hidden={isMobile && !showNav}` et, sur mobile, occupe toute la largeur (`w-full` au lieu de `w-[178px]`, sans bordure droite) ;
- le conteneur de contenu reçoit `hidden={isMobile && showNav}` ;
- choisir une section appelle `setShowNav(false)` en plus de `setTab(...)` ;
- en tête du contenu, sur mobile uniquement, un bouton de retour :

```tsx
            {isMobile && (
              <button
                onClick={() => setShowNav(true)}
                className="flex items-center gap-1.5 mb-3 text-xs min-h-[44px]"
                style={{ color: 'var(--list-summary)' }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                {t('preferences.nav.back')}
              </button>
            )}
```

Sur tablette et desktop, `showNav` est sans effet : les deux colonnes restent affichées.

- [ ] **Step 2 : Largeur et zones sûres**

Le panneau est déjà `fixed inset-0`. Sur mobile il doit occuper toute la largeur et dégager encoche et indicateur d'accueil :

```ts
          width: isMobile ? '100vw' : 'min(92vw, 680px)',
          maxWidth: '100vw',
```

Et dans `src/styles/index.css`, à la suite des règles d'aperçu :

```css
/* Le panneau couvre tout l'écran sur téléphone : il doit dégager l'encoche en
   haut et l'indicateur d'accueil en bas. Le dépôt possède déjà cet idiome pour
   la barre latérale et l'en-tête de liste — on le réutilise. */
@media (max-width: 767px) {
  .prefs-panel-head { padding-top: max(0.75rem, env(safe-area-inset-top)); }
  .prefs-panel-body { padding-bottom: env(safe-area-inset-bottom); }
}
```

Ajouter `prefs-panel-head` sur l'en-tête du panneau et `prefs-panel-body` sur le conteneur à deux colonnes.

**Ne pas toucher à la règle de hauteur** `100dvh` / `100vh` sous
`@media (display-mode: standalone)` déjà présente et commentée dans `index.css` :
elle existe parce que `dvh` est calculé un peu court en standalone iOS et laisse
une bande blanche.

- [ ] **Step 3 : Cibles tactiles**

Vérifier que chaque contrôle interactif du panneau atteint 44 pt de haut sur mobile : entrées de navigation, lignes de couleur, sélecteur natif, boutons de sous-navigation. Les lignes de couleur en particulier font aujourd'hui ~30 px — leur ajouter `min-h-[44px]` sous le point de rupture mobile.

- [ ] **Step 4 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/Preferences.tsx src/styles/index.css
git commit -m "feat(preferences): make the panel usable on phone and tablet"
```

---

### Task 12 : Nettoyage et vérification finale

**Files:**
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`
- Modify: `src/components/Preferences/settingsCoverage.test.ts`

- [ ] **Step 1 : Vérifier qu'aucun code ne lit plus les anciens libellés**

```bash
grep -rn "preferences.tabs" src/
```
Attendu : **aucune** occurrence. S'il en reste, les traiter avant de supprimer les clés.

- [ ] **Step 2 : Retirer `preferences.tabs` des 9 locales**

Script jetable `/tmp/drop-tabs-i18n.mjs` :

```js
import fs from 'fs';
for (const loc of ['fr','en','de','es','it','nl','pl','pt','uk']) {
  const p = `src/locales/${loc}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete j.preferences.tabs;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('ok', loc);
}
```

```bash
node /tmp/drop-tabs-i18n.mjs
```

Puis la commande de parité du `CLAUDE.md` — attendu : `parité ok`.

- [ ] **Step 3 : Consigner le retrait dans le test**

Ajouter à `settingsCoverage.test.ts` :

```ts
  it('a bien retiré les anciens libellés d’onglets, seul retrait assumé', () => {
    const fr = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'),
    );
    expect(fr.preferences.tabs).toBeUndefined();
  });
```

- [ ] **Step 4 : Gates complets**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : tout vert, dont les quatre tests de couverture.

- [ ] **Step 5 : Mesurer le résultat**

```bash
wc -l src/components/Preferences/*.tsx
```
Attendu : `Preferences.tsx` nettement sous 500 lignes, chaque section dans son fichier. Consigner les chiffres dans le rapport.

- [ ] **Step 6 : Garde-fou, commit, push**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/locales src/components/Preferences/settingsCoverage.test.ts
git commit -m "chore(preferences): drop the retired tab labels"
git push
```

- [ ] **Step 7 : Vérifier les DEUX workflows**

```bash
gh run list --branch dev --limit 4
```
`CI` **et** `Publish image` doivent être verts. Le garde-fou de fuite tourne dans `CI` avant lint/typecheck/tests : un `CI` rouge ne signifie pas forcément que le code est cassé.

- [ ] **Step 8 : Revue écran par écran — ce que le test ne sait pas voir**

Le garde-fou prouve qu'aucune clé n'a disparu. Il ne prouve **ni** qu'un réglage
reste atteignable, **ni** qu'il agit encore. Parcourir les six sections et
cocher, pour chacune, que les réglages du relevé sont visibles et opérants.
Porter une attention particulière à :

- Apparence → Identité : choix de fichier, logo actuel, réinitialisation, mode complet/compact — 18 clés `branding` faciles à perdre de vue ;
- Étiquettes : renommer, supprimer, imbriquer par glisser-déposer, hériter, appliquer aux sous-étiquettes ;
- Administration : configuration SSO complète, URL break-glass, animation de connexion, réinitialisation de mot de passe.

- [ ] **Step 9 : Contrôle sur appareil réel**

Sur un **iPhone, en PWA installée** — pas au simulateur de largeur :

1. navigation à deux niveaux et retour ;
2. en-tête sous l'encoche, bas dégagé de l'indicateur d'accueil, aucune bande blanche ;
3. **toucher une couleur la sélectionne** et cercle sa zone dans l'aperçu ;
4. cibles tactiles confortables ;
5. rendu de `<input type="color">` en standalone iOS — s'il est inutilisable, le signaler : le champ hexadécimal devient le chemin principal sur mobile ;
6. le clavier ne masque pas le champ hexadécimal en saisie ;
7. l'aperçu reste lisible à 375 pt.

Sur **tablette**, vérifier que les deux colonnes tiennent et que le survol
fonctionne toujours avec un pointeur.

---

## Notes pour l'implémenteur

- **Le test de la tâche 1 est la boussole.** S'il devient rouge à une tâche, un réglage a été perdu au déplacement : le message nomme la clé. Ne jamais le contourner en modifiant le relevé.
- **Les tâches 4 à 6 sont des déplacements purs.** Aucune ligne de logique ne change. Si l'envie vient de « nettoyer au passage », ne pas y céder : ça masquerait une perte de réglage dans le bruit du diff.
- **Le survol existant n'est pas remplacé.** `COLOR_HIGHLIGHT_MAP` et son overlay restent dans la coque ; l'aperçu s'ajoute. Les deux répondent à des questions différentes.
- **Ne pas conditionner le survol à la largeur d'écran.** Une tablette avec clavier et trackpad est au pointeur fin. Le clic de la tâche 10 sert tout le monde ; c'est lui qui rend la fonctionnalité accessible au doigt.
- **Trois formats, toujours.** Desktop, tablette, téléphone. Une interaction qui n'existe qu'au survol n'existe pas sur la moitié des appareils de l'utilisateur.
