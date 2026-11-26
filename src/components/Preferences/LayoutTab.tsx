import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { ROW_ACTION_ORDER } from '../../lib/rowActions';
import { TOOLBAR_ITEMS, type ToolbarZone } from '../../lib/toolbarItems';
import { commandKeyLabel } from '../../lib/platformKeys';
import ToggleSwitch from '../ToggleSwitch';
import { FontRow } from './AppearanceTab';
import { PrefCard, PrefHeading, PrefIntro, PrefRow } from './prefsUi';
import { READING_COLUMN_WIDTH_MAX, READING_COLUMN_WIDTH_MIN, READING_COLUMN_WIDTH_STEP } from '../../lib/readingColumn';

/**
 * Préférences → Mise en page.
 *
 * Les zones marquées « Sur ordinateur » : quels boutons des barres de la liste
 * et du volet, et quelles barres, le format desktop affiche
 * (`src/lib/toolbarItems.ts`). Un élément masqué reste dans la palette
 * (Ctrl/⌘ K) ; ailleurs que sur desktop, ces réglages sont ignorés.
 *
 * Les autres valent pour tous les écrans : la barre des serveurs, la colonne
 * de lecture et les icônes d'une LIGNE. La
 * colonne de lecture (PR #32) est rangée ici, avec la disposition, et propre à
 * l'appareil comme la largeur des panneaux : elle dépend de l'écran. Les icônes d'une ligne ne
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
  const limitColumn = useUiStore((s) => s.limitReadingColumn);
  const setLimitColumn = useUiStore((s) => s.setLimitReadingColumn);
  const columnWidth = useUiStore((s) => s.readingColumnWidth);
  const setColumnWidth = useUiStore((s) => s.setReadingColumnWidth);
  const setRowAction = useUiStore((s) => s.setRowAction);
  const autoCollapse = useUiStore((s) => s.prefsNavAutoCollapse);
  const setAutoCollapse = useUiStore((s) => s.setPrefsNavAutoCollapse);

  const items = (zone: ToolbarZone) => TOOLBAR_ITEMS.filter((i) => i.zone === zone);
  const anyHidden = (zone: ToolbarZone) =>
    items(zone).some((i) => !visibility[i.id]) || (zone === 'list' && !visibility.listBar);

  const desktopTag = t('preferences.toolbars.desktopTitle');

  return (
    <div>
      <PrefIntro>{t('preferences.toolbars.desktopHint', { key: `${commandKeyLabel()} K` })}</PrefIntro>
      {!desktop && (
        <p
          className="text-[13px] mt-2 px-3 py-2 rounded-lg"
          style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
        >
          {t('preferences.toolbars.desktopOnly')}
        </p>
      )}

      <Zone title={t('preferences.toolbars.listBar')} tag={desktopTag} resetLabel={t('preferences.toolbars.showAll')}
        canReset={anyHidden('list')} onReset={() => resetToolbarZone('list')}>
        <Row label={t('preferences.toolbars.listBarWhole')} checked={visibility.listBar}
          onChange={(v) => setToolbarVisible('listBar', v)} />
        {/* Le retrait dit la dépendance : barre éteinte, ces boutons ne
            s'affichent plus, quel que soit leur réglage. */}
        <div className="prefs-subrows">
          {items('list').map((item) => (
            <Row key={item.id} label={t(`preferences.toolbars.items.${item.id}`)} checked={visibility[item.id]}
              disabled={!visibility.listBar} onChange={(v) => setToolbarVisible(item.id, v)} />
          ))}
        </div>
      </Zone>

      <Zone title={t('preferences.toolbars.readingBar')} tag={desktopTag} resetLabel={t('preferences.toolbars.showAll')}
        canReset={anyHidden('reading')} onReset={() => resetToolbarZone('reading')}>
        {items('reading').map((item) => (
          <Row key={item.id} label={t(`preferences.toolbars.items.${item.id}`)} checked={visibility[item.id]}
            onChange={(v) => setToolbarVisible(item.id, v)} />
        ))}
      </Zone>

      <Zone title={t('preferences.toolbars.shortcutBar')} tag={desktopTag} resetLabel={t('preferences.toolbars.showAll')}
        canReset={!visibility.shortcutBar} onReset={() => resetToolbarZone('shortcuts')}>
        <Row label={t('preferences.toolbars.shortcutBarWhole')} checked={visibility.shortcutBar}
          onChange={(v) => setToolbarVisible('shortcutBar', v)} />
      </Zone>

      <PrefHeading>{t('preferences.toolbars.serverBar')}</PrefHeading>
      <PrefCard>
        <Row label={t('preferences.toolbars.serverBar')} checked={topbarVisible} onChange={() => toggleTopbar()} />
      </PrefCard>

      <section aria-labelledby="reading-column-title">
        <PrefHeading id="reading-column-title">{t('preferences.readingColumn.title')}</PrefHeading>
        <PrefCard>
          <PrefRow
            label={t('preferences.readingColumn.limit')}
            hint={t('preferences.readingColumn.limitHint')}
            control={<ToggleSwitch checked={limitColumn} onChange={setLimitColumn} ariaLabel={t('preferences.readingColumn.limit')} />}
          />
          {limitColumn && (
            <div className="prefs-row">
              <FontRow
                label={t('preferences.readingColumn.width')}
                value={String(columnWidth)}
                min={READING_COLUMN_WIDTH_MIN}
                max={READING_COLUMN_WIDTH_MAX}
                step={READING_COLUMN_WIDTH_STEP}
                onChange={(v) => setColumnWidth(Number(v))}
              />
            </div>
          )}
        </PrefCard>
      </section>

      <PrefHeading navLabel={t('preferences.navShort.actionIcons')}>{t('preferences.layout.title')}</PrefHeading>
      <PrefIntro>{t('preferences.layout.hint')}</PrefIntro>
      <PrefCard>
        {ROW_ACTION_ORDER.map((kind) => (
          <Row key={kind} label={t(`preferences.layout.${kind}`)} checked={rowActions[kind]}
            onChange={(v) => setRowAction(kind, v)} />
        ))}
      </PrefCard>

      {/* Le panneau lui-même : la liste du téléphone déplie aussi ses
          sections, le réglage vaut partout (pas d'étiquette « Sur ordinateur »). */}
      <PrefHeading navLabel={t('preferences.navShort.panel')}>{t('preferences.prefsNav.title')}</PrefHeading>
      <PrefCard>
        <PrefRow
          label={t('preferences.prefsNav.autoCollapse')}
          hint={t('preferences.prefsNav.autoCollapseHint')}
          control={<ToggleSwitch checked={autoCollapse} onChange={setAutoCollapse} ariaLabel={t('preferences.prefsNav.autoCollapse')} />}
        />
      </PrefCard>
    </div>
  );
}

/** Une zone : son titre, « Tout réafficher » à droite, puis ses interrupteurs. */
function Zone({ title, tag, resetLabel, canReset, onReset, children }: {
  title: string;
  tag: string;
  resetLabel: string;
  canReset: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <PrefHeading
        tag={tag}
        action={
          <button
            type="button"
            onClick={onReset}
            disabled={!canReset}
            // Trois « Tout réafficher » : le nom dit la zone (le texte visible
            // reste en tête du nom, WCAG 2.5.3).
            aria-label={t('app.labelValue', { label: resetLabel, value: title })}
            className="prefs-link"
          >
            {resetLabel}
          </button>
        }
      >
        {title}
      </PrefHeading>
      <PrefCard>{children}</PrefCard>
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
    <PrefRow
      label={label}
      disabled={disabled}
      control={<ToggleSwitch checked={checked} onChange={onChange} ariaLabel={label} disabled={disabled} />}
    />
  );
}
