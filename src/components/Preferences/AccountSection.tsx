import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { changePassword } from '../../api/backend';

/** Même minimum que le serveur (`server/routes/auth.ts`) et que la création de compte. */
const MIN_PASSWORD = 6;

/**
 * Changer son propre mot de passe. Seulement pour un compte local : un compte
 * SSO n'a pas de mot de passe ici, il le change chez son fournisseur.
 *
 * La route existait sans écran depuis le retrait du wrapper client (août) :
 * seul un administrateur pouvait réinitialiser le mot de passe d'un compte.
 */
export default function AccountSection() {
  const { t } = useTranslation();
  const isLocal = useAuthStore((s) => s.backendUser?.auth_provider === 'local');
  const ids = { current: useId(), next: useId(), again: useId(), hint: useId() };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!isLocal) return null;

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
        <div>
          <label htmlFor={ids.current} className={label} style={{ color: 'var(--list-summary)' }}>{t('preferences.account.current')}</label>
          <input id={ids.current} type="password" autoComplete="current-password" required value={current}
            onChange={(e) => setCurrent(e.target.value)} className={field} style={fieldStyle} />
        </div>
        <div>
          <label htmlFor={ids.next} className={label} style={{ color: 'var(--list-summary)' }}>{t('preferences.account.new')}</label>
          <input id={ids.next} type="password" autoComplete="new-password" required value={next}
            onChange={(e) => setNext(e.target.value)} className={field} style={fieldStyle} />
        </div>
        <div>
          <label htmlFor={ids.again} className={label} style={{ color: 'var(--list-summary)' }}>{t('preferences.account.confirm')}</label>
          <input id={ids.again} type="password" autoComplete="new-password" required value={again}
            onChange={(e) => setAgain(e.target.value)} className={field} style={fieldStyle} />
        </div>
        {error && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
        {done && <p role="status" className="text-xs" style={{ color: 'var(--accent)' }}>{t('preferences.account.done')}</p>}
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 text-xs font-medium rounded-lg disabled:opacity-50 prefs-tap-btn"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {busy ? t('preferences.account.saving') : t('preferences.account.submit')}
        </button>
      </form>
    </div>
  );
}
