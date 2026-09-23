import { useTranslation } from 'react-i18next';
import type { SearchScan } from '../../stores/feedStore';

interface Props {
  scan: SearchScan;
  results: number;
  onStop: () => void;
  onRetry: () => void;
}

/**
 * L'état d'un balayage de recherche.
 *
 * Elle existe parce qu'« aucun résultat » et « pas encore fini » se ressemblent
 * à l'écran : sans ce compteur, un balayage en cours passerait pour une réponse.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 */
export default function SearchScanBar({ scan, results, onStop, onRetry }: Props) {
  const { t } = useTranslation();
  if (scan.done && !scan.error) return null;
  if (!scan.running && !scan.stopped && !scan.error) return null;

  const status = scan.error === 'offline'
    ? t('articleList.scanOffline')
    : scan.error === 'rate-limit'
      ? t('articleList.scanRateLimited')
      : scan.error === 'network'
        ? t('articleList.scanNetworkError')
        : scan.stopped
          ? t('articleList.scanStopped')
          : `${t('articleList.scanScanned', { count: scan.scanned })} · ${t('articleList.scanResults', { count: results })}`;

  return (
    <div className="search-scan-bar" role="status" aria-live="polite">
      <span>{status}</span>
      {scan.running ? (
        <button type="button" onClick={onStop}>{t('articleList.scanStop')}</button>
      ) : (scan.error || scan.stopped) ? (
        <button type="button" onClick={onRetry}>{t('articleList.scanRetry')}</button>
      ) : null}
    </div>
  );
}
