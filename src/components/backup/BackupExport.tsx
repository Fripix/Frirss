import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createBackup } from '../../api/backend';

const MIN_PASSPHRASE_LENGTH = 12;

export default function BackupExport() {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tooShort = passphrase !== '' && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirm !== '' && confirm !== passphrase;
  const ready = passphrase.length >= MIN_PASSPHRASE_LENGTH && confirm === passphrase;

  async function download() {
    setBusy(true);
    setError('');
    try {
      const envelope = await createBackup(passphrase);
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = envelope.createdAt.replace(/[-:]/g, '').slice(0, 15);
      a.href = url;
      a.download = `frirss-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setPassphrase('');
      setConfirm('');
    } catch {
      setError(t('backup.errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>{t('backup.description')}</p>
      <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>{t('backup.whyPassphrase')}</p>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('backup.passphrase')}
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        />
        {tooShort && <span className="block text-[11px] mt-1" style={{ color: 'var(--danger)' }}>{t('backup.tooShort')}</span>}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('backup.passphraseConfirm')}
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        />
        {mismatch && <span className="block text-[11px] mt-1" style={{ color: 'var(--danger)' }}>{t('backup.mismatch')}</span>}
      </div>

      <p className="px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
        {t('backup.passphraseLost')}
      </p>

      <button
        type="button"
        onClick={download}
        disabled={!ready || busy}
        aria-busy={busy}
        className="px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {busy ? t('backup.preparing') : t('backup.download')}
      </button>

      {error && <p className="text-[11px]" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
