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
        <div className={on('sidebar-header accent')} style={{ height: 30, background: 'var(--sidebar-header-bg)' }} />
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
