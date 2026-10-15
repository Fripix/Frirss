import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useAiStore } from '../../stores/aiStore';
import { useUiStore } from '../../stores/uiStore';
import ToggleSwitch from '../ToggleSwitch';
import ConfirmDialog from '../ConfirmDialog';
import {
  getAiProviders, createAiProvider, updateAiProvider, deleteAiProvider, reorderAiProviders, testAiProvider, updateAiSettings,
  type AiProviderAdmin, type AiAdminSettings, type AiProviderInput,
} from '../../api/backend';

const EMPTY: AiProviderInput = { name: '', type: 'openai', baseUrl: '', model: '', adminKey: '', shared: true };
const NO_SETTINGS: AiAdminSettings = { enabled: false, userKeysAllowed: false, dailyCap: 50, defaultProvider: null };

const inputStyle = { border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' } as const;
const inputClass = 'prefs-tap-row w-full px-3 py-1.5 text-sm rounded-md min-h-[36px]';
const quietBtn = 'prefs-tap-btn px-2.5 py-1.5 text-xs rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-default';

/**
 * Section « IA » (spec §10). Le bloc « Résumés » (réglages de chacun) pour
 * tous, puis, pour l'admin seul, le bloc « Fournisseurs ». Rien n'est chargé
 * pour un non-admin : les routes admin lui sont fermées, inutile de les appeler.
 */
export default function AiTab({ active = true }: { active?: boolean }) {
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  return (
    <div className="space-y-8 max-w-2xl">
      <SummariesBlock showIntro={!isAdmin} />
      {isAdmin && <AdminProviders active={active} />}
    </div>
  );
}

function BlockTitle({ children }: { children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-bold" style={{ color: 'var(--list-title)' }}>
      <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
      {children}
    </h3>
  );
}

/**
 * Bloc « Résumés » : la longueur visée, en pour cent de l'article. Le
 * pourcentage est formaté par la langue (« 20 % » en français, « 20% » en
 * anglais), sans clé de traduction.
 */
function SummariesBlock({ showIntro }: { showIntro: boolean }) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const ratio = useUiStore((s) => s.aiSummaryRatio);
  const setRatio = useUiStore((s) => s.setAiSummaryRatio);
  let shown: string;
  try {
    shown = new Intl.NumberFormat(i18n?.language || undefined, { style: 'percent' }).format(ratio / 100);
  } catch {
    shown = `${ratio} %`;
  }
  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.user.title')}</BlockTitle>
      {showIntro && <p className="text-sm max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.userIntro')}</p>}
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <label htmlFor={`${uid}-ratio`} className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.user.ratio')}</label>
          <span aria-hidden="true" className="text-sm font-semibold tabular-nums" style={{ color: 'var(--list-title)' }}>{shown}</span>
        </div>
        <input
          id={`${uid}-ratio`} type="range" min={5} max={50} step={5} value={ratio}
          aria-valuetext={shown} aria-describedby={`${uid}-ratio-hint`}
          onChange={(e) => setRatio(Number(e.target.value))}
          className="prefs-tap-row w-full cursor-pointer accent-[var(--accent)]"
        />
        <p id={`${uid}-ratio-hint`} className="text-[11px] mt-1 max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.ratioHint')}</p>
      </div>
    </section>
  );
}

type TestState = { state: 'busy' } | { state: 'ok' } | { state: 'fail'; message?: string };

function AdminProviders({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const uid = useId();
  const reloadConfig = () => { void useAiStore.getState().load(); };
  const [providers, setProviders] = useState<AiProviderAdmin[]>([]);
  const [settings, setSettings] = useState<AiAdminSettings>(NO_SETTINGS);
  const [editing, setEditing] = useState<{ id: number | null; draft: AiProviderInput } | null>(null);
  const [saved, setSaved] = useState(false);
  const [tests, setTests] = useState<Record<number, TestState>>({});
  const [advanced, setAdvanced] = useState(false);
  const [capDraft, setCapDraft] = useState('50');
  const [toDelete, setToDelete] = useState<AiProviderAdmin | null>(null);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  // Dépend de `active` seul : `t` change d'identité au changement de langue, et
  // recharger alors écraserait une saisie en cours avec l'état du serveur.
  useEffect(() => {
    if (!active) return;
    getAiProviders()
      .then((r) => { setProviders(r.providers); setSettings(r.settings); setCapDraft(String(r.settings.dailyCap)); setLoadFailed(false); })
      .catch(() => setLoadFailed(true));
  }, [active]);

  /** Écrit un réglage ; en cas d'échec, l'écran revient à ce que le serveur a gardé. */
  async function saveSettings(patch: Partial<AiAdminSettings>) {
    const before = settings;
    setSettings({ ...settings, ...patch });
    setError('');
    try {
      await updateAiSettings(patch);
      reloadConfig();
    } catch {
      setSettings(before);
      setCapDraft(String(before.dailyCap));
      setError(t('ai.admin.saveError'));
    }
  }

  function startEdit(p: AiProviderAdmin | null) {
    setSaved(false);
    setError('');
    setEditing(p
      ? { id: p.id, draft: { name: p.name, type: p.type, baseUrl: p.baseUrl, model: p.model, adminKey: '', shared: p.shared } }
      : { id: null, draft: { ...EMPTY } });
  }

  async function saveProvider() {
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim() || !d.baseUrl.trim() || !d.model.trim()) { setError(t('ai.admin.missingFields')); return; }
    setError('');
    // Une clé vide veut dire « ne pas y toucher » : elle n'est jamais préremplie.
    const payload: Partial<AiProviderInput> = { ...d, adminKey: d.adminKey ? d.adminKey : undefined };
    try {
      const result = editing.id === null ? await createAiProvider(payload as AiProviderInput) : await updateAiProvider(editing.id, payload);
      setProviders((list) => (editing.id === null ? [...list, result] : list.map((p) => (p.id === result.id ? result : p))));
      // L'éditeur reste ouvert sur le fournisseur enregistré, clé vidée : on peut le tester tout de suite.
      setEditing({ id: result.id, draft: { ...d, adminKey: '' } });
      setSaved(true);
      reloadConfig();
    } catch {
      setError(t('ai.admin.saveError'));
    }
  }

  async function remove(p: AiProviderAdmin) {
    try {
      await deleteAiProvider(p.id);
    } catch {
      setError(t('ai.admin.saveError'));
      return;
    } finally {
      setToDelete(null);
    }
    setProviders((l) => l.filter((x) => x.id !== p.id));
    if (settings.defaultProvider === p.id) setSettings((s) => ({ ...s, defaultProvider: null }));
    if (editing?.id === p.id) setEditing(null);
    reloadConfig();
  }

  async function move(id: number, dir: -1 | 1) {
    const ids = providers.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const before = providers;
    setError('');
    setProviders(ids.map((x) => before.find((p) => p.id === x)!));
    try {
      await reorderAiProviders(ids);
    } catch {
      setProviders(before);
      setError(t('ai.admin.saveError'));
    }
  }

  async function test(id: number) {
    setError('');
    setTests((m) => ({ ...m, [id]: { state: 'busy' } }));
    try {
      const r = await testAiProvider(id);
      setTests((m) => ({ ...m, [id]: r.ok ? { state: 'ok' } : { state: 'fail', message: r.message } }));
    } catch {
      setTests((m) => ({ ...m, [id]: { state: 'fail' } }));
    }
  }

  const setDraft = (patch: Partial<AiProviderInput>) =>
    setEditing((ed) => ed && ({ ...ed, draft: { ...ed.draft, ...patch } }));

  const labelClass = 'block text-xs mb-1';
  const labelStyle = { color: 'var(--list-summary)' };
  const draft = editing?.draft;
  const editedHasKey = editing?.id != null && providers.find((p) => p.id === editing.id)?.hasAdminKey;

  const textField = (key: 'name' | 'baseUrl' | 'model' | 'adminKey', label: string, opts: { type?: string; placeholder?: string; autoComplete?: string; hint?: string } = {}) => (
    <div>
      <label htmlFor={`${uid}-${key}`} className={labelClass} style={labelStyle}>{label}</label>
      <input
        id={`${uid}-${key}`} type={opts.type ?? 'text'} value={(draft?.[key] as string) ?? ''}
        placeholder={opts.placeholder} autoComplete={opts.autoComplete ?? 'off'} spellCheck={false}
        aria-describedby={opts.hint ? `${uid}-${key}-hint` : undefined}
        onChange={(e) => setDraft({ [key]: e.target.value })}
        className={inputClass} style={inputStyle}
      />
      {opts.hint && <p id={`${uid}-${key}-hint`} className="text-[11px] mt-1 break-words" style={{ color: 'var(--list-summary)' }}>{opts.hint}</p>}
    </div>
  );

  return (
    <section className="space-y-5">
      <BlockTitle>{t('ai.admin.title')}</BlockTitle>

      <div className="prefs-tap-row flex items-center justify-between gap-3">
        <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.admin.enable')}</span>
        <ToggleSwitch checked={settings.enabled} onChange={(v) => saveSettings({ enabled: v })} ariaLabel={t('ai.admin.enable')} />
      </div>

      {(error || loadFailed) && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{error || t('ai.admin.loadError')}</p>}

      {providers.length > 0 && (
        <ul className="space-y-2">
          {providers.map((p, i) => {
            const res = tests[p.id];
            return (
              <li key={p.id} className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--list-title)' }}>{p.name}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--list-summary)' }}>
                      {p.type === 'anthropic' ? t('ai.admin.typeAnthropic') : t('ai.admin.typeOpenai')} / {p.model}
                      {p.hasAdminKey && <span className="ml-2" style={{ color: 'var(--accent)' }}>{t('ai.admin.keySet')}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-0.5 -mr-1.5" style={{ color: 'var(--list-title)' }}>
                    <button type="button" aria-label={t('ai.admin.moveUp')} disabled={i === 0} onClick={() => move(p.id, -1)} className={quietBtn}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button type="button" aria-label={t('ai.admin.moveDown')} disabled={i === providers.length - 1} onClick={() => move(p.id, 1)} className={quietBtn}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    <button type="button" aria-label={`${t('ai.admin.test')} — ${p.name}`} onClick={() => test(p.id)} disabled={res?.state === 'busy'} className={quietBtn}>{t('ai.admin.test')}</button>
                    <button type="button" aria-label={`${t('ai.admin.edit')} — ${p.name}`} onClick={() => startEdit(p)} className={quietBtn}>{t('ai.admin.edit')}</button>
                    <button type="button" aria-label={`${t('ai.admin.delete')} — ${p.name}`} onClick={() => setToDelete(p)} className={quietBtn} style={{ color: 'var(--danger)' }}>{t('ai.admin.delete')}</button>
                  </div>
                </div>
                {res && (
                  <p role="status" className="text-xs mt-1" style={{ color: res.state === 'fail' ? 'var(--danger)' : res.state === 'ok' ? 'var(--accent)' : 'var(--list-summary)' }}>
                    <span>{res.state === 'busy' ? t('ai.admin.testing') : res.state === 'ok' ? t('ai.admin.testOk') : t('ai.admin.testFailed')}</span>
                    {res.state === 'fail' && res.message && <span className="ml-2 opacity-80">{res.message}</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {draft ? (
        <div className="space-y-3 rounded-lg p-3" style={{ border: '1px solid var(--panel-border)' }}>
          {textField('name', t('ai.admin.name'))}
          <div>
            <label htmlFor={`${uid}-type`} className={labelClass} style={labelStyle}>{t('ai.admin.type')}</label>
            <select id={`${uid}-type`} value={draft.type} onChange={(e) => setDraft({ type: e.target.value as 'anthropic' | 'openai' })} className={inputClass} style={inputStyle}>
              <option value="openai">{t('ai.admin.typeOpenai')}</option>
              <option value="anthropic">{t('ai.admin.typeAnthropic')}</option>
            </select>
          </div>
          {textField('baseUrl', t('ai.admin.baseUrl'), { type: 'url', hint: t('ai.admin.baseUrlHint') })}
          {textField('model', t('ai.admin.model'))}
          {textField('adminKey', t('ai.admin.key'), { type: 'password', autoComplete: 'new-password', placeholder: editedHasKey ? t('ai.admin.keyKeep') : undefined })}
          <label className="prefs-tap-row flex items-center gap-2 text-xs" style={{ color: 'var(--list-title)' }}>
            <input type="checkbox" checked={!!draft.shared} onChange={(e) => setDraft({ shared: e.target.checked })} />
            {t('ai.admin.shared')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveProvider} className="prefs-tap-btn px-4 py-1.5 text-xs font-semibold rounded-md cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{t('ai.admin.save')}</button>
            <button type="button" onClick={() => setEditing(null)} className={quietBtn} style={{ color: 'var(--list-title)' }}>{t('ai.admin.close')}</button>
            {saved && <span role="status" className="text-xs" style={{ color: 'var(--accent)' }}>{t('ai.admin.saved')}</span>}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => startEdit(null)} className="prefs-tap-btn px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer" style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}>
          {t('ai.admin.add')}
        </button>
      )}

      {providers.length > 0 && (
        <div>
          <label htmlFor={`${uid}-default`} className={labelClass} style={labelStyle}>{t('ai.admin.defaultProvider')}</label>
          <select
            id={`${uid}-default`} value={settings.defaultProvider ?? ''} className={inputClass} style={inputStyle}
            onChange={(e) => saveSettings({ defaultProvider: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{t('ai.admin.none')}</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{`${p.name} (${p.model})`}</option>)}
          </select>
        </div>
      )}

      <div>
        <button
          type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} aria-controls={`${uid}-advanced`}
          className="prefs-tap-row flex items-center gap-1.5 text-xs font-semibold cursor-pointer" style={{ color: 'var(--list-summary)' }}
        >
          <svg className={`w-3 h-3 transition-transform ${advanced ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          {t('ai.admin.advanced')}
        </button>
        {advanced && (
          <div id={`${uid}-advanced`} className="mt-2 space-y-4 pl-4" style={{ borderLeft: '1px solid var(--panel-border)' }}>
            <div className="prefs-tap-row flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.admin.userKeysAllowed')}</span>
              <ToggleSwitch checked={settings.userKeysAllowed} onChange={(v) => saveSettings({ userKeysAllowed: v })} ariaLabel={t('ai.admin.userKeysAllowed')} />
            </div>
            <div>
              <label htmlFor={`${uid}-cap`} className={labelClass} style={labelStyle}>{t('ai.admin.dailyCap')}</label>
              <input
                id={`${uid}-cap`} type="number" inputMode="numeric" min={0} value={capDraft} aria-describedby={`${uid}-cap-hint`}
                onChange={(e) => setCapDraft(e.target.value)}
                onBlur={() => {
                  // Un champ vidé ou illisible n'est pas « 0 = illimité » : il revient à la valeur enregistrée.
                  const raw = capDraft.trim();
                  if (!/^\d+$/.test(raw)) { setCapDraft(String(settings.dailyCap)); return; }
                  const n = parseInt(raw, 10);
                  setCapDraft(String(n));
                  if (n !== settings.dailyCap) void saveSettings({ dailyCap: n });
                }}
                className={`${inputClass} !w-32`} style={inputStyle}
              />
              <p id={`${uid}-cap-hint`} className="text-[11px] mt-1" style={{ color: 'var(--list-summary)' }}>{t('ai.admin.dailyCapHint')}</p>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('ai.admin.deleteTitle')}
        message={toDelete?.name}
        confirmLabel={t('ai.admin.delete')}
        onConfirm={() => toDelete ? remove(toDelete) : undefined}
        onCancel={() => setToDelete(null)}
      />
    </section>
  );
}
