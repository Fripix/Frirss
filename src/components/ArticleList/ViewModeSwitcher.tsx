import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';

export default function ViewModeSwitcher() {
  const { t } = useTranslation();
  const { viewMode, setViewMode } = useUiStore();

  const modes = [
    {
      id: 'preview',
      title: t('viewMode.preview'),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
        </svg>
      ),
    },
    {
      id: 'simple',
      title: t('viewMode.standard'),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      ),
    },
    {
      id: 'compact',
      title: t('viewMode.compact'),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
        </svg>
      ),
    },
    {
      id: 'grid',
      title: t('viewMode.grid'),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75h6.5v6.5h-6.5v-6.5zm10 0h6.5v6.5h-6.5v-6.5zm-10 10h6.5v6.5h-6.5v-6.5zm10 0h6.5v6.5h-6.5v-6.5z" />
        </svg>
      ),
    },
  ];

  return (
    <div data-theme="list-active" className="flex items-center gap-0.5 rounded-md p-0.5" style={{ background: 'var(--list-active)' }}>
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => setViewMode(mode.id)}
          title={mode.title}
          className={`p-1 rounded transition-all ${
            viewMode === mode.id
              ? 'bg-[var(--panel-bg)] shadow-sm text-[var(--accent)]'
              : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
          }`}
        >
          {mode.icon}
        </button>
      ))}
    </div>
  );
}
