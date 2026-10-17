import { describe, expect, it } from 'vitest';
import { DEFAULT_ARCHIVE_DOMAINS, hostnameMatchesDomain, normalizeArchiveDomains, parseArchiveDomains } from './archiveDomains';

describe('Archive.is domain allowlist', () => {
  it('ships the eight agreed publisher domains', () => {
    expect(DEFAULT_ARCHIVE_DOMAINS).toEqual([
      'wsj.com', 'ft.com', 'bloomberg.com', 'economist.com',
      'nytimes.com', 'spiegel.de', 'washingtonpost.com', 'sueddeutsche.de',
    ]);
  });

  it('matches subdomains only on a dot boundary', () => {
    expect(hostnameMatchesDomain('www.ft.com', ['ft.com'])).toBe(true);
    expect(hostnameMatchesDomain('ft.com', ['ft.com'])).toBe(true);
    expect(hostnameMatchesDomain('notft.com', ['ft.com'])).toBe(false);
    expect(hostnameMatchesDomain('ft.com.attacker.example', ['ft.com'])).toBe(false);
  });

  it('normalises case and duplicates and accepts an empty list', () => {
    expect(parseArchiveDomains(' WSJ.com\nwsj.com\nft.com\n')).toEqual({
      domains: ['wsj.com', 'ft.com'],
      invalid: [],
    });
    expect(normalizeArchiveDomains([])).toEqual([]);
  });

  it('rejects URLs, paths, wildcards and IP literals', () => {
    expect(parseArchiveDomains('https://ft.com\nnotft.com/path\n*.example.com\n192.168.1.1')).toEqual({
      domains: [],
      invalid: ['https://ft.com', 'notft.com/path', '*.example.com', '192.168.1.1'],
    });
  });
});
