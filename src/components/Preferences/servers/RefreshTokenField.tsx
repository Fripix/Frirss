import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updateServer, startActualize, getActualizeStatus } from '../../../api/backend';
import { useFeedStore } from '../../../stores/feedStore';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

interface RefreshTokenFieldProps {
  serverId: number;
  /** Le drapeau global `hasRefreshToken` décrit le serveur courant : ne
   *  l'écrire que depuis la ligne de ce serveur-là. */
  isActive: boolean;
  configured: boolean;
  onSaved: () => void;
}

/**
 * Jeton maître de rafraîchissement d'UN serveur. Le jeton est en écriture
 * seule : le backend ne renvoie jamais sa valeur, seulement s'il en existe un.
 */
export default function RefreshTokenField({ serverId, isActive, configured, onSaved }: RefreshTokenFieldProps) {
  const { t } = useTranslation();
  const setHasRefreshToken = useFeedStore((s) => s.setHasRefreshToken);

  const [token, setToken] = useState('');
  // Le champ est vide mais affiche des puces quand un jeton est stocké, ce qui
  // se lit comme pré-rempli. Save envoie ce que contient le champ, et le
  // backend traite '' comme un effacement explicite — un Save non touché
  // effaçait donc un jeton qui marchait. Seule une édition réelle arme le
  // bouton. Vider le champ EST une édition, effacer volontairement marche donc.
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>('idle');
  // runTest scrute jusqu'à 30 s ; Préférences peut être fermé bien avant.
  const unmounted = useRef(false);
  useEffect(() => () => { unmounted.current = true; }, []);

  async function save() {
    if (!edited) return;
    setSaving(true);
    setTest('idle');
    try {
      await updateServer(serverId, { refreshToken: token });
      if (isActive) setHasRefreshToken(token !== '');
      setToken('');
      setEdited(false);
      onSaved();
    } catch {
      // Save a échoué : laisser le jeton tapé en place pour que le bouton ne
      // mente pas sur ce qui a été enregistré, et réutiliser la formulation
      // d'échec du test plutôt que d'ajouter une clé.
      setTest('fail');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTest('testing');
    try {
      // Éprouver la valeur du champ, pas le jeton stocké : celui qui colle un
      // jeton fraîchement tourné et lance Test avant Save ne doit pas recevoir
      // un refus portant sur le jeton qu'il remplace. Un champ édité laissé
      // vide veut dire « effacer au Save » — pour Test, on retombe alors sur le
      // jeton stocké plutôt que d'en envoyer un vide.
      const testToken = edited && token !== '' ? token : undefined;
      // maxFeeds=1 : prouve que le jeton est accepté sans lancer une passe
      // complète. kind 'test' : son propre créneau, pour qu'une passe déjà en
      // vol ne soit pas rendue ici et n'expire pas en « jeton refusé ».
      const job = await startActualize(serverId, 'test', 1, testToken);
      if (!job) {
        setTest('fail');
        return;
      }
      // Le POST confirme seulement qu'un jeton est stocké ; l'appel réel à
      // FreshRSS a lieu ensuite, sans retour. Scruter le vrai résultat plutôt
      // que de croire le 202. Borné à ~30 s.
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (unmounted.current) return;
        const status = await getActualizeStatus(serverId, 'test');
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
    <div className="space-y-3">
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

      {/* Avertissement de portée — ce jeton donne aussi accès en lecture à
          tout, pas seulement au rafraîchissement : il reste dans le flux
          plutôt que replié derrière un dépliant. */}
      <div
        className="px-4 py-3 rounded-lg text-xs flex items-start gap-2"
        style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
      >
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span>{t('preferences.refresh.scopeWarning')}</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={saving || !edited}
          aria-busy={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[44px]"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {saving && (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {t('preferences.refresh.save')}
        </button>
        <button
          type="button"
          onClick={runTest}
          // Actif dès qu'il y a un jeton à éprouver — stocké, ou tapé à
          // l'instant. Le conditionner au seul `configured` piégeait celui qui
          // collait un jeton de remplacement : Test restait lié à l'ancien
          // jusqu'au Save, donc vérifier avant de valider était impossible.
          disabled={(!configured && token === '') || saving || test === 'testing'}
          aria-busy={test === 'testing'}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:bg-black/5 disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[44px]"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {test === 'testing' && (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
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
