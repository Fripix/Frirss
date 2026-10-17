/**
 * Default publishers that commonly use subscription or registration walls.
 * Values are bare hostnames; subdomains match on a dot boundary.
 */
export const DEFAULT_ARCHIVE_DOMAINS = [
  'wsj.com', 'ft.com', 'bloomberg.com', 'economist.com',
  'nytimes.com', 'spiegel.de', 'washingtonpost.com', 'sueddeutsche.de',
] as const;

export const ARCHIVE_REDIRECT_WRAPPERS = ['apple.news'] as const;

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function normaliseDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (!domain || domain.length > 253 || domain.includes('://') || /[/:?#@\s*]/.test(domain)) return null;
  if (!domain.includes('.') || IPV4_LITERAL.test(domain) || domain.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.some((label) => !label || label.length > 63 || !DOMAIN_LABEL.test(label))) return null;
  return domain;
}

export interface ParsedArchiveDomains {
  domains: string[];
  invalid: string[];
}

/** Parse the settings textarea or a stored domain array without accepting URLs. */
export function parseArchiveDomains(input: string | unknown): ParsedArchiveDomains {
  const tokens = typeof input === 'string'
    ? input.split(/[\r\n,;]+/)
    : Array.isArray(input) ? input : [];
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (typeof token !== 'string') {
      invalid.push(String(token));
      continue;
    }
    if (!token.trim()) continue;
    const domain = normaliseDomain(token);
    if (!domain) {
      invalid.push(token.trim());
      continue;
    }
    if (!domains.includes(domain)) domains.push(domain);
    if (domains.length > 100) {
      invalid.push(token.trim());
      break;
    }
  }
  return { domains, invalid };
}

/** Defensive normalisation for saved preferences; an invalid value uses defaults. */
export function normalizeArchiveDomains(input: unknown): string[] {
  if (Array.isArray(input) || typeof input === 'string') return parseArchiveDomains(input).domains;
  return [...DEFAULT_ARCHIVE_DOMAINS];
}

export function hostnameMatchesDomain(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => host === domain || host.endsWith('.' + domain));
}

export function isArchiveRedirectWrapper(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return ARCHIVE_REDIRECT_WRAPPERS.some((domain) => host === domain || host.endsWith('.' + domain));
}
