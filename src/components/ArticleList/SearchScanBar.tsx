import { useTranslation } from 'react-i18next';
import type { SearchScan } from '../../stores/feedStore';

interface Props {
  scan: SearchScan;
  results: number;
  /** La vue ne montre que les non lus : les résultats, eux, comprennent les lus. */
  includesRead?: boolean;
  onStop: () => void;
  onRetry: () => void;
}

/**
 * L'état d'un balayage de recherche.
 *
 * Elle existe parce qu'« aucun résultat » et « pas encore fini » se ressemblent
 * à l'écran : sans ce compteur, un balayage en cours passerait pour une réponse.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 *
 * Elle RESTE une fois le balayage fini (1.5.0) : elle disparaissait, et la
 * liste de résultats redevenait alors indiscernable de la liste ordinaire —
 * d'autant que le balayage ramène les articles lus, même sous « Non lus »
 * (choix de la spec). Le compte qui subsiste est la seule chose qui dise, une
 * fois le balayage terminé, que ce qu'on lit est le produit d'une recherche.
 */
export default function SearchScanBar({ scan, results, includesRead, onStop, onRetry }: Props) {
  const { t } = useTranslation();
  if (!scan.running && !scan.done && !scan.stopped && !scan.error) return null;

  if (scan.done && !scan.error) {
    const done = includesRead
      ? `${t('articleList.scanResults', { count: results })} · ${t('articleList.scanIncludesRead')}`
      : t('articleList.scanResults', { count: results });
    return (
      <div className="search-scan-bar" role="status" aria-live="polite">
        <span>{done}</span>
      </div>
    );
  }

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
