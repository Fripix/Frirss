import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { useFeedStore } from '../../stores/feedStore';
import ToggleSwitch from '../ToggleSwitch';
import {
  imageBudget, defaultPresetMb, OFFLINE_IMAGE_PRESETS,
  type OfflineImageSized,
} from '../../lib/offlineImages';
import { getStorageEstimate, formatBytes, clearImageCache } from '../../lib/storageEstimate';
import { countCachedImages } from '../../lib/imageCache';

export default function OfflineTab() {
  const { t } = useTranslation();
  const offlinePrep = useFeedStore((s) => s.offlinePrep);
  const prepareOffline = useFeedStore((s) => s.prepareOffline);
  const autoOffline = useUiStore((s) => s.autoOffline);
  const setAutoOffline = useUiStore((s) => s.setAutoOffline);
  const offlineImagePreset = useUiStore((s) => s.offlineImagePreset);
  const setOfflineImagePreset = useUiStore((s) => s.setOfflineImagePreset);
  const offlineImageSizes = useUiStore((s) => s.offlineImageSizes);
  const setOfflineImageSize = useUiStore((s) => s.setOfflineImageSize);
  const resetOfflineImageSizes = useUiStore((s) => s.resetOfflineImageSizes);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [imageCount, setImageCount] = useState<number | null>(null);
  const [cleared, setCleared] = useState(false);

  const refreshEstimate = useCallback(() => {
    getStorageEstimate().then(setEstimate);
    countCachedImages().then(setImageCount);
  }, []);
  useEffect(() => { refreshEstimate(); }, [refreshEstimate]);

  const quota = estimate?.quota ?? 0;
  const imagesOff = offlineImagePreset === 'none';
  const budget = imageBudget(offlineImagePreset, offlineImageSizes, quota);
  const overQuota = !imagesOff && quota > 0 && budget.bytes > quota;
  const edited = Object.keys(offlineImageSizes).length > 0;

  const presetLabels: Record<OfflineImageSized, string> = {
    light: t('preferences.offline.imagesLight'),
    standard: t('preferences.offline.imagesStandard'),
    max: t('preferences.offline.imagesMax'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.offline.title')}
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.offline.hint')}
        </p>
        <button
          onClick={() => prepareOffline()}
          disabled={offlinePrep?.running}
          className="px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {offlinePrep?.running
            ? `${t('preferences.offline.preparing')} ${offlinePrep.done}/${offlinePrep.total || '…'}`
            : t('preferences.offline.button')}
        </button>
        {offlinePrep && !offlinePrep.running && offlinePrep.phase === 'done' && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.done')} ({offlinePrep.total})
            {offlinePrep.imagesFound !== undefined && (
              <span className="block">
                {t('preferences.offline.imagesReport', {
                  found: offlinePrep.imagesFound,
                  stored: offlinePrep.imagesStored ?? 0,
                })}
                {offlinePrep.budgetStopped && ` · ${t('preferences.offline.imagesBudgetStopped')}`}
              </span>
            )}
            {!!offlinePrep.imagesFailed && (
              <span className="block opacity-80">
                {t('preferences.offline.imagesFailed', { count: offlinePrep.imagesFailed })}
              </span>
            )}
            {/* The raw error only matters when nothing at all got through —
                otherwise it reads as a breakdown when 80% actually succeeded. */}
            {offlinePrep.imagesError && !offlinePrep.imagesStored && (
              <span className="block break-words" style={{ color: 'var(--accent)' }}>
                {offlinePrep.imagesError}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Auto-update toggle */}
      <div className="flex items-start justify-between gap-4 select-none">
        <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.offline.auto')}
          <span className="block text-[11px] opacity-70 mt-0.5">{t('preferences.offline.autoHint')}</span>
        </span>
        <span className="mt-0.5">
          <ToggleSwitch checked={autoOffline} onChange={setAutoOffline} ariaLabel={t('preferences.offline.auto')} />
        </span>
      </div>

      {/* Offline images — budget, real usage, purge */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.offline.imagesTitle')}
        </h3>
        <p className="text-xs" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.offline.imagesHint')}
        </p>

        {/* Off switch — greys the sizes out rather than hiding them. */}
        <div className="flex items-center justify-between gap-4 select-none">
          <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.imagesDownload')}
          </span>
          <ToggleSwitch
            checked={!imagesOff}
            onChange={(on) => setOfflineImagePreset(on ? 'standard' : 'none')}
            ariaLabel={t('preferences.offline.imagesDownload')}
          />
        </div>

        <div
          className="space-y-1 transition-opacity"
          style={{ opacity: imagesOff ? 0.45 : 1, pointerEvents: imagesOff ? 'none' : undefined }}
          aria-disabled={imagesOff}
        >
          {OFFLINE_IMAGE_PRESETS.map((id) => {
            const active = offlineImagePreset === id;
            const suggested = defaultPresetMb(id, quota);
            return (
              <div
                key={id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{
                  border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  background: active ? 'var(--accent-glow)' : undefined,
                }}
              >
                <button
                  onClick={() => setOfflineImagePreset(id)}
                  disabled={imagesOff}
                  className="flex-1 text-left text-xs"
                  style={{ color: active ? 'var(--accent)' : 'var(--list-title)' }}
                  aria-pressed={active}
                >
                  {presetLabels[id]}
                  {id === 'light' && (
                    <span className="block text-[10px] opacity-60">{t('preferences.offline.imagesLightHint')}</span>
                  )}
                </button>
                <input
                  type="number"
                  min={50}
                  max={20480}
                  step={50}
                  disabled={imagesOff}
                  value={offlineImageSizes[id] ?? suggested}
                  onChange={(e) => setOfflineImageSize(id, Number(e.target.value))}
                  className="w-24 px-2 py-1 rounded-md text-xs text-right"
                  style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)', color: 'var(--list-title)' }}
                  aria-label={presetLabels[id]}
                />
                <span className="text-[11px] w-6" style={{ color: 'var(--list-summary)' }}>
                  {t('preferences.offline.imagesMb')}
                </span>
              </div>
            );
          })}
        </div>

        {estimate && (
          <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.imagesUsage', { used: formatBytes(estimate.usage) })}
            {estimate.quota > 0 && ` · ${t('preferences.offline.imagesQuota', { quota: formatBytes(estimate.quota) })}`}
          </p>
        )}

        {/* The cache is otherwise invisible — this number is what tells apart
            "nothing was stored" from "stored but not served". */}
        {imageCount !== null && (
          <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.imagesCached', { count: imageCount })}
          </p>
        )}

        {overQuota && (
          <p className="text-[11px]" style={{ color: 'var(--accent)' }}>
            {t('preferences.offline.imagesOverQuota')}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => { await clearImageCache(); setCleared(true); refreshEstimate(); }}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
          >
            {cleared ? t('preferences.offline.imagesCleared') : t('preferences.offline.imagesClear')}
          </button>
          {edited && (
            <button
              onClick={resetOfflineImageSizes}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ border: '1px solid var(--panel-border)', color: 'var(--accent)' }}
            >
              {t('preferences.offline.imagesResetSizes')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
