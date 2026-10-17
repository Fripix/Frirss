import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearAiSummaryApiKey, getAiSummaryConfig, saveAiSummaryConfig, savePreferences, testAiSummaryConnection, type AiSummaryConfig } from '../../api/backend';
import { useUiStore } from '../../stores/uiStore';
import { parseArchiveDomains } from '../../lib/archiveDomains';

const DEFAULT_PROMPT = "Summarize this article in 3–5 concise bullet points. Focus on facts, important numbers and implications. Do not add information not present in the article.";

export default function AiSummariesTab({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiSummaryConfig>({ enabled: false, endpoint: 'https://openrouter.ai/api/v1', model: '', prompt: DEFAULT_PROMPT, hasApiKey: false });
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [archiveDomainsText, setArchiveDomainsText] = useState(() => useUiStore.getState().archiveDomains.join('\n'));
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    getAiSummaryConfig().then((value) => { if (!cancelled) setConfig(value); })
      .catch(() => { if (!cancelled) setStatus({ text: t('preferences.aiSummaries.error'), error: true }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, t]);

  function update<K extends keyof AiSummaryConfig>(key: K, value: AiSummaryConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true); setStatus(null);
    try {
      const value = await saveAiSummaryConfig({ enabled: config.enabled, endpoint: config.endpoint, model: config.model, prompt: config.prompt, apiKey: apiKey.trim() || undefined });
      setConfig(value); setApiKey('');
      window.dispatchEvent(new Event('ai-summary-config-changed'));
      setStatus({ text: t('preferences.aiSummaries.saved') });
    } catch { setStatus({ text: t('preferences.aiSummaries.error'), error: true }); }
    finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setStatus(null);
    try {
      await testAiSummaryConnection({ endpoint: config.endpoint, model: config.model, apiKey: apiKey.trim() || undefined });
      setStatus({ text: t('preferences.aiSummaries.testOk') });
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
      setStatus({ text: typeof message === 'string' ? message : t('preferences.aiSummaries.testFailed'), error: true });
    }
    finally { setTesting(false); }
  }

  async function saveArchiveDomains() {
    const parsed = parseArchiveDomains(archiveDomainsText);
    if (parsed.invalid.length) {
      setArchiveStatus({ text: t('preferences.aiSummaries.archiveDomainsInvalid'), error: true });
      return;
    }
    setArchiveSaving(true);
    setArchiveStatus(null);
    try {
      // Persist the per-account preference first; the resolver route reads this
      // same key from the backend database.
      await savePreferences({ archiveDomains: parsed.domains });
      useUiStore.getState().setArchiveDomains(parsed.domains);
      setArchiveDomainsText(parsed.domains.join('\n'));
      setArchiveStatus({ text: t('preferences.aiSummaries.archiveDomainsSaved') });
    } catch {
      setArchiveStatus({ text: t('preferences.aiSummaries.archiveDomainsError'), error: true });
    } finally {
      setArchiveSaving(false);
    }
  }

  async function clearKey() {
    setStatus(null);
    try {
      const value = await clearAiSummaryApiKey();
      setConfig(value); setApiKey('');
      window.dispatchEvent(new Event('ai-summary-config-changed'));
      setStatus({ text: t('preferences.aiSummaries.saved') });
    } catch { setStatus({ text: t('preferences.aiSummaries.error'), error: true }); }
  }

  if (loading) return <div className="text-sm" style={{ color: 'var(--list-summary)' }}>{t('app.loading')}</div>;
  const fieldClass = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
  const fieldStyle = { background: 'var(--panel-header-bg)', color: 'var(--list-title)', border: '1px solid var(--panel-border)' };
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="text-base font-bold" style={{ color: 'var(--list-title)' }}>{t('preferences.sections.aiSummaries')}</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--list-summary)' }}>{t('preferences.aiSummaries.enabledHint')}</p>
      </div>
      <label className="flex items-center gap-3 text-sm" style={{ color: 'var(--list-title)' }}>
        <input type="checkbox" checked={config.enabled} onChange={(e) => update('enabled', e.target.checked)} />
        {t('preferences.aiSummaries.enable')}
      </label>
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold" style={{ color: 'var(--list-title)' }}>{t('preferences.aiSummaries.endpoint')}</label>
        <input className={fieldClass} style={fieldStyle} type="url" value={config.endpoint} onChange={(e) => update('endpoint', e.target.value)} placeholder="https://openrouter.ai/api/v1" autoComplete="url" />
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold" style={{ color: 'var(--list-title)' }}>{t('preferences.aiSummaries.model')}</label>
        <input className={fieldClass} style={fieldStyle} value={config.model} onChange={(e) => update('model', e.target.value)} placeholder="google/gemini-2.5-flash-lite:floor" autoComplete="off" />
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold" style={{ color: 'var(--list-title)' }}>{t('preferences.aiSummaries.apiKey')}</label>
        <input className={fieldClass} style={fieldStyle} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config.hasApiKey ? '••••••••••••••••' : t('preferences.aiSummaries.keyPlaceholder')} autoComplete="new-password" />
        <p className="text-xs" style={{ color: 'var(--list-summary)' }}>{config.hasApiKey ? t('preferences.aiSummaries.stored') : t('preferences.aiSummaries.noKey')}</p>
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold" style={{ color: 'var(--list-title)' }}>{t('preferences.aiSummaries.prompt')}</label>
        <textarea className={fieldClass} style={{ ...fieldStyle, minHeight: 120, resize: 'vertical' }} value={config.prompt} onChange={(e) => update('prompt', e.target.value)} maxLength={4000} />
      </div>
      {status && <p role="status" className="text-xs" style={{ color: status.error ? 'var(--danger)' : 'var(--accent)' }}>{status.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ color: '#fff', background: 'var(--accent)' }}>{saving ? t('preferences.aiSummaries.saving') : t('preferences.aiSummaries.save')}</button>
        <button type="button" onClick={test} disabled={testing || !config.model.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ color: 'var(--list-title)', border: '1px solid var(--panel-border)' }}>{testing ? t('preferences.aiSummaries.testing') : t('preferences.aiSummaries.test')}</button>
        {config.hasApiKey && <button type="button" onClick={clearKey} className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--danger)', border: '1px solid var(--panel-border)' }}>{t('preferences.aiSummaries.clear')}</button>}
      </div>

      <div className="border-t pt-5 space-y-3" style={{ borderColor: 'var(--panel-border)' }}>
        <div>
          <h3 className="text-base font-bold" style={{ color: 'var(--list-title)' }}>{t('preferences.aiSummaries.archiveDomainsTitle')}</h3>
          <p className="mt-1 text-xs whitespace-pre-line" style={{ color: 'var(--list-summary)' }}>{t('preferences.aiSummaries.archiveDomainsHint')}</p>
        </div>
        <textarea
          className={fieldClass}
          style={{ ...fieldStyle, minHeight: 150, resize: 'vertical' }}
          value={archiveDomainsText}
          onChange={(e) => { setArchiveDomainsText(e.target.value); setArchiveStatus(null); }}
          placeholder={t('preferences.aiSummaries.archiveDomainsPlaceholder')}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          rows={8}
          aria-label={t('preferences.aiSummaries.archiveDomainsTitle')}
        />
        {archiveStatus && <p role="status" className="text-xs" style={{ color: archiveStatus.error ? 'var(--danger)' : 'var(--accent)' }}>{archiveStatus.text}</p>}
        <button type="button" onClick={saveArchiveDomains} disabled={archiveSaving} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ color: '#fff', background: 'var(--accent)' }}>{archiveSaving ? t('preferences.aiSummaries.saving') : t('preferences.aiSummaries.archiveDomainsSave')}</button>
      </div>
    </div>
  );
}
