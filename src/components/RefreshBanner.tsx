import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../stores/feedStore';
import { useThemeStore } from '../stores/themeStore';
import { useUiStore } from '../stores/uiStore';

const SHOW_MS = 5000;

const ICONS = {
  running: <path d="M21 12a9 9 0 1 1-6.2-8.6" />,
  new: <path d="M12 3v18M3 12h18" />,
  done: <path d="M5 13l4 4L19 7" />,
  failed: <path d="M6 6l12 12M18 6L6 18" />,
  // Une horloge : ni réussie ni échouée, la relève n'a pas dit comment elle finit.
  pending: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

/**
 * Transient banner shown after a refresh. While a real (server-side) refresh is
 * running it stays up and counts articles as they land; once the job resolves it
 * behaves like before and auto-clears.
 */
export default function RefreshBanner() {
  const { t } = useTranslation();
  const refreshResult = useFeedStore((s) => s.refreshResult);
  const refreshPhase = useFeedStore((s) => s.refreshPhase);
  const hasRefreshToken = useFeedStore((s) => s.hasRefreshToken);
  const clearRefreshResult = useFeedStore((s) => s.clearRefreshResult);
  const openPreferences = useThemeStore((s) => s.openPreferences);
  const refreshHintDismissed = useUiStore((s) => s.refreshHintDismissed);
  const dismissRefreshHint = useUiStore((s) => s.dismissRefreshHint);

  const running = refreshPhase === 'running';
  // Offered once: no token, nothing in flight, and not already waved away.
  const showHint = !hasRefreshToken && !running && !refreshHintDismissed;

  // Tenu tant que le focus est dans ses boutons : au clavier, l'invitation
  // partait au bout de 5 s sous le focus, qui retombait sur <body>.
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!refreshResult || running || focused) return;   // don't dismiss a refresh in progress
    const id = setTimeout(clearRefreshResult, SHOW_MS);
    return () => clearTimeout(id);
  }, [refreshResult, running, focused, clearRefreshResult]);

  const hasNew = (refreshResult?.totalNew ?? 0) > 0;
  const count = t('refresh.newArticles', { count: refreshResult?.totalNew ?? 0 });

  let label = '';
  if (!refreshResult) { /* rien à dire */ }
  // Phrases entières, pas assemblées : l'ordre et la ponctuation sont à la langue.
  else if (running) label = hasNew ? t('refresh.inProgressWithNew', { count: refreshResult.totalNew }) : t('refresh.inProgress');
  else if (refreshPhase === 'failed') label = t('refresh.failed');
  else if (refreshPhase === 'continuing') label = hasNew ? t('refresh.continuingWithNew', { count: refreshResult.totalNew }) : t('refresh.continuing');
  else if (refreshPhase === 'timeout') label = hasNew ? count : t('refresh.incomplete');
  else label = hasNew ? count : t('refresh.upToDate');

  // Une icône par état : la coche valait aussi pour « La relève a échoué ».
  const icon: keyof typeof ICONS = running ? 'running'
    : refreshPhase === 'failed' ? 'failed'
    : hasNew ? 'new'
    : refreshPhase === 'timeout' || refreshPhase === 'continuing' ? 'pending'
    : 'done';

  // La région annoncée reste montée, vide au repos : montée avec son texte,
  // elle n'était souvent pas lue (liveRegions.test). Le bandeau visible n'est
  // plus une région ; il garde ses boutons, son libellé ne fait que doubler.
  const region = <div className="sr-only" role="status" aria-live="polite">{label}</div>;
  if (!refreshResult) return region;

  return (
    <>
      {region}
      <div
        className={`refresh-banner${running ? ' refresh-banner--running' : ''}${focused ? ' refresh-banner--held' : ''}`}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
      >
        <svg
          className={`refresh-banner__icon${running ? ' refresh-banner__icon--spin' : ''}`}
          data-icon={icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {ICONS[icon]}
        </svg>
        <span aria-hidden="true">{label}</span>
        {showHint && (
          <>
            <button
              type="button"
              className="refresh-banner__action"
              onClick={() => openPreferences('feeds')}
            >
              {t('refresh.enable')}
            </button>
            {/* Elle n'efface pas le bandeau : elle oublie l'invitation pour
                toujours. « Fermer » le cachait. */}
            <button
              type="button"
              className="refresh-banner__action refresh-banner__dismiss"
              aria-label={t('refresh.hintDismiss')}
              title={t('refresh.hintDismiss')}
              onClick={() => { setFocused(false); dismissRefreshHint(); }}
            >
              ×
            </button>
          </>
        )}
      </div>
    </>
  );
}
