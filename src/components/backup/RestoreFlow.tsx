import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewRestore, applyRestore } from '../../api/backend';
import { backupErrorKey } from '../../lib/backupErrors';
import type { RestoreSummary } from '../../types';

interface RestoreFlowProps {
  /** Instance vierge (premier démarrage) : rien à écraser, avertissement allégé. */
  setup: boolean;
  onRestored: () => void;
}

type Phase = 'idle' | 'checking' | 'preview' | 'restoring' | 'done';

export default function RestoreFlow({ setup, onRestored }: RestoreFlowProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [envelope, setEnvelope] = useState<unknown>(null);
  const [passphrase, setPassphrase] = useState('');
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function pickFile(file: File) {
    setError('');
    setSummary(null);
    setFileName(file.name);
    try {
      setEnvelope(JSON.parse(await file.text()));
    } catch {
      setEnvelope(null);
      setError(t('backup.errNotBackup'));
    }
  }

  async function check() {
    setPhase('checking');
    setError('');
    try {
      setSummary(await previewRestore(envelope, passphrase, setup));
      setPhase('preview');
    } catch (err) {
      setError(t(backupErrorKey(err)));
      // L'aperçu affiché correspond à la vérification précédente, pas à celle
      // qui vient d'échouer : le vider évite de laisser un bouton de
      // remplacement cliquable pointant vers un contenu qui ne correspond
      // plus à la phrase de passe saisie.
      setSummary(null);
      setPhase('idle');
    }
  }

  async function replace() {
    setPhase('restoring');
    setError('');
    try {
      await applyRestore(envelope, passphrase, setup);
      setPhase('done');
      onRestored();
    } catch (err) {
      setError(t(backupErrorKey(err)));
      setPhase('preview');
    }
  }

  const envText = summary
    ? Object.entries(summary.summary.environment).map(([k, v]) => `${k}=${v}`).join('\n')
    : '';

  if (phase === 'done') {
    return (
      <p className="text-xs" role="status" style={{ color: 'var(--accent)' }}>
        {t('backup.restored')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] transition-colors hover:bg-black/5"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {t('backup.chooseFile')}
        </button>
        {fileName && (
          <span className="text-[11px] truncate" style={{ color: 'var(--list-summary)' }}>
            {t('backup.fileChosen')} {fileName}
          </span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('backup.passphrase')}
        </label>
        <input
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        />
      </div>

      <button
        type="button"
        onClick={check}
        disabled={!envelope || passphrase === '' || phase === 'checking'}
        aria-busy={phase === 'checking'}
        className="px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {t('backup.check')}
      </button>

      {summary && (
        <div className="rounded-lg px-3 py-3 space-y-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--list-title)' }}>{t('backup.previewTitle')}</p>
          <dl className="text-[11px] space-y-1" style={{ color: 'var(--list-summary)' }}>
            <div><dt className="inline">{t('backup.createdAt')} : </dt><dd className="inline">{summary.createdAt ?? '—'}</dd></div>
            <div><dt className="inline">{t('backup.producedBy')} : </dt><dd className="inline">{summary.appVersion ?? '—'}</dd></div>
            <div><dt className="inline">{t('backup.usersCount')} : </dt><dd className="inline">{summary.summary.users}</dd></div>
            <div><dt className="inline">{t('backup.serversCount')} : </dt><dd className="inline">{summary.summary.servers}</dd></div>
          </dl>

          {envText && (
            <div className="space-y-1.5">
              <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>{t('backup.environment')}</p>
              <pre className="text-[11px] overflow-x-auto rounded p-2" style={{ background: 'var(--panel-bg)', color: 'var(--list-title)' }}>{envText}</pre>
              <button
                type="button"
                onClick={() => {
                  // Ces variables ne sont visibles que sur cet écran, avant une
                  // opération qui déconnecte l'utilisateur : ne signaler « copié »
                  // qu'en cas de succès réel (l'API peut être absente en contexte
                  // non sécurisé, ou la promesse peut être rejetée), sinon on lui
                  // fait croire qu'il les a sauvegardées alors que non.
                  const clipboard = navigator.clipboard;
                  if (!clipboard) return;
                  clipboard.writeText(envText).then(() => setCopied(true)).catch(() => {});
                }}
                className="px-3 py-1.5 text-xs rounded-lg min-h-[44px] transition-colors hover:bg-black/5"
                style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
              >
                {copied ? t('backup.copied') : t('backup.copy')}
              </button>
            </div>
          )}

          {!setup && (
            <p className="text-[11px]" style={{ color: 'var(--danger)' }}>{t('backup.replaceHint')}</p>
          )}

          <button
            type="button"
            onClick={replace}
            disabled={phase === 'restoring'}
            aria-busy={phase === 'restoring'}
            className="px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] text-white disabled:opacity-50"
            style={{ background: 'var(--danger)' }}
          >
            {phase === 'restoring' ? t('backup.restoring') : t('backup.replace')}
          </button>
        </div>
      )}

      {error && <p className="text-[11px]" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
