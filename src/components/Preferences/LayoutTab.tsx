import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { ROW_ACTION_ORDER } from '../../lib/rowActions';
import { TOOLBAR_ITEMS, type ToolbarZone } from '../../lib/toolbarItems';
import { commandKeyLabel } from '../../lib/platformKeys';
import ToggleSwitch from '../ToggleSwitch';

/**
 * Préférences → Mise en page.
 *
 * « Sur ordinateur » : quels boutons des barres de la liste et du volet, et
 * quelles barres, le format desktop affiche (`src/lib/toolbarItems.ts`). Un
 * élément masqué reste dans la palette (Ctrl/⌘ K) ; ailleurs que sur desktop,
 * ces réglages sont ignorés.
 *
 * « Sur tous les écrans » : la barre des serveurs et les icônes d'une LIGNE,
 * qui valent pour tous les formats et le restent. Les icônes d'une ligne ne
 * touchent pas au volet de lecture : masquer le ✓ de la liste ne doit pas
 * retirer le moyen de marquer lu l'article qu'on est en train de lire.
 */
export default function LayoutTab() {
  const { t } = useTranslation();
  const desktop = useBreakpoint() === 'desktop';
  const visibility = useUiStore((s) => s.toolbarVisibility);
  const setToolbarVisible = useUiStore((s) => s.setToolbarVisible);
  const resetToolbarZone = useUiStore((s) => s.resetToolbarZone);
  const topbarVisible = useUiStore((s) => s.topbarVisible);
  const toggleTopbar = useUiStore((s) => s.toggleTopbar);
  const rowActions = useUiStore((s) => s.rowActions);
  const setRowAction = useUiStore((s) => s.setRowAction);

  const items = (zone: ToolbarZone) => TOOLBAR_ITEMS.filter((i) => i.zone === zone);
  const anyHidden = (zone: ToolbarZone) =>
    items(zone).some((i) => !visibility[i.id]) || (zone === 'list' && !visibility.listBar);

  return (
    <div className="max-w-xl">
      <GroupTitle>{t('preferences.toolbars.desktopTitle')}</GroupTitle>
      <Hint>{t('preferences.toolbars.desktopHint', { key: `${commandKeyLabel()} K` })}</Hint>
      {!desktop && (
        <p
          className="text-[11px] mt-2 px-2.5 py-1.5 rounded-md"
          style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
        >
          {t('preferences.toolbars.desktopOnly')}
        </p>
      )}

      <Zone title={t('preferences.toolbars.listBar')} resetLabel={t('preferences.toolbars.showAll')}
        canReset={anyHidden('list')} onReset={() => resetToolbarZone('list')}>
        <Row label={t('preferences.toolbars.listBarWhole')} checked={visibility.listBar}
          onChange={(v) => setToolbarVisible('listBar', v)} />
        {/* Le filet dit la dépendance : barre éteinte, ces boutons ne
            s'affichent plus, quel que soit leur réglage. */}
        <div className="pl-3 mt-1" style={{ borderLeft: '1px solid var(--panel-border)' }}>
          {items('list').map((item) => (
            <Row key={item.id} label={t(`preferences.toolbars.items.${item.id}`)} checked={visibility[item.id]}
              disabled={!visibility.listBar} onChange={(v) => setToolbarVisible(item.id, v)} />
          ))}
        </div>
      </Zone>

      <Zone title={t('preferences.toolbars.readingBar')} resetLabel={t('preferences.toolbars.showAll')}
        canReset={anyHidden('reading')} onReset={() => resetToolbarZone('reading')}>
        {items('reading').map((item) => (
          <Row key={item.id} label={t(`preferences.toolbars.items.${item.id}`)} checked={visibility[item.id]}
            onChange={(v) => setToolbarVisible(item.id, v)} />
        ))}
      </Zone>

      <Zone title={t('preferences.toolbars.shortcutBar')} resetLabel={t('preferences.toolbars.showAll')}
        canReset={!visibility.shortcutBar} onReset={() => resetToolbarZone('shortcuts')}>
        <Row label={t('preferences.toolbars.shortcutBarWhole')} checked={visibility.shortcutBar}
          onChange={(v) => setToolbarVisible('shortcutBar', v)} />
      </Zone>

      <div className="mt-8 pt-5" style={{ borderTop: '1px solid var(--panel-border)' }}>
        <GroupTitle>{t('preferences.toolbars.everywhereTitle')}</GroupTitle>
        <Row label={t('preferences.toolbars.serverBar')} checked={topbarVisible} onChange={() => toggleTopbar()} />

        <ZoneTitle className="mt-6">{t('preferences.layout.title')}</ZoneTitle>
        <Hint>{t('preferences.layout.hint')}</Hint>
        {ROW_ACTION_ORDER.map((kind) => (
          <Row key={kind} label={t(`preferences.layout.${kind}`)} checked={rowActions[kind]}
            onChange={(v) => setRowAction(kind, v)} />
        ))}
      </div>
    </div>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--list-summary)' }}>
      {children}
    </h3>
  );
}

function ZoneTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h4 className={`text-xs font-semibold ${className}`} style={{ color: 'var(--list-title)' }}>
      {children}
    </h4>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] opacity-70 mt-1" style={{ color: 'var(--list-summary)' }}>
      {children}
    </p>
  );
}

/** Une zone : son titre, « Tout réafficher » à droite, puis ses interrupteurs. */
function Zone({ title, resetLabel, canReset, onReset, children }: {
  title: string;
  resetLabel: string;
  canReset: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <ZoneTitle>{title}</ZoneTitle>
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset}
          className="text-[11px] rounded px-1 -mx-1 transition-opacity disabled:opacity-40 disabled:cursor-default"
          style={{ color: 'var(--accent)' }}
        >
          {resetLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

function Row({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 select-none mt-2.5">
      <span className="text-xs min-w-0" style={{ color: 'var(--list-summary)', opacity: disabled ? 0.5 : 1 }}>
        {label}
      </span>
      <ToggleSwitch checked={checked} onChange={onChange} ariaLabel={label} disabled={disabled} />
    </div>
  );
}
