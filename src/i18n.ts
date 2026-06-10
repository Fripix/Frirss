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

export const SUPPORTED_LANGUAGES = ['fr', ...Object.keys(loaders)];

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr } },
  lng: localStorage.getItem('frirss_language') || 'fr',
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false, // React already escapes
  },
});

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
