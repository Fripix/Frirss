import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '../../../stores/aiStore';
import { setAiUserKey, type AiProviderView } from '../../../api/backend';
import { BlockTitle } from './shared';
import ConfirmDialog from '../../ConfirmDialog';
import { inputClass, inputStyle, quietBtn } from './styles';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];

type Outcome = 'saved' | 'cleared' | 'error';

/**
 * Une ligne = un fournisseur, avec son propre champ, sa propre requête et son
 * propre message : enregistrer l'une ne touche jamais à ce qu'on tape dans une
 * autre. La clé tapée ne vit que dans cet état local : jamais relue du serveur,
 * jamais recopiée dans un message, vidée dès que l'enregistrement a réussi.
 */
function KeyRow({ provider }: { provider: AiProviderView }) {
  const { t } = useTranslation();
  const fieldId = useId();
  const load = useAiStore((s) => s.load);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Effacée, la clé est à recoller : l'effacement se confirme.
  const [confirmClear, setConfirmClear] = useState(false);

  const send = async (key: string | null, done: Outcome) => {
    setBusy(true);
    setOutcome(null);
    try {
      await setAiUserKey(provider.id, key);
    } catch {
      // Le champ garde ce qui a été tapé : on peut réessayer sans tout ressaisir.
      setOutcome('error');
      setBusy(false);
      return;
    }
    setValue('');
    setOutcome(done);
    await load();
    setBusy(false);
  };

  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-semibold [overflow-wrap:anywhere]" style={{ color: 'var(--list-title)' }}>{provider.name}</span>
        <span className="text-[11px]" style={{ color: provider.hasUserKey ? 'var(--accent)' : 'var(--list-summary)' }}>
          {t(provider.hasUserKey ? 'ai.keys.set' : 'ai.keys.none')}
        </span>
      </div>
      <input
        id={fieldId} type="password" value={value} autoComplete="new-password" spellCheck={false}
        aria-label={t('ai.keys.field', { name: provider.name })}
        onChange={(e) => setValue(e.target.value)}
        className={inputClass} style={inputStyle}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button" disabled={busy || !value.trim()} onClick={() => send(value, 'saved')}
          className="prefs-tap-btn px-4 py-1.5 text-xs font-semibold rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-default"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {t('ai.keys.save')}
        </button>
        {provider.hasUserKey && (
          <button
            type="button" disabled={busy} onClick={() => setConfirmClear(true)}
            className={quietBtn} style={{ color: 'var(--danger)' }}
          >
            {t('ai.keys.clear')}
          </button>
        )}
        {outcome === 'error' && <span role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{t('ai.keys.error')}</span>}
        {/* Région montée en permanence, vide au repos (liveRegions.test). */}
        <span role="status" className={outcome && outcome !== 'error' ? 'text-xs' : 'sr-only'} style={{ color: 'var(--accent)' }}>
          {outcome === 'saved' ? t('ai.keys.saved') : outcome === 'cleared' ? t('ai.keys.cleared') : ''}
        </span>
      </div>
      <ConfirmDialog
        open={confirmClear}
        title={t('ai.keys.clearConfirmTitle', { name: provider.name })}
        message={t('ai.keys.clearConfirmMessage')}
        confirmLabel={t('ai.keys.clear')}
        danger
        onConfirm={() => { setConfirmClear(false); void send(null, 'cleared'); }}
        onCancel={() => setConfirmClear(false)}
      />
    </li>
  );
}

/**
 * Bloc « Mes clés » : l'utilisateur enregistre ou efface sa propre clé par
 * fournisseur. Rien n'est rendu tant que l'admin ne permet pas les clés
 * personnelles — une clé déjà stockée est alors ignorée, pas effacée.
 */
export default function KeysBlock() {
  const { t } = useTranslation();
  const allowed = useAiStore((s) => s.config?.userKeysAllowed === true);
  const providers = useAiStore((s) => s.config?.providers) ?? NO_PROVIDERS;
  if (!allowed) return null;
  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.keys.title')}</BlockTitle>
      <p className="text-xs max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.keys.hint')}</p>
      <ul className="space-y-4">
        {providers.map((p) => <KeyRow key={p.id} provider={p} />)}
      </ul>
    </section>
  );
}
