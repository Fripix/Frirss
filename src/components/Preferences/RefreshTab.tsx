import { useEffect, useRef, useState } from 'react';
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
  // The field is empty but shows a bullet placeholder when a token is stored,
  // which reads as pre-filled. Save posts whatever the field holds, and the
  // backend treats '' as an explicit clear — so an untouched Save used to
  // delete a working token. Only an actual edit arms the button. Emptying the
  // field IS an edit, so deliberately clearing the token still works.
  const [edited, setEdited] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>('idle');
  // runTest polls for up to 30s; Preferences can be closed long before that.
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);

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
    if (activeServerId == null || !edited) return;
    setSaving(true);
    setTest('idle');
    try {
      await updateServer(Number(activeServerId), { refreshToken: token });
      setConfigured(token !== '');
      setHasRefreshToken(token !== '');
      setToken('');
      setEdited(false);
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
      // Test the value currently in the field, not the stored token: a user
      // who pastes a freshly-rotated token and hits Test before Save must not
      // get a rejection about the token they're replacing. An edited field
      // left empty means "clear on Save" — for Test that falls back to the
      // stored token rather than sending an empty one.
      const testToken = edited && token !== '' ? token : undefined;
      // maxFeeds=1: proves the token is accepted without starting a full sweep.
      // kind 'test': its own job slot, so a sweep already in flight can't be
      // handed back here and time out as "token rejected".
      const job = await startActualize(Number(activeServerId), 'test', 1, testToken);
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
        if (unmounted.current) return;
        const status = await getActualizeStatus(Number(activeServerId), 'test');
        if (unmounted.current) return;
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
      if (!unmounted.current) setTest('fail');
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
          onChange={(e) => { setToken(e.target.value); setEdited(true); }}
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
          disabled={saving || !edited || activeServerId == null}
          className="px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {t('preferences.refresh.save')}
        </button>
        <button
          type="button"
          onClick={runTest}
          // Enabled when there's a token to test — stored, or currently
          // typed in the field. Gating on `configured` alone trapped a user
          // who pasted a replacement token: Test stayed bound to the old
          // stored one until Save, so verifying-before-committing was
          // impossible.
          disabled={(!configured && token === '') || saving || test === 'testing'}
          aria-busy={test === 'testing'}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:bg-black/5 disabled:opacity-50 inline-flex items-center gap-1.5"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {/* The check round-trips to FreshRSS, so it is never instant. Borrow
              the sidebar refresh button's spinner rather than inventing a
              second vocabulary for "working" — and no extra label, which would
              mean nine more translations for what the icon already says. */}
          {test === 'testing' && (
            <svg
              className="w-3 h-3 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {t('preferences.refresh.test')}
        </button>
        {test === 'ok' && (
          <span className="text-[11px]" role="status" style={{ color: 'var(--accent)' }}>
            {t('preferences.refresh.testOk')}
          </span>
        )}
        {test === 'fail' && (
          <span className="text-[11px]" role="status" style={{ color: 'var(--danger)' }}>
            {t('preferences.refresh.testFail')}
          </span>
        )}
      </div>
    </div>
  );
}
