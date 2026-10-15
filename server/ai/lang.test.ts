import { describe, it, expect } from 'vitest';
import { splitLangLine } from './lang.js';

describe('splitLangLine', () => {
  it('takes the lang line off the top of the text', () => {
    expect(splitLangLine('lang: en\n\nSummary here.')).toEqual({ lang: 'en', text: 'Summary here.' });
  });
  it('accepts BCP 47 tags and lower-cases the language part', () => {
    expect(splitLangLine('Lang: zh-Hant\nTexte')).toEqual({ lang: 'zh-Hant', text: 'Texte' });
  });
  it('returns null when the model forgot the line', () => {
    expect(splitLangLine('Just text')).toEqual({ lang: null, text: 'Just text' });
  });
});
