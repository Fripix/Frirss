import { describe, it, expect } from 'vitest';
import { stripSummaryMarkdown } from './summaryMarkdown';

describe('stripSummaryMarkdown', () => {
  it('retire les marques de titre, garde le titre comme une ligne ordinaire', () => {
    expect(stripSummaryMarkdown('# Résumé\n\nTexte.')).toBe('Résumé\n\nTexte.');
    expect(stripSummaryMarkdown('### Points clés\nSuite.')).toBe('Points clés\nSuite.');
    expect(stripSummaryMarkdown('  ## Indenté')).toBe('Indenté');
  });
  it('retire le gras, et seulement les paires', () => {
    expect(stripSummaryMarkdown('Le **budget** passe à **3 %**.')).toBe('Le budget passe à 3 %.');
    expect(stripSummaryMarkdown('Un ** isolé reste.')).toBe('Un ** isolé reste.');
    expect(stripSummaryMarkdown('5 * 3 = 15, et a*b aussi.')).toBe('5 * 3 = 15, et a*b aussi.');
  });
  it('rend les puces - et * par « • »', () => {
    expect(stripSummaryMarkdown('Points :\n- un\n* deux\n  - trois')).toBe('Points :\n• un\n• deux\n• trois');
  });
  it('ne touche ni à un tiret de phrase, ni à un dièse dans le texte, ni à une règle horizontale', () => {
    expect(stripSummaryMarkdown('Il a dit - enfin - oui.')).toBe('Il a dit - enfin - oui.');
    expect(stripSummaryMarkdown('Le canal #général et le C#.')).toBe('Le canal #général et le C#.');
    expect(stripSummaryMarkdown('-12 °C ce matin.')).toBe('-12 °C ce matin.');
    expect(stripSummaryMarkdown('#hashtag en tête')).toBe('#hashtag en tête');
  });
  it('laisse intact un texte brut, persan compris', () => {
    const fa = 'این مقاله دربارهٔ آینده است.\n\n- نکتهٔ اول';
    expect(stripSummaryMarkdown(fa)).toBe('این مقاله دربارهٔ آینده است.\n\n• نکتهٔ اول');
    expect(stripSummaryMarkdown('Premier.\n\nSecond.')).toBe('Premier.\n\nSecond.');
  });
  it('reste linéaire sur une entrée hostile', () => {
    const t0 = performance.now();
    stripSummaryMarkdown('**a*'.repeat(50_000) + '\n' + '#'.repeat(100_000) + '\n' + ' '.repeat(100_000) + '-');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
