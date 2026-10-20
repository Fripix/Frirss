import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { AI_LANGUAGES, isAiLanguage, languageName, targetLanguage } from '../../../lib/aiLanguages';
import type { AiProviderView } from '../../../api/backend';
import { BlockTitle, ProviderOptions } from './shared';
import { inputClass, inputStyle } from './styles';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];

/**
 * Bloc « Traduction » : la langue cible — « Langue de l'interface (X) » en
 * tête, puis les 28 langues de la liste fermée, nommées par
 * `Intl.DisplayNames` dans la langue de l'interface et triées par ce nom —,
 * puis le fournisseur, « Même que le résumé » par défaut.
 */
export default function TranslationBlock() {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const uiLang = i18n?.language || 'en';
  const language = useUiStore((s) => s.aiTranslationLanguage);
  const setLanguage = useUiStore((s) => s.setAiTranslationLanguage);
  const provider = useUiStore((s) => s.aiTranslationProvider);
  const setProvider = useUiStore((s) => s.setAiTranslationProvider);
  const providers = useAiStore((s) => s.config?.providers) ?? NO_PROVIDERS;
  const languages = useMemo(
    () => AI_LANGUAGES.map((code) => ({ code, name: languageName(code, uiLang) })).sort((a, b) => a.name.localeCompare(b.name, uiLang)),
    [uiLang],
  );
  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.translation.title')}</BlockTitle>
      <div>
        <label htmlFor={`${uid}-language`} className="block text-sm mb-1" style={{ color: 'var(--list-title)' }}>{t('ai.translation.language')}</label>
        <select
          id={`${uid}-language`} value={language} className={inputClass} style={inputStyle}
          onChange={(e) => setLanguage(isAiLanguage(e.target.value) ? e.target.value : 'ui')}
        >
          <option value="ui">{t('ai.translation.uiLanguage', { name: languageName(targetLanguage(uiLang), uiLang) })}</option>
          {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${uid}-provider`} className="block text-sm mb-1" style={{ color: 'var(--list-title)' }}>{t('ai.translation.provider')}</label>
        <select
          id={`${uid}-provider`} value={provider === null ? '' : String(provider)} className={inputClass} style={inputStyle}
          onChange={(e) => setProvider(e.target.value ? Number(e.target.value) : null)}
        >
          <ProviderOptions providers={providers} value={provider} defaultLabel={t('ai.translation.sameAsSummary')} />
        </select>
      </div>
    </section>
  );
}
