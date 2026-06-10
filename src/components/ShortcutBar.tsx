import { useTranslation } from 'react-i18next';
import { useUiStore, shortcutGroups } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useBreakpoint } from '../hooks/useBreakpoint';

const keyNames: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': '␣',
  Escape: 'Esc',
  Enter: '↵',
  Backspace: '⌫',
  Delete: 'Suppr',
  Tab: 'Tab',
};

function formatKey(key: string): string {
  return keyNames[key] || key.toUpperCase();
}

export default function ShortcutBar() {
  const { t } = useTranslation();
  const shortcuts = useUiStore((s) => s.shortcuts);
  const selectedArticle = useFeedStore((s) => s.selectedArticle);
  const breakpoint = useBreakpoint();

  // No keyboard shortcuts bar on touch devices
  if (breakpoint !== 'desktop') return null;

  const context = selectedArticle ? 'reading' : 'list';
  const actions = shortcutGroups[context] || shortcutGroups.list;

  return (
    <div
      className="flex-shrink-0 flex items-center gap-3 px-3 py-1 overflow-x-auto"
      style={{
        background: 'var(--panel-header-bg)',
        borderTop: '1px solid var(--panel-border)',
      }}
    >
      {actions.map((action) => (
        <div key={action} className="flex items-center gap-1 flex-shrink-0">
          <kbd
            className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 text-[9px] font-mono font-medium rounded"
            style={{
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              color: 'var(--list-title)',
              boxShadow: '0 1px 0 var(--panel-border)',
            }}
          >
            {formatKey(shortcuts[action])}
          </kbd>
          <span className="text-[9px]" style={{ color: 'var(--list-summary)' }}>
            {t(`preferences.shortcuts.${action}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
