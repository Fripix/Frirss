import { describe, it, expect } from 'vitest';
import { AI_LANGUAGES, isAiLanguage, targetLanguage, sameLanguage, languageName } from './aiLanguages';
import { AI_LANGUAGES as SERVER_LANGUAGES } from '../../server/ai/languages.js';

describe('aiLanguages', () => {
  it('has exactly the 28 fixed codes, Chinese twice, no Russian or Hebrew', () => {
    expect(AI_LANGUAGES).toHaveLength(28);
    expect(AI_LANGUAGES).not.toContain('ru');
    expect(AI_LANGUAGES).not.toContain('he');
    expect(AI_LANGUAGES.filter((c) => c.startsWith('zh'))).toEqual(['zh-Hans', 'zh-Hant']);
  });

  it('is the same list, in the same order, as the server', () => {
    expect([...AI_LANGUAGES]).toEqual([...SERVER_LANGUAGES]);
  });

  it('recognises only listed codes', () => {
    expect(isAiLanguage('fr')).toBe(true);
    expect(isAiLanguage('zh-Hant')).toBe(true);
    expect(isAiLanguage('ru')).toBe(false);
    expect(isAiLanguage(42)).toBe(false);
    expect(isAiLanguage(null)).toBe(false);
  });

  it('maps the UI language to a target', () => {
    expect(targetLanguage('fr')).toBe('fr');
    expect(targetLanguage('zh')).toBe('zh-Hans');
    expect(targetLanguage('zh-CN')).toBe('zh-Hans');
    expect(targetLanguage('zh-TW')).toBe('zh-Hant');
    expect(targetLanguage('zh-HK')).toBe('zh-Hant');
    expect(targetLanguage('pt-BR')).toBe('pt');
    expect(targetLanguage('de-CH')).toBe('de');
    expect(targetLanguage('xx')).toBe('en');
  });

  it('compares languages by primary subtag, scripts apart', () => {
    expect(sameLanguage('en-US', 'en')).toBe(true);
    expect(sameLanguage('zh-CN', 'zh-Hans')).toBe(true);
    expect(sameLanguage('zh-Hant', 'zh-Hans')).toBe(false);
    expect(sameLanguage('fr', 'en')).toBe(false);
    expect(sameLanguage(null, 'fr')).toBe(false);
    expect(sameLanguage(undefined, 'fr')).toBe(false);
  });

  it('names a language in the UI language, falling back to the code', () => {
    expect(languageName('de', 'fr')).toBe('allemand');
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('de', 'not a locale!')).toBe('de');
  });
});
