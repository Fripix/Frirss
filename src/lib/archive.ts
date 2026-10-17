import { resolveArchiveSnapshot } from '../api/backend';
import { useUiStore } from '../stores/uiStore';
import { hostnameMatchesDomain, isArchiveRedirectWrapper } from './archiveDomains';
import { openExternal } from './openExternal';

const ARCHIVE_HOSTS = [
  'archive.is', 'archive.today', 'archive.ph', 'archive.md', 'archive.li',
  'archive.fo', 'archive.vn', 'archive.st', 'archive.gs',
] as const;

export function isArchiveEligibleUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const domains = useUiStore.getState().archiveDomains;
  return hostnameMatchesDomain(url.hostname, domains)
    || (domains.length > 0 && isArchiveRedirectWrapper(url.hostname));
}

function isDirectArchiveSnapshot(rawUrl: string | undefined): rawUrl is string {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && ARCHIVE_HOSTS.includes(url.hostname as typeof ARCHIVE_HOSTS[number])
      && /^\/\d{14}\//.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Opens an archive-aware source without adding a chooser to FriRSS's UI.
 * The blank tab is created synchronously to satisfy popup blockers, then its
 * opener is severed before any asynchronous request. It is navigated to a
 * validated snapshot or, on any failure, to the original URL.
 */
export function openArchiveAware(rawUrl: string | null | undefined): void {
  const original = rawUrl?.trim();
  if (!original) return;
  if (!isArchiveEligibleUrl(original)) {
    openExternal(original);
    return;
  }

  try {
    const source = new URL(original);
    if (source.protocol !== 'http:' && source.protocol !== 'https:') {
      openExternal(original);
      return;
    }
  } catch {
    openExternal(original);
    return;
  }

  const tab = window.open('about:blank', '_blank');
  if (!tab) {
    // Popup blocked: preserve existing behavior rather than losing the click.
    openExternal(original);
    return;
  }
  // Detach synchronously before any untrusted archive page can be loaded.
  try { tab.opener = null; } catch { /* destination still opens safely */ }

  const navigate = (destination: string) => {
    try {
      tab.location.replace(destination);
    } catch {
      openExternal(destination);
    }
  };

  void resolveArchiveSnapshot(original)
    .then((result) => {
      navigate(result.status === 'ok' && isDirectArchiveSnapshot(result.url) ? result.url : original);
    })
    .catch(() => navigate(original));
}
