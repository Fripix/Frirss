import { useState, useEffect, type ReactNode, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import {
  getAuthStatus,
  loginUser,
  registerUser,
  addServer as apiAddServer,
  updateServer,
  getServers,
  getOidcConfig,
  startOidcLogin,
  type OidcConfig,
} from '../../api/backend';
import { login as freshrssLogin } from '../../api/auth';
import { useFeedStore } from '../../stores/feedStore';
import MatrixRain from './MatrixRain';
import { shouldHideLocalLogin, isLocalFallbackUrl } from '../../lib/shouldHideLocalLogin';
import type { AuthStatus } from '../../types';

// ═════════════════════════════════════════════════════════════════════
// Shared shell — Matrix rain background + legibility vignette
// ═════════════════════════════════════════════════════════════════════
function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden"
      style={{ background: 'var(--sidebar-bg)' }}
    >
      <MatrixRain />
      {/* Vignette keeps the form readable above the animation */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: 1,
          background:
            'radial-gradient(circle at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.82) 100%)',
        }}
      />
      <div className="relative w-full flex justify-center" style={{ zIndex: 2 }}>
        {children}
      </div>
    </div>
  );
}

interface LoginProps {
  oidcError?: string | null;
}

// ═════════════════════════════════════════════════════════════════════
// Main Login — orchestrates 2 steps: backend auth → FreshRSS server
// ═════════════════════════════════════════════════════════════════════
export default function Login({ oidcError }: LoginProps) {
  const backendToken = useAuthStore((s) => s.backendToken);
  const [step, setStep] = useState<'auth' | 'server'>(backendToken ? 'server' : 'auth');

  if (step === 'server' || backendToken) {
    return <ServerStep />;
  }
  return <AuthStep onSuccess={() => setStep('server')} oidcError={oidcError} />;
}

interface AuthStepProps {
  onSuccess: () => void;
  oidcError?: string | null;
}

// ═════════════════════════════════════════════════════════════════════
// Step 1 — Login or Register to FriRSS backend
// ═════════════════════════════════════════════════════════════════════
function AuthStep({ onSuccess, oidcError }: AuthStepProps) {
  const { t } = useTranslation();
  const setBackendAuth = useAuthStore((s) => s.setBackendAuth);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [oidc, setOidc] = useState<OidcConfig | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(oidcError ? t('login.errorSso') : '');
  const [loading, setLoading] = useState(false);
  // Break-glass fallback: reach the local login form via ?local=1 or the
  // /local-login URL (no visible link — admins use the URL directly), so an
  // admin is never locked out if the identity provider is down or misconfigured.
  const forceLocal = typeof window !== 'undefined' && isLocalFallbackUrl(window.location);

  // Fetch auth status on mount
  useEffect(() => {
    getAuthStatus()
      .then((s) => {
        setStatus(s);
        // No users yet → force register mode
        if (!s.hasUsers) setMode('register');
      })
      .catch(() => setStatus({ hasUsers: false, registrationEnabled: true }));

    getOidcConfig()
      .then(setOidc)
      .catch(() => setOidc({ enabled: false }));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return setError(t('login.errorEmailInvalid'));
      }
      if (password.length < 6) {
        return setError(t('login.errorPasswordShort'));
      }
      if (password !== confirmPassword) {
        return setError(t('login.errorPasswordMismatch'));
      }
    }

    setLoading(true);
    try {
      let data;
      if (mode === 'register') {
        data = await registerUser(username, password, displayName || undefined, email);
      } else {
        data = await loginUser(username, password);
      }
      setBackendAuth(data.token, data.user);
      onSuccess();
    } catch (err) {
      const ax = err as { response?: { status?: number; data?: { error?: string } } };
      const code = ax.response?.status;
      const msg = ax.response?.data?.error;
      if (code === 409) {
        setError(t('login.errorUsernameTaken'));
      } else if (mode === 'register') {
        setError(msg || t('login.errorRegister'));
      } else {
        setError(t('login.errorLogin'));
      }
    } finally {
      setLoading(false);
    }
  }

  const isRegister = mode === 'register';
  const canRegister = status?.registrationEnabled || !status?.hasUsers;
  const isFirstUser = status && !status.hasUsers;
  // SSO-only mode: hide the local form (with lockout guards in the helper).
  const hideLocal = shouldHideLocalLogin({
    oidcEnabled: !!oidc?.enabled,
    ssoOnly: !!oidc?.ssoOnly,
    hasUsers: !!status?.hasUsers,
    forceLocal,
  });

  return (
    <LoginShell>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/logo_frirss.png"
            alt="FriRSS"
            className="w-16 h-16 rounded-2xl mx-auto mb-4 object-contain bg-white p-1.5 shadow-lg"
          />
          <h1 className="text-2xl font-bold text-white">{t('login.welcome')}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--sidebar-text)' }}>
            {isRegister ? t('login.registerTitle') : t('login.loginTitle')}
          </p>
          {isFirstUser && isRegister && (
            <p className="mt-2 text-xs px-4 py-1.5 rounded-full inline-block" style={{ background: 'var(--accent)', color: '#fff' }}>
              {t('login.firstUserHint')}
            </p>
          )}
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl p-6 space-y-4 shadow-2xl"
          style={{
            background: 'rgba(20,20,24,0.72)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          {!hideLocal && (
          <>
          <InputField
            id="username"
            label={t('login.username')}
            value={username}
            onChange={setUsername}
            placeholder="admin"
            required
            autoFocus
          />

          {isRegister && (
            <InputField
              id="displayName"
              label={t('login.displayName')}
              value={displayName}
              onChange={setDisplayName}
            />
          )}

          {isRegister && (
            <InputField
              id="email"
              label={t('login.email')}
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="nom@exemple.com"
              required
            />
          )}

          <InputField
            id="password"
            label={t('login.password')}
            type="password"
            value={password}
            onChange={setPassword}
            required
          />

          {isRegister && (
            <InputField
              id="confirmPassword"
              label={t('login.confirmPassword')}
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              required
            />
          )}

          {error && (
            <p className="text-red-400 text-xs text-center bg-red-400/10 rounded-lg py-2 px-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-medium py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
            style={{ background: 'var(--accent)' }}
          >
            {loading
              ? (isRegister ? t('login.registering') : t('login.connecting'))
              : (isRegister ? t('login.register') : t('login.login'))}
          </button>
          </>
          )}

          {/* SSO / OIDC */}
          {oidc?.enabled && (
            <>
              {!hideLocal && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.12)' }} />
                <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--sidebar-category-text)' }}>
                  {t('login.orSeparator')}
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.12)' }} />
              </div>
              )}
              <button
                type="button"
                onClick={startOidcLogin}
                className="w-full font-medium py-2.5 rounded-lg text-sm transition-all hover:brightness-110"
                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                {t('login.ssoLogin', { provider: oidc.buttonLabel })}
              </button>
            </>
          )}

          {/* Toggle login ↔ register */}
          {!hideLocal && !isFirstUser && (
            <div className="text-center text-xs pt-1" style={{ color: 'var(--sidebar-text)' }}>
              {isRegister ? (
                <>
                  {t('login.hasAccount')}{' '}
                  <button type="button" className="underline hover:brightness-125" style={{ color: 'var(--accent)' }} onClick={() => { setMode('login'); setError(''); }}>
                    {t('login.backToLogin')}
                  </button>
                </>
              ) : canRegister ? (
                <>
                  {t('login.noAccount')}{' '}
                  <button type="button" className="underline hover:brightness-125" style={{ color: 'var(--accent)' }} onClick={() => { setMode('register'); setError(''); }}>
                    {t('login.createAccount')}
                  </button>
                </>
              ) : (
                <span style={{ color: 'var(--sidebar-category-text)' }}>{t('login.registrationDisabled')}</span>
              )}
            </div>
          )}
        </form>
      </div>
    </LoginShell>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Step 2 — Connect a FreshRSS server
// ═════════════════════════════════════════════════════════════════════
function ServerStep() {
  const { t } = useTranslation();
  const setFreshrssAuth = useAuthStore((s) => s.setFreshrssAuth);
  const logoutBackend = useAuthStore((s) => s.logoutBackend);
  const backendUser = useAuthStore((s) => s.backendUser);

  const [serverUrl, setServerUrl] = useState('');
  const [freshrssUser, setFreshrssUser] = useState('');
  const [freshrssPassword, setFreshrssPassword] = useState('');
  const [serverName, setServerName] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);

  // Check if user already has servers → auto-connect to default
  useEffect(() => {
    let cancelled = false;
    getServers()
      .then((servers) => {
        if (cancelled) return;
        const defaultServer = servers.find((s) => s.is_default) || servers[0];
        if (defaultServer?.has_token) {
          // Auto-reconnect (token is injected server-side from the server id)
          setFreshrssAuth(defaultServer.id, defaultServer.url);
        } else {
          setCheckingExisting(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCheckingExisting(false);
      });
    return () => { cancelled = true; };
  }, [setFreshrssAuth]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Login to FreshRSS to get a token
      const normalizedUrl = serverUrl.replace(/\/+$/, '');
      const freshrssToken = await freshrssLogin(normalizedUrl, freshrssUser, freshrssPassword);

      // 2. Save server to backend DB
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

      // 3. Set as active (token now lives only in the backend DB)
      setFreshrssAuth(server.id, normalizedUrl);
    } catch {
      setError(t('login.errorServer'));
    } finally {
      setLoading(false);
    }
  }

  if (checkingExisting) {
    return (
      <LoginShell>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--sidebar-text)' }}>{t('app.loading')}</p>
        </div>
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg"
            style={{ background: 'var(--accent)' }}
          >
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">{t('login.serverTitle')}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--sidebar-text)' }}>
            {t('login.serverHint')}
          </p>
          {backendUser && (
            <p className="mt-1 text-xs" style={{ color: 'var(--sidebar-category-text)' }}>
              {backendUser.display_name || backendUser.username}
            </p>
          )}
        </div>

        {/* Server form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl p-6 space-y-4 shadow-2xl"
          style={{
            background: 'rgba(20,20,24,0.72)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          <InputField
            id="serverUrl"
            label={t('login.serverUrl')}
            type="url"
            value={serverUrl}
            onChange={setServerUrl}
            placeholder={t('login.serverPlaceholder')}
            required
            autoFocus
          />

          <InputField
            id="freshrssUser"
            label={t('login.freshrssUser')}
            value={freshrssUser}
            onChange={setFreshrssUser}
            placeholder="admin"
            required
          />

          <div>
            <InputField
              id="freshrssPassword"
              label={t('login.freshrssPassword')}
              type="password"
              value={freshrssPassword}
              onChange={setFreshrssPassword}
              required
            />
            <p className="mt-1 text-[10px]" style={{ color: 'var(--sidebar-category-text)' }}>
              {t('login.freshrssPasswordHint')}
            </p>
          </div>

          <InputField
            id="serverName"
            label={t('login.serverName')}
            value={serverName}
            onChange={setServerName}
          />

          {/* Master token: optional, so it stays collapsed and out of the
              way of the three required fields above. But collapsed doesn't
              mean hidden from the warning — the field and its scope warning
              only appear together, so nobody can type the secret without
              seeing what it grants first. Same pattern as AddServerDialog
              and the Preferences > Refresh tab, restyled for this screen's
              dark-glass surface. */}
          <details className="pt-1">
            <summary
              className="cursor-pointer text-xs font-medium select-none"
              style={{ color: 'var(--sidebar-text)' }}
            >
              {t('preferences.tabs.refresh')}
            </summary>
            <div className="mt-2 space-y-2">
              <input
                type="password"
                value={refreshToken}
                autoComplete="new-password"
                placeholder={t('preferences.refresh.tokenLabel')}
                onChange={(e) => setRefreshToken(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              />
              <p className="text-[11px]" style={{ color: 'var(--sidebar-category-text)' }}>
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

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-medium py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
            style={{ background: 'var(--accent)' }}
          >
            {loading ? t('login.addingServer') : t('login.addServer')}
          </button>

          {/* Logout from backend */}
          <div className="text-center pt-1">
            <button
              type="button"
              className="text-xs underline hover:brightness-125"
              style={{ color: 'var(--sidebar-category-text)' }}
              onClick={logoutBackend}
            >
              {t('sidebar.disconnect')}
            </button>
          </div>
        </form>
      </div>
    </LoginShell>
  );
}

interface InputFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}

// ═════════════════════════════════════════════════════════════════════
// Shared input field component
// ═════════════════════════════════════════════════════════════════════
function InputField({ id, label, type = 'text', value, onChange, placeholder, required, autoFocus }: InputFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1.5" style={{ color: 'var(--sidebar-text)' }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        autoComplete={type === 'password' ? 'current-password' : undefined}
        className="w-full rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 transition-all"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      />
    </div>
  );
}
