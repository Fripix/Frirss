import { useTranslation } from 'react-i18next';
import { loadLanguage } from '../../i18n';
import AccountSection from './AccountSection';
import { PrefHeading } from './prefsUi';

/**
 * Préférences → Compte : la langue de l'interface, puis le mot de passe et le
 * rattachement au SSO (comptes locaux seulement, voir `AccountSection`).
 */
export default function AccountTab() {
  const { t, i18n } = useTranslation();
  return (
    <div>
      <div>
        <PrefHeading>{t('preferences.branding.language')}</PrefHeading>
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
            { code: 'zh', flag: '🇨🇳', name: '简体中文' },
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
              aria-label={lang.name}
              title={lang.name}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-[13px] min-h-[44px]"
              style={{
                border: `1px solid ${i18n.language === lang.code ? 'var(--accent)' : 'var(--panel-border)'}`,
                background: i18n.language === lang.code ? 'var(--list-selected)' : 'transparent',
                color: 'var(--list-title)',
                fontWeight: i18n.language === lang.code ? 600 : 400,
              }}
            >
              <span aria-hidden="true" className="text-base leading-none flex-shrink-0">{lang.flag}</span>
              <span aria-hidden="true">{lang.code.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>
      <AccountSection />
    </div>
  );
}
