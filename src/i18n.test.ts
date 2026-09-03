// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveInitialLanguage } from './i18n';

function setBrowserLanguages(langs: string[]) {
  Object.defineProperty(navigator, 'languages', { value: langs, configurable: true });
  Object.defineProperty(navigator, 'language', { value: langs[0], configurable: true });
}

describe('resolveInitialLanguage', () => {
  beforeEach(() => localStorage.clear());

  it('uses the saved language when set and supported', () => {
    localStorage.setItem('frirss_language', 'de');
    expect(resolveInitialLanguage()).toBe('de');
  });

  it('ignores an unsupported saved value and detects instead', () => {
    localStorage.setItem('frirss_language', 'xx');
    setBrowserLanguages(['it-IT']);
    expect(resolveInitialLanguage()).toBe('it');
  });

  it('matches the browser language on its primary subtag', () => {
    setBrowserLanguages(['de-DE']);
    expect(resolveInitialLanguage()).toBe('de');
  });

  it('walks navigator.languages in order until one is supported', () => {
    setBrowserLanguages(['ja-JP', 'pt-BR', 'en']);
    expect(resolveInitialLanguage()).toBe('pt');
  });

  it('matches Simplified Chinese on its primary subtag', () => {
    setBrowserLanguages(['zh-CN']);
    expect(resolveInitialLanguage()).toBe('zh');
  });

  it('matches a bare `zh` browser language', () => {
    setBrowserLanguages(['zh', 'en']);
    expect(resolveInitialLanguage()).toBe('zh');
  });

  it('falls back to English when nothing matches', () => {
    setBrowserLanguages(['ja-JP', 'ar-EG']);
    expect(resolveInitialLanguage()).toBe('en');
  });
});
