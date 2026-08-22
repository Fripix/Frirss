import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PREVIEW_ZONES } from './colorHighlight';

/**
 * Miniature de FriRSS, recomposée en direct par les variables CSS du thème.
 *
 * Elle complète l'encadrement de l'élément réel (COLOR_HIGHLIGHT_MAP dans
 * colorHighlight.ts, lu par la coque) sans le remplacer : celui-ci répond à
 * « où », celle-ci à « de quoi ça aura l'air ». Les zones qu'elle sait
 * désigner sont listées dans `PREVIEW_ZONES`, à côté de cette carte.
 *
 * La carte d'article et le corps de lecture portent du vrai texte, dimensionné
 * par les mêmes `--fs-*` que `ArticleList` et `ReadingPane` (voir
 * `applyThemeToDOM` dans themeStore.ts, qui pose ces variables sur
 * `document.documentElement`) — pas des barres décoratives. C'est ce qui rend
 * la sous-section Tailles vivante : sans texte réel, aucun curseur de taille
 * n'y déplaçait quoi que ce soit.
 */
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
        <div className={on('sidebar-header accent')} style={{ height: 30, background: 'var(--sidebar-header-bg)' }} />
        <div className={on('sidebar-text-active')} style={{ height: 7, margin: '9px 10px', borderRadius: 3, background: 'var(--sidebar-text-active)', opacity: 0.95 }} />
        <div className={on('sidebar-text')} style={{ height: 7, margin: '9px 10px', borderRadius: 3, background: 'var(--sidebar-text)', opacity: 0.6 }} />
        <div className={on('sidebar-text')} style={{ height: 7, margin: '9px 10px', borderRadius: 3, background: 'var(--sidebar-text)', opacity: 0.6 }} />
      </div>
      <div className={`${on('panel-bg')} flex-shrink-0 p-2.5`} style={{ width: 148, borderRight: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
        <div className={`${on('list-selected')} p-1.5 rounded`} style={{ background: 'var(--list-selected)', marginBottom: 5 }}>
          <PreviewCardText on={on} t={t} />
        </div>
        <div className="p-1.5">
          <PreviewCardText on={on} t={t} />
        </div>
      </div>
      <div className={`${on('panel-bg')} flex-1 p-3`} style={{ background: 'var(--panel-bg)', overflow: 'hidden' }}>
        <div className={on('reading-title')} style={{ height: 9, width: '74%', background: 'var(--reading-title)', borderRadius: 3, marginBottom: 9 }} />
        <p
          className={`${on('reading-text')} line-clamp-2`}
          style={{ fontSize: 'var(--fs-reading-body)', lineHeight: 1.5, color: 'var(--reading-text)', margin: 0 }}
        >
          {t('preferences.appearance.previewBody')}
        </p>
      </div>
    </div>
  );
}

/** Source, titre et résumé d'une carte d'article — mêmes styles que ArticleList. */
function PreviewCardText({ on, t }: { on: (names: string) => string; t: TFunction }) {
  return (
    <>
      <div
        className={`${on('list-source accent')} truncate`}
        style={{
          fontSize: 'var(--fs-list-source)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          color: 'var(--list-source)',
          lineHeight: 1.2,
          marginBottom: 4,
        }}
      >
        {t('preferences.appearance.previewSource')}
      </div>
      <div
        className={`${on('list-title')} truncate`}
        style={{ fontSize: 'var(--fs-list-title)', fontWeight: 600, lineHeight: 1.3, color: 'var(--list-title)', marginBottom: 4 }}
      >
        {t('preferences.appearance.previewTitle')}
      </div>
      <div
        className={`${on('list-summary')} line-clamp-2`}
        style={{ fontSize: 'var(--fs-list-summary)', lineHeight: 1.4, color: 'var(--list-summary)' }}
      >
        {t('preferences.appearance.previewSummary')}
      </div>
    </>
  );
}
