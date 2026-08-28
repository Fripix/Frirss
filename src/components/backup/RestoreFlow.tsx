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
  const previewRef = useRef<HTMLDivElement>(null);
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
      // Après le rendu : l'aperçu peut naître hors de l'écran, et un résultat
      // qu'on ne voit pas n'en est pas un. `smooth` seulement si l'utilisateur
      // n'a pas demandé moins d'animations.
      const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => {
        previewRef.current?.scrollIntoView({ behavior: doux ? 'smooth' : 'auto', block: 'nearest' });
      });
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
      // La phrase de passe et le contenu déchiffré n'ont plus lieu d'être en
      // mémoire du composant pendant la seconde et demie qui précède la
      // déconnexion déclenchée par onRestored().
      setPassphrase('');
      setEnvelope(null);
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
      {/* Un seul contrôle, qui porte son état. L'ancien bouton étroit, bordé et
          au libellé muet se lisait comme un champ de saisie vide, et le nom du
          fichier vivait à côté, détaché de ce qui l'avait produit. Ici la
          bordure tiretée dit « en attente d'un fichier », le trait plein dit
          « j'en ai un », et cliquer de nouveau le remplace — sans qu'aucune
          seconde commande ne soit nécessaire. */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full min-h-[44px] rounded-lg px-4 py-3 flex items-center gap-3 text-left transition-colors hover:bg-black/5"
        style={{
          border: `1px ${fileName ? 'solid' : 'dashed'} var(--panel-border)`,
          background: fileName ? 'var(--panel-header-bg)' : 'transparent',
          color: 'var(--list-title)',
        }}
      >
        <svg
          className="w-5 h-5 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          style={{ color: fileName ? 'var(--accent)' : 'var(--list-summary)' }}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        {fileName ? (
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--list-summary)' }}>
              {t('backup.fileChosen')}
            </span>
            <span className="block text-xs font-medium truncate">{fileName}</span>
          </span>
        ) : (
          <span className="text-xs font-medium">{t('backup.chooseFile')}</span>
        )}
      </button>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('backup.passphrase')}
        </label>
        <input
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
            // Même raisonnement que pour le choix d'un fichier : l'aperçu
            // affiché correspond à la phrase de passe précédente, pas à
            // celle qui vient d'être modifiée. Le vider évite de laisser un
            // bouton de remplacement cliquable pointant vers un contenu qui
            // ne correspond plus à ce qui est saisi.
            setSummary(null);
          }}
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
        {/* Le même compteur que le champ de jeton : la vérification déchiffre
            et fait un aller-retour, elle n'est jamais instantanée, et sans lui
            le clic ne produisait aucun signe visible. */}
        {phase === 'checking' && (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
        {t('backup.check')}
      </button>

      {/* L'aperçu se dépliait plus bas sans rien signaler : on cliquait, et
          rien ne semblait se passer. Trois choses le font exister — un liseré
          accentué qui le désigne comme le résultat du geste qu'on vient de
          faire, `role="status"` pour que les lecteurs d'écran l'annoncent, et
          un défilement qui l'amène sous les yeux. */}
      {summary && (
        <div
          ref={previewRef}
          role="status"
          className="rounded-lg px-3 py-3 space-y-2"
          style={{
            border: '1px solid var(--panel-border)',
            borderLeft: '3px solid var(--accent)',
            background: 'var(--panel-header-bg)',
          }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{t('backup.previewTitle')}</p>
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
