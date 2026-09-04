import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Only the default/fallback locale is bundled in the main chunk.
// Every other language is a separate chunk loaded on demand.
import fr from './locales/fr.json';

type LocaleModule = { default: Record<string, unknown> };

const loaders: Record<string, () => Promise<LocaleModule>> = {
  en: () => import('./locales/en.json'),
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  it: () => import('./locales/it.json'),
  pt: () => import('./locales/pt.json'),
  nl: () => import('./locales/nl.json'),
  pl: () => import('./locales/pl.json'),
  uk: () => import('./locales/uk.json'),
};

const SUPPORTED_LANGUAGES = ['fr', ...Object.keys(loaders)];

/**
 * Pick the language to start in: the user's saved choice, else the browser's
 * language (matched on its primary subtag, e.g. `en-US` → `en`), else English.
 * Used both to init i18next and to preload the right bundle before first paint.
 */
export function resolveInitialLanguage(): string {
  const stored = localStorage.getItem('frirss_language');
  if (stored && SUPPORTED_LANGUAGES.includes(stored)) return stored;
  const candidates =
    typeof navigator !== 'undefined'
      ? [navigator.language, ...(navigator.languages || [])]
      : [];
  for (const c of candidates) {
    if (!c) continue;
    const primary = c.toLowerCase().split('-')[0];
    if (SUPPORTED_LANGUAGES.includes(primary)) return primary;
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr } },
  lng: resolveInitialLanguage(),
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false, // React already escapes
  },
});

/**
 * Déclare la langue courante sur `<html>`.
 *
 * `index.html` fige `lang="fr"` — c'est un fichier statique servi par nginx,
 * on ne peut pas faire mieux avant l'exécution du bundle — et rien ne le
 * mettait à jour ensuite. Le document annonçait donc « ceci est du français »
 * à un lecteur polonais ou néerlandais, dès le premier écran.
 *
 * Ce que ça change concrètement : les lecteurs d'écran choisissent leur voix et
 * leurs règles de prononciation sur cet attribut — une interface polonaise lue
 * par une voix française n'est pas « moins bonne », elle est inintelligible.
 * S'y ajoutent le correcteur orthographique des champs de saisie et les
 * sélecteurs `:lang()`.
 *
 * Branché ici plutôt que dans le sélecteur de langue des réglages : c'est le
 * seul endroit qui connaît la langue **à l'initialisation** comme à chaque
 * changement, d'où qu'il vienne.
 *
 * Pas de `dir` : les neuf langues d'interface s'écrivent de gauche à droite.
 * Le sens d'écriture ne concerne que le **contenu** des articles, où il est
 * porté bloc par bloc par `dir="auto"` (`src/lib/articleBody.ts`).
 */
if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language;
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
}

/**
 * Load a language bundle on demand. No-op for `fr` (bundled) or an
 * already-loaded language. Await this before calling changeLanguage().
 */
export async function loadLanguage(lng: string | null | undefined): Promise<void> {
  if (!lng || lng === 'fr' || i18n.hasResourceBundle(lng, 'translation')) return;
  const mod = await loaders[lng]?.();
  if (mod) i18n.addResourceBundle(lng, 'translation', mod.default, true, true);
}

export default i18n;
