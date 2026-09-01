import { useState, type FormEvent, type ReactEventHandler } from 'react';
import { useTranslation } from 'react-i18next';
import { addServer as apiAddServer, updateServer } from '../../../api/backend';
import { login as freshrssLogin } from '../../../api/auth';
import { serverConnectErrorKey } from '../../../lib/loginErrors';
import { useFeedStore } from '../../../stores/feedStore';
import type { ServerConnection } from '../../../types';

interface AddServerDialogProps {
  onClose: () => void;
  onAdded: (server: ServerConnection) => void;
}

// ═════════════════════════════════════════════════════════════════════
// Modal to connect a new FreshRSS server (reuses the login ServerStep logic)
// ═════════════════════════════════════════════════════════════════════
export default function AddServerDialog({ onClose, onAdded }: AddServerDialogProps) {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState('');
  const [freshrssUser, setFreshrssUser] = useState('');
  const [freshrssPassword, setFreshrssPassword] = useState('');
  const [serverName, setServerName] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const normalizedUrl = serverUrl.replace(/\/+$/, '');
      const freshrssToken = await freshrssLogin(normalizedUrl, freshrssUser, freshrssPassword);
      const server = await apiAddServer({
        name: serverName || normalizedUrl,
        url: normalizedUrl,
        freshrssUser,
        freshrssToken,
      });
      // Master token is optional and saved separately: POST /api/servers
      // deliberately doesn't accept it (see updateServer call below). The
      // server itself is already created and usable at this point, so a
      // failed save here must not abort the flow — but it also must not be
      // reported as configured. If it fails, hasRefreshToken simply stays
      // false (its real, backend-confirmed value); the user can retry from
      // Preferences > Refresh.
      if (refreshToken) {
        try {
          await updateServer(server.id, { refreshToken });
          useFeedStore.getState().setHasRefreshToken(true);
        } catch {
          // Not fatal: the server connection itself succeeded. Swallow so
          // the user isn't stuck re-submitting a server that already
          // exists (a retry here would 409).
        }
      }
      // Hand back the created server. The token stays in the backend; the
      // server is now usable (has_token) and switchable by id.
      onAdded({ ...server, has_token: true });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        setError(t('servers.errorDuplicate'));
      } else {
        setError(t(serverConnectErrorKey(err)));
      }
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 shadow-2xl"
        style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Escape here means "close this dialog", not "close Préférences"
          // underneath it — without stopping propagation, the same key
          // demounts the whole panel with a half-filled server form inside.
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        }}
      >
        <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--list-title)' }}>
          {t('servers.addTitle')}
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--list-summary)' }}>
          {t('login.serverHint')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field
            label={t('login.serverUrl')}
            type="url"
            value={serverUrl}
            onChange={setServerUrl}
            placeholder={t('login.serverPlaceholder')}
            required
            autoFocus
          />
          <Field
            label={t('login.freshrssUser')}
            value={freshrssUser}
            onChange={setFreshrssUser}
            placeholder="admin"
            required
          />
          <div>
            <Field
              label={t('login.freshrssPassword')}
              type="password"
              value={freshrssPassword}
              onChange={setFreshrssPassword}
              required
            />
            <p className="mt-1 text-[10px]" style={{ color: 'var(--list-summary)' }}>
              {t('login.freshrssPasswordHint')}
            </p>
          </div>
          <Field
            label={t('login.serverName')}
            value={serverName}
            onChange={setServerName}
          />

          {/* Master token: optional, so it stays collapsed and out of the
              way of the three required fields above. But collapsed doesn't
              mean hidden from the warning — the field and its scope warning
              only appear together, so nobody can type the secret without
              seeing what it grants first. */}
          <details className="pt-1">
            <summary
              className="cursor-pointer text-xs font-medium select-none"
              style={{ color: 'var(--list-summary)' }}
            >
              {t('preferences.refresh.title')}
            </summary>
            <div className="mt-2 space-y-2">
              <input
                type="password"
                value={refreshToken}
                autoComplete="new-password"
                placeholder={t('preferences.refresh.tokenLabel')}
                onChange={(e) => setRefreshToken(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 transition-all"
                style={{
                  background: 'var(--panel-header-bg)',
                  border: '1px solid var(--panel-border)',
                  color: 'var(--list-title)',
                }}
              />
              <p className="text-[11px] opacity-70" style={{ color: 'var(--list-summary)' }}>
                {t('preferences.refresh.tokenHelp')}
              </p>
              <div
                className="px-3 py-2 rounded-lg text-xs flex items-start gap-2"
                style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
              >
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{t('preferences.refresh.scopeWarning')}</span>
              </div>
            </div>
          </details>

          {error && (
            <p className="text-red-400 text-xs text-center bg-red-400/10 rounded-lg py-2 px-3">{error}</p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm rounded-lg transition-colors hover:bg-black/5"
              style={{ color: 'var(--list-summary)' }}
            >
              {t('sidebar.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-all disabled:opacity-50 hover:brightness-110"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              {loading ? t('login.addingServer') : t('login.addServer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}

function Field({ label, type = 'text', value, onChange, placeholder, required, autoFocus }: FieldProps) {
  const handleChange: ReactEventHandler<HTMLInputElement> = (e) =>
    onChange((e.target as HTMLInputElement).value);
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        required={required}
        autoFocus={autoFocus}
        autoComplete={type === 'password' ? 'current-password' : undefined}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 transition-all"
        style={{
          background: 'var(--bg-secondary, rgba(0,0,0,0.04))',
          border: '1px solid var(--panel-border)',
          color: 'var(--list-title)',
        }}
      />
    </div>
  );
}
