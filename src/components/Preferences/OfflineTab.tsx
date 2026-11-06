import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { useFeedStore } from '../../stores/feedStore';
import ToggleSwitch from '../ToggleSwitch';
import {
  imageBudget, defaultPresetMb, OFFLINE_IMAGE_PRESETS,
  type OfflineImageSized,
} from '../../lib/offlineImages';
import { getStorageEstimate, formatBytes, clearImageCache } from '../../lib/storageEstimate';
import { cachedImageStats, type CachedImageStats } from '../../lib/imageCache';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import ConfirmDialog from '../ConfirmDialog';
import { prepRemainingMs, etaMessage } from '../../lib/offlinePrepEta';

export default function OfflineTab({ active = true }: { active?: boolean }) {
  const { t, i18n } = useTranslation();
  const size = (bytes: number) => formatBytes(
    bytes,
    { mb: t('preferences.offline.imagesMb'), gb: t('preferences.offline.imagesGb') },
    i18n.language,
  );
  const offlinePrep = useFeedStore((s) => s.offlinePrep);
  const prepareOffline = useFeedStore((s) => s.prepareOffline);
  const cancelOfflinePrep = useFeedStore((s) => s.cancelOfflinePrep);
  // « Arrêt… » le temps que l'article en cours aille au bout ; une nouvelle
  // préparation repart avec « Annuler ».
  const [cancelling, setCancelling] = useState(false);
  const running = !!offlinePrep?.running;
  useEffect(() => { if (!running) setCancelling(false); }, [running]);
  // Le focus suit le bouton qui le remplace (M-07). « Préparer » est désactivé
  // dès le clic, « Annuler » démonté à la fin : sous le focus, l'un comme
  // l'autre le renvoyaient sur la page. « Préparer » le passe à « Annuler » ;
  // « Annuler » le garde pendant l'arrêt (`aria-disabled`, pas `disabled`,
  // qui le lâcherait), puis le rend à « Préparer » qui revient — de même
  // quand la préparation finit seule, focus sur « Annuler ».
  const prepareRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const focusCancel = useRef(false);
  const focusPrepare = useRef(false);
  // Appelé à `null` au démontage, nœud encore dans la page : c'est là qu'on
  // sait s'il avait le focus, qui retombe ensuite sur `<body>`.
  const cancelRefCb = useCallback((node: HTMLButtonElement | null) => {
    const prev = cancelRef.current;
    if (!node && prev && document.activeElement === prev) focusPrepare.current = true;
    cancelRef.current = node;
  }, []);
  useEffect(() => {
    if (running) {
      if (focusCancel.current) cancelRef.current?.focus();
      focusCancel.current = false;
      return;
    }
    if (!focusPrepare.current) return;
    focusPrepare.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) prepareRef.current?.focus();
  }, [running]);
  // Durée restante, au rythme observé : recalculée à chaque avancement
  // publié (tous les cinq articles), muette tant que la mesure est jeune.
  const remaining = running && offlinePrep?.phase === 'articles'
    ? prepRemainingMs({ startedAt: offlinePrep.startedAt, now: Date.now(), done: offlinePrep.done, total: offlinePrep.total })
    : null;
  const etaFor = (ms: number): string => {
    const { key, options } = etaMessage(ms);
    return t(key, options);
  };
  // Pendant l'attente d'une reprise (serveur d'extraction occupé, jusqu'à
  // 15 s), la durée au rythme observé ne veut rien dire : l'onglet dit qu'il
  // attend le serveur, à sa place.
  const waitingServer = running && !cancelling ? offlinePrep?.waitingServer ?? 0 : 0;
  const eta = remaining === null || cancelling || waitingServer ? null : etaFor(remaining);
  // Faits sans l'article complet qu'ils devaient ouvrir : ils ne se disent
  // pas prêts (« Hors ligne prêt (6) » sans un seul extrait obtenu).
  // La base du bilan est ce qui DEVAIT s'ouvrir en article complet
  // (`wantFull`) : `done - missingFull` comptait comme complets les articles
  // d'un flux réglé « Non », qui s'ouvrent sur le contenu du flux, voulu
  // (relecture du troisième round).
  const missingFull = offlinePrep?.missingFull ?? 0;
  const wantFull = offlinePrep?.wantFull ?? 0;
  // Arrêtée (« Annuler », réseau coupé, autre serveur) : tous les articles
  // n'ont pas été vus, elle ne se dit pas « prête » — « 3 articles complets
  // sur 6 » se lisait aussi sur une simple interruption.
  const stopped = !!offlinePrep && (!!offlinePrep.cancelled || offlinePrep.done < offlinePrep.total);
  const autoOffline = useUiStore((s) => s.autoOffline);
  const setAutoOffline = useUiStore((s) => s.setAutoOffline);
  const offlineImagePreset = useUiStore((s) => s.offlineImagePreset);
  const setOfflineImagePreset = useUiStore((s) => s.setOfflineImagePreset);
  const offlineImageSizes = useUiStore((s) => s.offlineImageSizes);
  const setOfflineImageSize = useUiStore((s) => s.setOfflineImageSize);
  const resetOfflineImageSizes = useUiStore((s) => s.resetOfflineImageSizes);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [images, setImages] = useState<CachedImageStats | null>(null);
  const [cleared, setCleared] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // Hors ligne, `prepareOffline` ne fait rien : le bouton le dit au lieu de
  // cliquer dans le vide.
  const online = useOnlineStatus();

  const refreshEstimate = useCallback(() => {
    getStorageEstimate().then(setEstimate);
    cachedImageStats().then(setImages);
  }, []);
  // Relu à chaque retour sur la section, pas seulement au montage : la
  // section reste montée une fois visitée, et l'espace disque comme le
  // nombre d'images changent entre deux visites.
  // « Images supprimées » ne vaut que pour le vidage qu'on vient de faire : il
  // restait affiché pour toujours, même une fois le cache rempli de nouveau.
  useEffect(() => { if (active) { setCleared(false); refreshEstimate(); } }, [active, refreshEstimate]);

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
        <div className="flex flex-wrap items-center gap-2">
          <button
            ref={prepareRef}
            onClick={() => {
              focusCancel.current = document.activeElement === prepareRef.current;
              prepareOffline({ userInitiated: true });
            }}
            disabled={offlinePrep?.running || !online}
            className="px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            {offlinePrep?.running
              ? `${t('preferences.offline.preparing')} ${offlinePrep.done}/${offlinePrep.total || '…'}`
              : t('preferences.offline.button')}
          </button>
          {/* Une préparation complète dure des dizaines de minutes : on peut
              l'arrêter. L'article en cours va au bout, d'où « Arrêt… ». */}
          {offlinePrep?.running && (
            <button
              ref={cancelRefCb}
              onClick={() => {
                if (cancelling) return;
                setCancelling(true);
                cancelOfflinePrep();
              }}
              aria-disabled={cancelling || undefined}
              className="px-4 py-2 text-xs rounded-lg transition-colors aria-disabled:opacity-50"
              style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
            >
              {cancelling ? t('preferences.offline.cancelling') : t('preferences.offline.cancel')}
            </button>
          )}
        </div>
        {eta && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--list-summary)' }}>
            {eta}
          </p>
        )}
        {waitingServer > 0 && (
          <p role="status" className="text-[11px] mt-2" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.waitingServer', { count: waitingServer })}
          </p>
        )}
        {!online && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.needsNetwork')}
          </p>
        )}
        {offlinePrep && !offlinePrep.running && offlinePrep.phase === 'done' && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--list-summary)' }}>
            {stopped
              ? t('preferences.offline.cancelledReport', { done: offlinePrep.done, total: offlinePrep.total, count: offlinePrep.total })
              : missingFull > 0
                ? t('preferences.offline.doneMissing', { count: offlinePrep.done, full: wantFull - missingFull, wanted: wantFull })
                : `${t('preferences.offline.done')} (${offlinePrep.total})`}
            {missingFull > 0 && (
              <span className="block">
                {t('preferences.offline.missingFull', { count: missingFull })}
              </span>
            )}
            {offlinePrep.imagesFound !== undefined && (
              <span className="block">
                {t('preferences.offline.imagesReport', {
                  found: offlinePrep.imagesFound,
                  stored: offlinePrep.imagesStored ?? 0,
                })}
                {offlinePrep.budgetStopped && ` · ${t('preferences.offline.imagesBudgetStopped')}`}
                {offlinePrep.deviceFull && ` · ${t('preferences.offline.imagesDeviceFull')}`}
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

        {/* The cache is otherwise invisible — this number is what tells apart
            "nothing was stored" from "stored but not served". Prepared images
            came through the proxy, so their real size is known. */}
        {images && (
          <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.imagesCached', { count: images.total })}
            {images.prepared > 0 && (
              <span className="block">
                {t('preferences.offline.imagesPrepared', { count: images.prepared, size: size(images.preparedBytes) })}
              </span>
            )}
          </p>
        )}

        {/* The browser's figure covers the whole origin and pads every opaque
            image (kept on display, from another site) by several megabytes:
            12 Go reported for a few hundred real Mo. Named for what it is. */}
        {estimate && (
          <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.imagesUsage', { used: size(estimate.usage) })}
            {estimate.quota > 0 && ` · ${t('preferences.offline.imagesQuota', { quota: size(estimate.quota) })}`}
            {(images?.browsing ?? 0) > 0 && (
              <span className="block opacity-80">{t('preferences.offline.imagesUsageNote')}</span>
            )}
          </p>
        )}

        {overQuota && (
          <p className="text-[11px]" style={{ color: 'var(--accent)' }}>
            {t('preferences.offline.imagesOverQuota')}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setConfirmClear(true)}
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
        <ConfirmDialog
          open={confirmClear}
          title={t('preferences.offline.imagesClearTitle')}
          message={t('preferences.offline.imagesClearMessage')}
          confirmLabel={t('preferences.offline.imagesClear')}
          danger
          onConfirm={async () => {
            await clearImageCache();
            setCleared(true);
            setConfirmClear(false);
            refreshEstimate();
          }}
          onCancel={() => setConfirmClear(false)}
        />
      </div>
    </div>
  );
}
