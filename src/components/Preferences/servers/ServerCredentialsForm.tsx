import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { login as freshrssLogin } from '../../../api/auth';
import { updateServer } from '../../../api/backend';
import { clearWriteToken } from '../../../api/feeds';
import { serverConnectErrorKey } from '../../../lib/loginErrors';
import { useFeedStore } from '../../../stores/feedStore';
import type { DisplayServer } from '../../../lib/serverList';

interface ServerCredentialsFormProps {
  server: Pick<DisplayServer, 'id' | 'url' | 'freshrss_user'>;
  isActive: boolean;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Ressaisir l'utilisateur et le mot de passe d'API d'un serveur existant.
 *
 * Un mot de passe d'API changé côté FreshRSS ne se corrigeait qu'en supprimant
 * le serveur puis en le rajoutant : nouvel identifiant, donc nouvelle portée
 * hors ligne, et les actions en attente ne repartaient plus. Ici le serveur
 * garde son identifiant : FreshRSS éprouve d'abord les identifiants
 * (ClientLogin), puis le jeton obtenu remplace l'ancien (`PUT`, qui exige ce
 * jeton quand l'utilisateur change).
 */
export default function ServerCredentialsForm({ server, isActive, onSaved, onClose }: ServerCredentialsFormProps) {
  const { t } = useTranslation();
  const userId = useId();
  const passwordId = useId();
  const hintId = useId();
  const [user, setUser] = useState(server.freshrss_user || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const freshrssUser = user.trim();
    if (!freshrssUser || !password) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const freshrssToken = await freshrssLogin(server.url, freshrssUser, password);
      await updateServer(Number(server.id), { freshrssUser, freshrssToken });
      setPassword('');
      setSaved(true);
      if (isActive) {
        // Le jeton d'écriture venait de l'ancienne session FreshRSS ; et les
        // actions gardées après un refus repartent sans attendre un rechargement.
        clearWriteToken();
        useFeedStore.setState({ replayRefusedByServer: false });
        void useFeedStore.getState().replayQueue();
      }
      onSaved();
    } catch (err) {
      setError(t(serverConnectErrorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-bg)' };

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="space-y-2"
    >
      <div>
        <label htmlFor={userId} className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
          {t('login.freshrssUser')}
        </label>
        <input
          id={userId}
          type="text"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="username"
          required
          className="w-full text-sm px-2.5 py-1.5 rounded-lg outline-none focus:ring-2"
          style={inputStyle}
        />
      </div>
      <div>
        <label htmlFor={passwordId} className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
          {t('login.freshrssPassword')}
        </label>
        <input
          id={passwordId}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          aria-describedby={hintId}
          autoFocus
          required
          className="w-full text-sm px-2.5 py-1.5 rounded-lg outline-none focus:ring-2"
          style={inputStyle}
        />
        <p id={hintId} className="mt-1 text-[10px]" style={{ color: 'var(--list-summary)' }}>
          {t('login.freshrssPasswordHint')}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {t('servers.credentialsSave')}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] transition-colors hover-tint disabled:opacity-50"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {saved ? t('app.close') : t('sidebar.cancel')}
        </button>
      </div>
      {/* Montée en permanence, vide au repos (liveRegions.test). */}
      <p role="status" className={saved ? 'text-[11px]' : 'sr-only'} style={{ color: 'var(--accent)' }}>
        {saved ? t('servers.credentialsSaved') : ''}
      </p>
      {error && (
        <p role="alert" className="text-[11px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </form>
  );
}
