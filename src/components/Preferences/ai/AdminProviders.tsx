import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../../hooks/useBreakpoint';
import { useAiStore } from '../../../stores/aiStore';
import ToggleSwitch from '../../ToggleSwitch';
import ConfirmDialog from '../../ConfirmDialog';
import BottomSheet from '../../BottomSheet';
import Popover from '../../ReadingPane/Popover';
import {
  getAiProviders, createAiProvider, updateAiProvider, deleteAiProvider, reorderAiProviders, testAiProvider, updateAiSettings, listAiModels,
  type AiProviderAdmin, type AiAdminSettings, type AiProviderInput,
} from '../../../api/backend';
import { BlockTitle } from './shared';
import { inputClass, inputStyle, quietBtn } from './styles';

// `shared` éteint d'origine : partager une clé admin, c'est faire payer
// l'instance pour tous les utilisateurs — une case cochée exprès, pas un défaut.
const EMPTY: AiProviderInput = { name: '', type: 'openai', baseUrl: '', model: '', adminKey: '', shared: false };
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
  const [capDraft, setCapDraft] = useState('50');
  const [toDelete, setToDelete] = useState<AiProviderAdmin | null>(null);
  const [toClearKey, setToClearKey] = useState<AiProviderAdmin | null>(null);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [models, setModels] = useState<ModelsState | null>(null);
  const [modelFilter, setModelFilter] = useState('');
  // Une réponse arrivée après un changement d'URL, de type ou de clé ne s'affiche pas.
  const listSeq = useRef(0);
  const dropModels = () => { listSeq.current++; setModels(null); setModelFilter(''); };

  // Le menu « ⋯ » d'une ligne : un popover ancré à la souris, une feuille du
  // bas au doigt — comme « Résumer avec… » dans le volet de lecture.
  const touch = useBreakpoint() !== 'desktop';
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const menuProvider = menuFor === null ? null : providers.find((p) => p.id === menuFor) ?? null;
  // Ajustement pendant le rendu : le menu d'un fournisseur disparu ne rouvre pas.
  if (menuFor !== null && !menuProvider) setMenuFor(null);
  // Stable : le Popover s'abonne au clavier avec cette référence.
  const closeMenu = useCallback(() => {
    setMenuFor(null);
    menuAnchor.current?.focus();
  }, []);
  // Monter ou descendre déplace la ligne dans le DOM, et un élément déplacé
  // perd le focus : il revient au bouton « ⋯ » une fois la liste reposée.
  const refocusAnchor = useRef(false);
  useLayoutEffect(() => {
    if (!refocusAnchor.current) return;
    refocusAnchor.current = false;
    menuAnchor.current?.focus();
  }, [providers]);

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

  /** Efface la clé enregistrée (`adminKey: null`) ; ce que l'on a tapé dans le champ n'est pas touché. */
  async function clearKey(p: AiProviderAdmin) {
    setError('');
    try {
      const result = await updateAiProvider(p.id, { adminKey: null });
      setProviders((list) => list.map((x) => (x.id === result.id ? result : x)));
      // La liste de modèles a été demandée avec l'ancienne clé enregistrée.
      dropModels();
      reloadConfig();
    } catch {
      setError(t('ai.admin.saveError'));
    } finally {
      setToClearKey(null);
    }
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
  const editedProvider = editing?.id != null ? providers.find((p) => p.id === editing.id) : undefined;

  const textField = (key: 'name' | 'baseUrl', label: string, opts: { type?: string; hint?: string } = {}) => (
    <div>
      <label htmlFor={`${uid}-${key}`} className={labelClass} style={labelStyle}>{label}</label>
      <input
        id={`${uid}-${key}`} type={opts.type ?? 'text'} value={draft?.[key] ?? ''} autoComplete="off" spellCheck={false}
        aria-describedby={opts.hint ? `${uid}-${key}-hint` : undefined}
        onChange={(e) => setDraft({ [key]: e.target.value })}
        className={inputClass} style={inputStyle}
      />
      {opts.hint && <p id={`${uid}-${key}-hint`} className="text-[11px] mt-1 break-words" style={{ color: 'var(--list-summary)' }}>{opts.hint}</p>}
    </div>
  );

  /**
   * Les actions rares d'une ligne. Les impossibles (monter le premier,
   * descendre le dernier, redéfinir le défaut) restent dans le menu,
   * `aria-disabled` plutôt que `disabled` : les flèches du menu passent
   * dessus au lieu de s'y arrêter, et la liste ne change pas de forme d'une
   * ligne à l'autre. Le défaut se lit alors « Fournisseur par défaut », coché.
   */
  const menuItems = (p: AiProviderAdmin) => {
    const i = providers.findIndex((x) => x.id === p.id);
    const isDefault = settings.defaultProvider === p.id;
    const row = `flex items-center gap-2.5 w-full text-left rounded-md cursor-pointer hover:bg-black/5 aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent ${touch ? 'sheet-row px-4 text-[15px]' : 'px-3 py-1.5 text-xs'}`;
    const item = (label: string, icon: ReactNode, run: () => void, opts: { disabled?: boolean; danger?: boolean; ariaLabel?: string; iconColor?: string } = {}) => (
      <button
        type="button" role={touch ? undefined : 'menuitem'} aria-disabled={opts.disabled || undefined} aria-label={opts.ariaLabel}
        onClick={opts.disabled ? undefined : run}
        className={row} style={{ color: opts.danger ? 'var(--danger)' : 'var(--list-title)' }}
      >
        <span aria-hidden="true" className="w-4 flex justify-center flex-shrink-0" style={opts.iconColor ? { color: opts.iconColor } : undefined}>{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    );
    const moveTo = (dir: -1 | 1) => () => { refocusAnchor.current = true; closeMenu(); void move(p.id, dir); };
    return (
      <>
        {item(t('ai.admin.moveUp'), <Icon d="M5 15l7-7 7 7" strokeWidth={2.5} />, moveTo(-1), { disabled: i <= 0 })}
        {item(t('ai.admin.moveDown'), <Icon d="M19 9l-7 7-7-7" strokeWidth={2.5} />, moveTo(1), { disabled: i === providers.length - 1 })}
        {item(
          isDefault ? t('ai.admin.defaultProvider') : t('ai.admin.setDefault'),
          <Icon d="M5 13l4 4L19 7" strokeWidth={isDefault ? 3 : 2} />,
          () => { closeMenu(); void saveSettings({ defaultProvider: p.id }); },
          { disabled: isDefault, iconColor: isDefault ? 'var(--accent)' : 'var(--list-summary)' },
        )}
        <div role={touch ? undefined : 'separator'} className="my-1 mx-2 h-px" style={{ background: 'var(--panel-border)' }} />
        {item(
          t('ai.admin.delete'),
          <Icon d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" />,
          () => { closeMenu(); setToDelete(p); },
          { danger: true, ariaLabel: `${t('ai.admin.delete')} — ${p.name}` },
        )}
      </>
    );
  };

  return (
    <section className="space-y-5">
      {/* L'interrupteur général vit sur la ligne du titre : il gouverne tout
          le bloc. Trop long à 320 px, il passe dessous, aligné à droite. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <BlockTitle>{t('ai.admin.title')}</BlockTitle>
        <div className="prefs-tap-row ml-auto flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.admin.enable')}</span>
          <ToggleSwitch checked={settings.enabled} onChange={(v) => saveSettings({ enabled: v })} ariaLabel={t('ai.admin.enable')} />
        </div>
      </div>

      {(error || loadFailed) && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{error || t('ai.admin.loadError')}</p>}

      <div className="space-y-3">
        {providers.length > 0 && (
          <ul className="rounded-lg" style={{ border: '1px solid var(--panel-border)' }}>
            {providers.map((p, i) => (
              <ProviderRow
                key={p.id} provider={p} first={i === 0} isDefault={settings.defaultProvider === p.id} test={tests[p.id]}
                menuOpen={menuFor === p.id} touch={touch}
                onTest={() => test(p.id)} onEdit={() => startEdit(p)}
                onMore={(el) => { menuAnchor.current = el; setMenuFor((cur) => (cur === p.id ? null : p.id)); }}
              />
            ))}
          </ul>
        )}

        {draft ? (
          <div role="group" aria-labelledby={`${uid}-editor`} className="space-y-4 rounded-lg p-3 sm:p-4" style={{ border: '1px solid var(--panel-border)' }}>
            <h4 id={`${uid}-editor`} className="text-sm font-semibold" style={{ color: 'var(--list-title)' }}>
              {editedProvider ? t('ai.admin.editTitle', { name: editedProvider.name }) : t('ai.admin.newTitle')}
            </h4>
            {/* Une seule colonne, toujours : la colonne de contenu de Préférences
                fait 462 px au plus, deux colonnes de 180-220 px rognaient le
                sélecteur de type et faisaient passer « Lister les modèles » à
                la ligne. Une requête de conteneur à 560 px ne s'y déclencherait
                jamais ; un point de rupture sur la fenêtre (`sm:`) mentait. */}
            <div className="grid gap-3">
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
                    className={`${inputClass} !w-auto flex-1 basis-32 min-w-0`} style={inputStyle}
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
              </div>
              {models && <div><ModelList
                id={`${uid}-models`} state={models} current={draft.model.trim()} filter={modelFilter}
                onFilter={setModelFilter} onPick={pickModel} onClose={dropModels}
              /></div>}
            </div>
            <div>
              <label htmlFor={`${uid}-adminKey`} className={labelClass} style={labelStyle}>{t('ai.admin.key')}</label>
              {/* « Effacer la clé » au bout du champ qu'elle vide : une action
                  sur la clé enregistrée, pas sur le fournisseur. */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`${uid}-adminKey`} type="password" value={draft.adminKey ?? ''} autoComplete="new-password" spellCheck={false}
                  placeholder={editedProvider?.hasAdminKey ? t('ai.admin.keyKeep') : undefined}
                  onChange={(e) => setDraft({ adminKey: e.target.value })}
                  className={`${inputClass} !w-auto flex-1 basis-48 min-w-0`} style={inputStyle}
                />
                {editedProvider?.hasAdminKey && (
                  <button type="button" onClick={() => setToClearKey(editedProvider)} className={`${quietBtn} whitespace-nowrap hover:bg-black/5`} style={{ color: 'var(--danger)' }}>
                    {t('ai.admin.clearKey')}
                  </button>
                )}
              </div>
            </div>
            <div className="prefs-tap-row flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.admin.shared')}</span>
              <ToggleSwitch checked={!!draft.shared} onChange={(v) => setDraft({ shared: v })} ariaLabel={t('ai.admin.shared')} />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={saveProvider} className="prefs-tap-btn px-4 py-1.5 min-h-[32px] text-xs font-semibold rounded-md cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{t('ai.admin.save')}</button>
              <button type="button" onClick={() => { dropModels(); setEditing(null); }} className={`${quietBtn} min-h-[32px] hover:bg-black/5`} style={{ color: 'var(--list-title)' }}>{t('ai.admin.close')}</button>
              {saved && <span role="status" className="text-xs" style={{ color: 'var(--accent)' }}>{t('ai.admin.saved')}</span>}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => startEdit(null)} className="prefs-tap-btn inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 min-h-[32px] text-xs font-semibold rounded-md cursor-pointer hover:bg-black/5" style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            {t('ai.admin.add')}
          </button>
        )}
      </div>

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

      <ConfirmDialog
        open={toDelete !== null}
        title={t('ai.admin.deleteTitle')}
        message={toDelete?.name}
        confirmLabel={t('ai.admin.delete')}
        onConfirm={() => toDelete ? remove(toDelete) : undefined}
        onCancel={() => setToDelete(null)}
      />
      <ConfirmDialog
        open={toClearKey !== null}
        title={t('ai.admin.clearKeyTitle', { name: toClearKey?.name ?? '' })}
        warning={t('ai.admin.clearKeyWarning')}
        confirmLabel={t('ai.admin.clearKey')}
        onConfirm={() => toClearKey ? clearKey(toClearKey) : undefined}
        onCancel={() => setToClearKey(null)}
      />

      {menuProvider && (touch
        ? <BottomSheet open onClose={closeMenu} title={menuProvider.name}>{menuItems(menuProvider)}</BottomSheet>
        : createPortal(
          <Popover anchor={menuAnchor.current} onClose={closeMenu} label={`${t('ai.admin.more')} — ${menuProvider.name}`}>{menuItems(menuProvider)}</Popover>,
          document.body,
        ))}
    </section>
  );
}

const Icon = ({ d, strokeWidth = 2 }: { d: string; strokeWidth?: number }) => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>
);

/**
 * Le type d'un fournisseur en étiquette courte (« Compatible OpenAI »,
 * « Anthropic ») : l'intitulé complet, avec sa liste d'exemples, sert au
 * choix dans l'éditeur, pas à la lecture d'une ligne. Coupé au-delà de
 * 8 rem sous 640 px (10 au-dessus) : à 320 px, il partage sa ligne avec le nom
 * et le badge, et c'est le nom qui doit rester lisible.
 */
function TypeTag({ type, className = '' }: { type: AiProviderAdmin['type']; className?: string }) {
  const { t } = useTranslation();
  const label = type === 'anthropic' ? t('ai.admin.typeAnthropicShort') : t('ai.admin.typeOpenaiShort');
  return (
    <span
      className={`inline-block max-w-[8rem] sm:max-w-[10rem] truncate px-1.5 rounded text-[11px] leading-[18px] ${className}`}
      style={{ border: '1px solid var(--panel-border)', color: 'var(--list-summary)' }}
    >
      {label}
    </span>
  );
}

/**
 * Une ligne de la liste. Une grille de deux colonnes : à gauche le nom (et le
 * badge « par défaut ») puis le modèle ; à droite l'étiquette de type puis les
 * actions. Sous 640 px, le modèle et les actions prennent chacun toute la
 * largeur — trois lignes, boutons alignés à droite, 44 px au doigt
 * (`prefs-tap-btn`). Monter, descendre, définir par défaut et supprimer
 * vivent dans le menu « ⋯ » : à la ligne, ils faisaient cinq boutons pour
 * deux usages fréquents.
 */
function ProviderRow({ provider: p, first, isDefault, test: res, menuOpen, touch, onTest, onEdit, onMore }: {
  provider: AiProviderAdmin; first: boolean; isDefault: boolean; test: TestState | undefined; menuOpen: boolean; touch: boolean;
  onTest: () => void; onEdit: () => void; onMore: (anchor: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const muted = 'var(--list-summary)';
  const resColor = !res ? muted : res.state === 'fail' ? 'var(--danger)' : res.state === 'ok' ? 'var(--accent)' : muted;
  const rowBtn = `${quietBtn} min-h-[32px] hover:bg-black/5`;
  return (
    <li className="px-3 py-2.5" style={first ? undefined : { borderTop: '1px solid var(--panel-border)' }}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:gap-x-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate" title={p.name} style={{ color: 'var(--list-title)' }}>{p.name}</span>
          {isDefault && (
            <span className="flex-shrink-0 whitespace-nowrap px-1.5 rounded-full text-[11px] leading-[18px] font-medium" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              {t('ai.admin.defaultBadge')}
            </span>
          )}
        </div>
        <TypeTag type={p.type} className="justify-self-end sm:justify-self-start" />
        {/* Le modèle se coupe, la mention de clé jamais : sans cela un écran
            étroit ne la montrerait pas. */}
        <div className="col-span-2 sm:col-span-1 flex items-baseline gap-1 min-w-0 text-[11px]" style={{ color: muted }}>
          <span className="truncate min-w-0" title={p.model}>{p.model}</span>
          {p.hasAdminKey && (
            <span className="flex-shrink-0 whitespace-nowrap">
              <span aria-hidden="true">· </span>
              <span style={{ color: 'var(--accent)' }}>{t('ai.admin.keySet')}</span>
            </span>
          )}
        </div>
        <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-1 -mr-1.5" style={{ color: 'var(--list-title)' }}>
          <button type="button" aria-label={`${t('ai.admin.test')} — ${p.name}`} onClick={onTest} disabled={res?.state === 'busy'} className={rowBtn}>{t('ai.admin.test')}</button>
          <button type="button" aria-label={`${t('ai.admin.edit')} — ${p.name}`} onClick={onEdit} className={rowBtn}>{t('ai.admin.edit')}</button>
          <button
            type="button" onClick={(e) => onMore(e.currentTarget)}
            aria-label={`${t('ai.admin.more')} — ${p.name}`} aria-haspopup={touch ? 'dialog' : 'menu'} aria-expanded={menuOpen}
            className="prefs-tap-btn inline-flex items-center justify-center w-8 h-8 rounded-md cursor-pointer hover:bg-black/5"
            style={menuOpen ? { background: 'var(--panel-header-bg)' } : undefined}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /></svg>
          </button>
        </div>
      </div>
      {res && (
        <div role="status" className="mt-1.5 flex items-start gap-1.5 text-xs" style={{ color: resColor }}>
          {/* La pastille dit l'issue d'un coup d'œil ; le texte, la cause. */}
          <span aria-hidden="true" className="mt-[5px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: resColor }} />
          <div className="min-w-0">
            <p>{res.state === 'busy' ? t('ai.admin.testing') : res.state === 'ok' ? t('ai.admin.testOk') : t(testFailKey(res.kind))}</p>
            {res.state === 'fail' && res.message && <p className="mt-0.5 text-[11px] opacity-80 break-words">{res.message}</p>}
          </div>
        </div>
      )}
    </li>
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
