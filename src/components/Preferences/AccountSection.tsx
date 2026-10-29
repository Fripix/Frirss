import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { changePassword, getMe, getOidcConfig, linkOidcAccount, unlinkOidcAccount, type OidcConfig } from '../../api/backend';
import { useUiStore } from '../../stores/uiStore';

/** Même minimum que le serveur (`server/routes/auth.ts`) et que la création de compte. */
const MIN_PASSWORD = 6;

/** Compte les changements d'état « lié » : une relecture partie avant l'un
 *  d'eux est périmée. */
let linkChanges = 0;

/** Enregistre l'état « lié » avec la session : le store seul le perdait au
 *  rechargement (« Lié » revenait après avoir délié). */
function setLinked(linked: boolean): void {
  linkChanges++;
  const { backendToken, backendUser, setBackendAuth } = useAuthStore.getState();
  if (!backendUser) return;
  const user = { ...backendUser, sso_linked: linked };
  if (backendToken) setBackendAuth(backendToken, user);
  else useAuthStore.setState({ backendUser: user });
}

/**
 * Changer son propre mot de passe. Seulement pour un compte local : un compte
 * SSO n'a pas de mot de passe ici, il le change chez son fournisseur.
 *
 * La route existait sans écran depuis le retrait du wrapper client (août) :
 * seul un administrateur pouvait réinitialiser le mot de passe d'un compte.
 */
export default function AccountSection() {
  const { t } = useTranslation();
  // Champ absent = connexion locale : les réponses de connexion et d'inscription
  // ne l'envoyaient pas avant la 1.8.0, et une session ouverte avant n'a pas
  // le champ ; le retour SSO lit l'utilisateur par /me, qui l'inclut toujours.
  const isLocal = useAuthStore((s) => !!s.backendUser && (s.backendUser.auth_provider ?? 'local') === 'local');
  const username = useAuthStore((s) => s.backendUser?.username ?? '');
  const ssoLinked = useAuthStore((s) => !!s.backendUser?.sso_linked);
  const ids = { current: useId(), next: useId(), again: useId(), hint: useId(), sso: useId(), ssoPassword: useId() };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [oidc, setOidc] = useState<OidcConfig | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPassword, setLinkPassword] = useState('');
  const [linkError, setLinkError] = useState('');
  const [unlinking, setUnlinking] = useState(false);

  // Le rattachement au SSO n'a de sens que si l'instance en a un. L'état du
  // compte est relu à ce moment : une session ouverte avant la 1.8.0 n'a pas
  // `sso_linked`, et proposait « Lier » à un compte déjà lié.
  useEffect(() => {
    if (!isLocal) return;
    let live = true;
    getOidcConfig().then((c) => {
      if (!live) return;
      setOidc(c);
      if (!c?.enabled) return;
      // Ignorée si l'état a changé depuis (déliage pendant la requête) ou si
      // elle parle d'un autre compte (session changée entre-temps).
      const asked = linkChanges;
      const id = useAuthStore.getState().backendUser?.id;
      getMe().then((me) => {
        if (!live || !me || typeof me.sso_linked !== 'boolean') return;
        if (asked !== linkChanges || me.id !== id || useAuthStore.getState().backendUser?.id !== id) return;
        setLinked(me.sso_linked);
      }).catch(() => {});
    }).catch(() => {});
    return () => { live = false; };
  }, [isLocal]);

  if (!isLocal) return null;

  // Retaper efface « Mot de passe modifié », qui parlait de la saisie d'avant.
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setDone(false); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next.length < MIN_PASSWORD) { setError(t('preferences.account.tooShort')); return; }
    if (next !== again) { setError(t('preferences.account.mismatch')); return; }
    setError('');
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent(''); setNext(''); setAgain('');
      setDone(true);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(t(status === 401 ? 'preferences.account.wrongCurrent'
        : status === 429 ? 'preferences.account.tooMany'
        : 'preferences.account.failed'));
    } finally {
      setBusy(false);
    }
  }


  // Le mot de passe actuel est demandé : une session volée suffisait sinon à
  // rattacher l'identité SSO d'un autre, qui survivait au changement de mot
  // de passe.
  async function link(e: FormEvent) {
    e.preventDefault();
    setLinkError('');
    setLinking(true);
    try {
      await linkOidcAccount(linkPassword); // quitte la page vers le fournisseur
    } catch (err) {
      setLinking(false);
      const status = (err as { response?: { status?: number } })?.response?.status;
      // 409 : déjà lié. Une session ouverte avant la 1.8.0 ne le savait pas
      // (`sso_linked` absent) et proposait « Lier » à tort.
      if (status === 409) { setLinked(true); setLinkOpen(false); return; }
      setLinkError(t(status === 401 ? 'preferences.account.wrongCurrent'
        : status === 429 ? 'preferences.account.tooMany'
        : 'preferences.account.ssoLinkFailed'));
    }
  }

  async function unlink() {
    setUnlinking(true);
    try {
      await unlinkOidcAccount();
      setLinked(false);
      setLinkPassword('');
      useUiStore.getState().pushToast(t('preferences.account.ssoUnlinked', { provider: oidc?.buttonLabel || 'SSO' }));
    } catch {
      useUiStore.getState().pushToast(t('preferences.account.ssoUnlinkFailed'), { tone: 'error' });
    } finally {
      setUnlinking(false);
    }
  }

  const field = 'w-full px-3 py-1.5 text-sm rounded-md';
  const fieldStyle = { border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' };
  const label = 'block text-xs mb-1';

  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.account.title')}
      </h3>
      <form onSubmit={submit} className="space-y-2.5 max-w-xs" aria-describedby={ids.hint}>
        <p id={ids.hint} className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.account.hint')}
        </p>
        {/* Pour les gestionnaires de mots de passe : sans identifiant dans le
            formulaire, ils ne savent pas à quel compte rattacher le nouveau
            mot de passe. Caché, jamais saisi. */}
        <input type="text" autoComplete="username" value={username} readOnly hidden />
        <div>
          <label htmlFor={ids.current} className={label} style={{ color: 'var(--list-summary)' }}>{t('preferences.account.current')}</label>
          <input id={ids.current} type="password" autoComplete="current-password" required value={current}
            onChange={edit(setCurrent)} className={field} style={fieldStyle} />
        </div>
        <div>
          <label htmlFor={ids.next} className={label} style={{ color: 'var(--list-summary)' }}>{t('preferences.account.new')}</label>
          <input id={ids.next} type="password" autoComplete="new-password" required value={next}
            onChange={edit(setNext)} className={field} style={fieldStyle} />
        </div>
        <div>
          <label htmlFor={ids.again} className={label} style={{ color: 'var(--list-summary)' }}>{t('preferences.account.confirm')}</label>
          <input id={ids.again} type="password" autoComplete="new-password" required value={again}
            onChange={edit(setAgain)} className={field} style={fieldStyle} />
        </div>
        {error && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
        {/* Région montée en permanence, vide au repos : insérée avec son texte,
            elle n'était souvent pas annoncée (liveRegions.test). */}
        <p role="status" className={done ? 'text-xs' : 'sr-only'} style={{ color: 'var(--accent)' }}>{done ? t('preferences.account.done') : ''}</p>
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 text-xs font-medium rounded-lg disabled:opacity-50 prefs-tap-btn"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {busy ? t('preferences.account.saving') : t('preferences.account.submit')}
        </button>
      </form>
      {/* Seul chemin de rattachement au SSO (1.8.0) : connecté à ce compte,
          on prouve qu'on tient les deux, mot de passe compris. Le
          rattachement d'office par adresse e-mail, que le fournisseur ne
          garantit pas, est retiré. Bloc séparé par un filet : à 320 px, son
          aide se lisait comme la suite du changement de mot de passe. */}
      {oidc?.enabled && (() => {
        const provider = oidc.buttonLabel || 'SSO';
        const secondary = 'px-4 py-2 text-xs font-medium rounded-lg disabled:opacity-50 prefs-tap-btn hover-tint';
        const secondaryStyle = { border: '1px solid var(--panel-border)', color: 'var(--list-title)' };
        return (
          <section aria-labelledby={ids.sso} className="mt-6 pt-4 max-w-xs space-y-2" style={{ borderTop: '1px solid var(--panel-border)' }}>
            <h4 id={ids.sso} className="text-xs font-semibold" style={{ color: 'var(--list-title)' }}>
              {t('preferences.account.ssoTitle', { provider })}
            </h4>
            {ssoLinked ? (
              <>
                <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
                  {t('preferences.account.ssoLinked', { provider })}
                </p>
                <button type="button" onClick={unlink} disabled={unlinking} className={secondary} style={secondaryStyle}>
                  {t('preferences.account.ssoUnlink')}
                </button>
              </>
            ) : (
              <>
                <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
                  {t('preferences.account.ssoLinkHint', { provider })}
                </p>
                {linkOpen ? (
                  <form onSubmit={link} className="space-y-2.5">
                    <div>
                      <label htmlFor={ids.ssoPassword} className={label} style={{ color: 'var(--list-summary)' }}>
                        {t('preferences.account.ssoPassword')}
                      </label>
                      <input id={ids.ssoPassword} type="password" autoComplete="current-password" required autoFocus
                        value={linkPassword} onChange={(e) => { setLinkPassword(e.target.value); setLinkError(''); }}
                        className={field} style={fieldStyle} />
                    </div>
                    {linkError && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{linkError}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="submit" disabled={linking}
                        className="px-4 py-2 text-xs font-medium rounded-lg disabled:opacity-50 prefs-tap-btn"
                        style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                        {t('preferences.account.ssoLink', { provider })}
                      </button>
                      <button type="button" onClick={() => { setLinkOpen(false); setLinkPassword(''); setLinkError(''); }}
                        className="px-3 py-2 text-xs rounded-lg prefs-tap-btn hover-tint" style={{ color: 'var(--list-summary)' }}>
                        {t('dialog.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => setLinkOpen(true)} className={secondary} style={secondaryStyle}>
                    {t('preferences.account.ssoLink', { provider })}
                  </button>
                )}
              </>
            )}
          </section>
        );
      })()}
    </div>
  );
}
