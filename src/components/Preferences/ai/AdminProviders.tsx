import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '../../../stores/aiStore';
import ToggleSwitch from '../../ToggleSwitch';
import ConfirmDialog from '../../ConfirmDialog';
import {
  getAiProviders, createAiProvider, updateAiProvider, deleteAiProvider, reorderAiProviders, testAiProvider, updateAiSettings, listAiModels,
  type AiProviderAdmin, type AiAdminSettings, type AiProviderInput,
} from '../../../api/backend';
import { BlockTitle, inputClass, inputStyle, quietBtn } from './shared';

const EMPTY: AiProviderInput = { name: '', type: 'openai', baseUrl: '', model: '', adminKey: '', shared: true };
const NO_SETTINGS: AiAdminSettings = { enabled: false, userKeysAllowed: false, dailyCap: 50, defaultProvider: null };

type TestState = { state: 'busy' } | { state: 'ok' } | { state: 'fail'; kind?: string; message?: string };
/** Une cause par message : un manque de crédits n'est pas une URL à vérifier. */
const testFailKey = (kind?: string) => (kind === 'auth' ? 'ai.admin.testAuth' : kind === 'quota' ? 'ai.admin.testQuota' : 'ai.admin.testFailed');
type ModelsState = { state: 'busy' } | { state: 'ok'; models: string[] } | { state: 'fail'; auth: boolean };
/** Au-delà, la liste reçoit un champ de filtre (OpenAI en renvoie des dizaines, OpenRouter des centaines). */
const FILTER_FROM = 12;

export default function AdminProviders({ active }: { active: boolean }) {
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
  const [models, setModels] = useState<ModelsState | null>(null);
  const [modelFilter, setModelFilter] = useState('');
  // Une réponse arrivée après un changement d'URL, de type ou de clé ne s'affiche pas.
  const listSeq = useRef(0);
  const dropModels = () => { listSeq.current++; setModels(null); setModelFilter(''); };

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
    dropModels();
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
      setTests((m) => ({ ...m, [id]: r.ok ? { state: 'ok' } : { state: 'fail', kind: r.kind, message: r.message } }));
    } catch {
      setTests((m) => ({ ...m, [id]: { state: 'fail' } }));
    }
  }

  const setDraft = (patch: Partial<AiProviderInput>) => {
    // La liste vaut pour une URL, un type et une clé : en changer la rend fausse.
    if ('type' in patch || 'baseUrl' in patch || 'adminKey' in patch) dropModels();
    setEditing((ed) => ed && ({ ...ed, draft: { ...ed.draft, ...patch } }));
  };

  /**
   * Interroge le fournisseur tel qu'il est saisi, enregistré ou non. Clé vide en
   * modification : le serveur reprend la clé enregistrée, pour la même URL seulement.
   */
  async function fetchModels() {
    if (!editing) return;
    const d = editing.draft;
    const seq = ++listSeq.current;
    setModels({ state: 'busy' });
    setModelFilter('');
    try {
      const r = await listAiModels({
        type: d.type, baseUrl: d.baseUrl.trim(),
        ...(d.adminKey ? { adminKey: d.adminKey } : {}),
        ...(editing.id != null ? { providerId: editing.id } : {}),
      });
      if (seq !== listSeq.current) return;
      setModels(r.ok ? { state: 'ok', models: r.models ?? [] } : { state: 'fail', auth: r.kind === 'auth' });
    } catch {
      if (seq === listSeq.current) setModels({ state: 'fail', auth: false });
    }
  }

  function pickModel(id: string) {
    setDraft({ model: id });
    dropModels();
    document.getElementById(`${uid}-model`)?.focus();
  }

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
            const typeLabel = p.type === 'anthropic' ? t('ai.admin.typeAnthropic') : t('ai.admin.typeOpenai');
            return (
              <li key={p.id} className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--list-title)' }}>{p.name}</div>
                    {/* Le modèle d'abord, le type ensuite : c'est le type, long, que la coupe mange. La
                        mention de clé reste hors de la coupe, sinon un écran étroit ne la montre jamais. */}
                    <div className="flex items-baseline gap-2 text-[11px]" style={{ color: 'var(--list-summary)' }}>
                      <span className="truncate min-w-0" title={`${p.model} / ${typeLabel}`}>{`${p.model} / ${typeLabel}`}</span>
                      {p.hasAdminKey && <span className="flex-shrink-0 whitespace-nowrap" style={{ color: 'var(--accent)' }}>{t('ai.admin.keySet')}</span>}
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
                  <div role="status" className="text-xs mt-1" style={{ color: res.state === 'fail' ? 'var(--danger)' : res.state === 'ok' ? 'var(--accent)' : 'var(--list-summary)' }}>
                    <p>{res.state === 'busy' ? t('ai.admin.testing') : res.state === 'ok' ? t('ai.admin.testOk') : t(testFailKey(res.kind))}</p>
                    {res.state === 'fail' && res.message && <p className="mt-0.5 text-[11px] opacity-80 break-words">{res.message}</p>}
                  </div>
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
          <div>
            <label htmlFor={`${uid}-model`} className={labelClass} style={labelStyle}>{t('ai.admin.model')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`${uid}-model`} type="text" value={draft.model} autoComplete="off" spellCheck={false}
                onChange={(e) => setDraft({ model: e.target.value })}
                className={`${inputClass} !w-auto flex-1 basis-40 min-w-0`} style={inputStyle}
              />
              <button
                type="button" onClick={fetchModels} aria-controls={`${uid}-models`}
                disabled={!draft.baseUrl.trim() || models?.state === 'busy'}
                className="prefs-tap-btn px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-default"
                style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
              >
                {t('ai.admin.models.list')}
              </button>
            </div>
            {models && <ModelList
              id={`${uid}-models`} state={models} current={draft.model.trim()} filter={modelFilter}
              onFilter={setModelFilter} onPick={pickModel} onClose={dropModels}
            />}
          </div>
          {textField('adminKey', t('ai.admin.key'), { type: 'password', autoComplete: 'new-password', placeholder: editedHasKey ? t('ai.admin.keyKeep') : undefined })}
          <label className="prefs-tap-row flex items-center gap-2 text-xs" style={{ color: 'var(--list-title)' }}>
            <input type="checkbox" checked={!!draft.shared} onChange={(e) => setDraft({ shared: e.target.checked })} />
            {t('ai.admin.shared')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveProvider} className="prefs-tap-btn px-4 py-1.5 text-xs font-semibold rounded-md cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{t('ai.admin.save')}</button>
            <button type="button" onClick={() => { dropModels(); setEditing(null); }} className={quietBtn} style={{ color: 'var(--list-title)' }}>{t('ai.admin.close')}</button>
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

/**
 * Les noms renvoyés par le fournisseur, à cliquer pour remplir le champ
 * « Modèle ». Le champ reste libre : la liste aide, elle ne contraint pas.
 */
function ModelList({ id, state, current, filter, onFilter, onPick, onClose }: {
  id: string; state: ModelsState; current: string; filter: string;
  onFilter: (v: string) => void; onPick: (model: string) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const all = state.state === 'ok' ? state.models : [];
  const needle = filter.trim().toLowerCase();
  const shown = needle ? all.filter((m) => m.toLowerCase().includes(needle)) : all;
  const muted = { color: 'var(--list-summary)' };
  return (
    <div id={id} className="mt-2 rounded-md" style={{ border: '1px solid var(--panel-border)' }}>
      <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-1" style={state.state === 'ok' && all.length ? { borderBottom: '1px solid var(--panel-border)' } : undefined}>
        {state.state === 'busy' && <span role="status" className="text-xs" style={muted}>{t('ai.admin.models.loading')}</span>}
        {state.state === 'fail' && <span role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{t(state.auth ? 'ai.admin.models.authFailed' : 'ai.admin.models.failed')}</span>}
        {state.state === 'ok' && <span role="status" className="text-xs" style={muted}>{all.length ? t('ai.admin.models.count', { count: all.length }) : t('ai.admin.models.empty')}</span>}
        {state.state !== 'busy' && (
          <button type="button" onClick={onClose} className={quietBtn} style={{ color: 'var(--list-title)' }}>{t('ai.admin.models.close')}</button>
        )}
      </div>
      {all.length > FILTER_FROM && (
        <div className="px-2 pt-2">
          <input
            type="search" value={filter} onChange={(e) => onFilter(e.target.value)} autoComplete="off" spellCheck={false}
            aria-label={t('ai.admin.models.filter')} placeholder={t('ai.admin.models.filter')}
            className={inputClass} style={inputStyle}
          />
        </div>
      )}
      {all.length > 0 && (
        shown.length ? (
          <ul className="max-h-56 overflow-y-auto py-1">
            {shown.map((m) => {
              const isCurrent = m === current;
              return (
                <li key={m}>
                  <button
                    type="button" onClick={() => onPick(m)} aria-current={isCurrent ? 'true' : undefined}
                    className="prefs-tap-row flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left cursor-pointer break-all hover:bg-[var(--panel-header-bg)]"
                    style={{ color: isCurrent ? 'var(--accent)' : 'var(--list-title)', fontWeight: isCurrent ? 600 : undefined }}
                  >
                    <span aria-hidden="true" className="w-3.5 flex-shrink-0">
                      {isCurrent && <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </span>
                    {m}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-3 py-2 text-xs" style={muted}>{t('ai.admin.models.noMatch')}</p>
      )}
    </div>
  );
}
