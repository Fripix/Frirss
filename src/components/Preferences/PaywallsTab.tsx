import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { savePreferences } from '../../api/backend';
import { useUiStore } from '../../stores/uiStore';
import { parseArchiveDomains } from '../../lib/archiveDomains';

export default function PaywallsTab() {
  const { t } = useTranslation();
  const [domainsText, setDomainsText] = useState(() => useUiStore.getState().archiveDomains.join('\n'));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  async function saveDomains() {
    const parsed = parseArchiveDomains(domainsText);
    if (parsed.invalid.length) {
      setStatus({ text: t('preferences.aiSummaries.archiveDomainsInvalid'), error: true });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await savePreferences({ archiveDomains: parsed.domains });
      useUiStore.getState().setArchiveDomains(parsed.domains);
      setDomainsText(parsed.domains.join('\n'));
      setStatus({ text: t('preferences.aiSummaries.archiveDomainsSaved') });
    } catch {
      setStatus({ text: t('preferences.aiSummaries.archiveDomainsError'), error: true });
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
  const fieldStyle = { background: 'var(--panel-header-bg)', color: 'var(--list-title)', border: '1px solid var(--panel-border)' };
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="text-base font-bold" style={{ color: 'var(--list-title)' }}>{t('preferences.sections.paywalls', 'Paywalls')}</h3>
        <p className="mt-1 text-xs whitespace-pre-line" style={{ color: 'var(--list-summary)' }}>{t('preferences.aiSummaries.archiveDomainsHint')}</p>
      </div>
      <textarea
        className={fieldClass}
        style={{ ...fieldStyle, minHeight: 150, resize: 'vertical' }}
        value={domainsText}
        onChange={(e) => { setDomainsText(e.target.value); setStatus(null); }}
        placeholder={t('preferences.aiSummaries.archiveDomainsPlaceholder')}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        rows={8}
        aria-label={t('preferences.aiSummaries.archiveDomainsTitle')}
      />
      {status && <p role="status" className="text-xs" style={{ color: status.error ? 'var(--danger)' : 'var(--accent)' }}>{status.text}</p>}
      <button type="button" onClick={saveDomains} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ color: '#fff', background: 'var(--accent)' }}>{saving ? t('preferences.aiSummaries.saving') : t('preferences.aiSummaries.archiveDomainsSave')}</button>
    </div>
  );
}
