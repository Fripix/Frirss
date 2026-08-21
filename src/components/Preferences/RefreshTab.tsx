import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getServers, updateServer, startActualize, getActualizeStatus } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { useFeedStore } from '../../stores/feedStore';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

/**
 * Master-token configuration for the active FreshRSS server. The token is
 * write-only from here: the backend never sends its value back, only whether
 * one is set (`has_refresh_token`).
 */
export default function RefreshTab() {
  const { t } = useTranslation();
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const setHasRefreshToken = useFeedStore((s) => s.setHasRefreshToken);

  const [token, setToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>('idle');

  useEffect(() => {
    let cancelled = false;
    getServers()
      .then((servers) => {
        if (cancelled) return;
        const active = servers.find((s) => String(s.id) === String(activeServerId));
        setConfigured(!!active?.has_refresh_token);
      })
      .catch(() => { /* leave it unconfigured */ });
    return () => { cancelled = true; };
  }, [activeServerId]);

  async function save() {
    if (activeServerId == null) return;
    setSaving(true);
    setTest('idle');
    try {
      await updateServer(Number(activeServerId), { refreshToken: token });
      setConfigured(token !== '');
      setHasRefreshToken(token !== '');
      setToken('');
    } catch {
      // Save failed (network error, 500, ...): leave `configured` and the
      // typed token untouched so the button doesn't lie about having saved,
      // and reuse the existing test-fail copy instead of adding a new key.
      setTest('fail');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (activeServerId == null) return;
    setTest('testing');
    try {
      // maxFeeds=1: proves the token is accepted without starting a full sweep.
      // kind 'test': its own job slot, so a sweep already in flight can't be
      // handed back here and time out as "token rejected".
      const job = await startActualize(Number(activeServerId), 'test', 1);
      if (!job) {
        setTest('fail');
        return;
      }
      // The POST only confirms a token is stored; the actual FreshRSS call
      // happens afterwards in a fire-and-forget job. Poll for the real
      // outcome instead of trusting the 202. Bounded to ~30s: a single-feed
      // refresh resolves fast, and an unbounded loop has no place here.
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await getActualizeStatus(Number(activeServerId), 'test');
        if (status?.status === 'done') {
          setTest('ok');
          return;
        }
        if (status?.status === 'failed') {
          setTest('fail');
          return;
        }
      }
      setTest('fail');
    } catch {
      setTest('fail');
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.refresh.tokenLabel')}
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={configured ? '••••••••' : ''}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{
            border: '1px solid var(--panel-border)',
            color: 'var(--list-title)',
            background: 'var(--panel-header-bg)',
          }}
        />
        <span className="block text-[11px] opacity-70 mt-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.refresh.tokenHelp')}
        </span>
      </div>

      {/* Scope warning — this token also grants read access to everything, not
          just refresh, so it stays visible in the flow rather than tucked
          behind a disclosure. */}
      <div
        className="px-4 py-3 rounded-lg text-xs flex items-start gap-2"
        style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
      >
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span>{t('preferences.refresh.scopeWarning')}</span>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving || activeServerId == null}
          className="px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {t('preferences.refresh.save')}
        </button>
        <button
          type="button"
          onClick={runTest}
          disabled={!configured || saving || test === 'testing'}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:bg-black/5 disabled:opacity-50"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {t('preferences.refresh.test')}
        </button>
        {test === 'ok' && (
          <span className="text-[11px]" style={{ color: 'var(--accent)' }}>
            {t('preferences.refresh.testOk')}
          </span>
        )}
        {test === 'fail' && (
          <span className="text-[11px]" style={{ color: 'var(--danger)' }}>
            {t('preferences.refresh.testFail')}
          </span>
        )}
      </div>
    </div>
  );
}
