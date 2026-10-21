import { describe, it, expect } from 'vitest';
import { aiErrorKey, aiErrorMessage, isAiDeadline } from './aiErrorKey';
import fr from '../locales/fr.json';
import en from '../locales/en.json';

describe('aiErrorKey', () => {
  it('tells the daily cap from the proxy rate limit, both 429', () => {
    expect(aiErrorKey(429, { error: 'ai_daily_cap' }, false)).toBe('ai.errors.cap');
    expect(aiErrorKey(429, { error: 'rate_limited' }, false)).toBe('ai.errors.rateLimited');
    expect(aiErrorKey(429, undefined, false)).toBe('ai.errors.rateLimited');
  });
  it('maps an oversized body to "too long", never to a technical failure', () => {
    expect(aiErrorKey(400, { error: 'invalid_body' }, false)).toBe('ai.errors.tooLong');
    expect(aiErrorKey(400, { error: 'article_too_short' }, false)).toBe('ai.errors.tooShort');
  });
  it('sends an admin to the key and a user to the admin', () => {
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth' }, true)).toBe('ai.errors.auth');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth' }, false)).toBe('ai.errors.authUser');
  });
  it('tells a user their own refused key is theirs to fix, whatever their role', () => {
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth', ownKey: true }, false)).toBe('ai.errors.auth');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth', ownKey: true }, true)).toBe('ai.errors.auth');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth' }, false)).toBe('ai.errors.authUser');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'quota', ownKey: true }, false)).toBe('ai.errors.quota');
  });
  it('a translation with no known cause says the translation failed, not the summary', () => {
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical' }, false, { op: 'translate' })).toBe('ai.errors.translateFailed');
    expect(aiErrorKey(undefined, undefined, false, { op: 'translate' })).toBe('ai.errors.translateFailed');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical' }, false)).toBe('ai.errors.technical');
    expect(aiErrorKey(400, { error: 'invalid_lang' }, false, { op: 'translate' })).toBe('ai.errors.invalidLang');
    expect(aiErrorMessage(502, { error: 'ai_failed' }, false, 'en', { op: 'translate' })).toEqual({ key: 'ai.errors.translateFailed' });
    expect(aiErrorMessage(502, { error: 'ai_failed' }, false, 'en')).toEqual({ key: 'ai.errors.technical' });
  });
  it('a refused or oversized translation says so, the summary keeps its own wording', () => {
    expect(aiErrorKey(422, { error: 'ai_refused' }, false, { op: 'translate' })).toBe('ai.errors.translateRefused');
    expect(aiErrorKey(422, { error: 'ai_refused' }, false, { op: 'summary' })).toBe('ai.errors.refused');
    expect(aiErrorKey(422, { error: 'ai_refused' }, false)).toBe('ai.errors.refused');
    expect(aiErrorKey(400, { error: 'invalid_body' }, false, { op: 'translate' })).toBe('ai.errors.translateTooLong');
    expect(aiErrorKey(400, { error: 'invalid_body' }, false, { op: 'summary' })).toBe('ai.errors.tooLong');
    expect(aiErrorKey(400, { error: 'invalid_body' }, false)).toBe('ai.errors.tooLong');
    expect(aiErrorMessage(422, { error: 'ai_refused' }, false, 'en', { op: 'translate' })).toEqual({ key: 'ai.errors.translateRefused' });
    expect(aiErrorMessage(400, { error: 'invalid_body' }, false, 'en', { op: 'translate' })).toEqual({ key: 'ai.errors.translateTooLong' });
  });
  it('the daily cap is the same message for both operations', () => {
    expect(aiErrorKey(429, { error: 'ai_daily_cap' }, false, { op: 'translate' })).toBe('ai.errors.cap');
    expect(aiErrorMessage(429, { error: 'ai_daily_cap', cap: 50, resetAt: '2026-10-22T00:00:00.000Z' }, false, 'en', { op: 'translate' }).key).toBe('ai.errors.capDetail');
  });
  it('maps the translation errors', () => {
    expect(aiErrorKey(400, { error: 'invalid_lang' }, false)).toBe('ai.errors.invalidLang');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical', detail: 'segments' }, false)).toBe('ai.errors.segments');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'auth', detail: 'segments' }, true)).toBe('ai.errors.segments');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical', detail: 'other' }, false)).toBe('ai.errors.technical');
    expect(aiErrorMessage(502, { error: 'ai_failed', detail: 'segments' }, false, 'en')).toEqual({ key: 'ai.errors.segments' });
  });
  it('a batch that ran out of time says the neutral failure of its operation', () => {
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical', detail: 'deadline' }, false, { op: 'translate' })).toBe('ai.errors.translateFailed');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical', detail: 'deadline' }, true)).toBe('ai.errors.technical');
  });
  it('recognises the deadline only from the code the server sends', () => {
    expect(isAiDeadline(502, { error: 'ai_failed', kind: 'technical', detail: 'deadline' })).toBe(true);
    expect(isAiDeadline(502, { error: 'ai_failed', kind: 'technical' })).toBe(false);
    expect(isAiDeadline(502, { error: 'ai_failed', detail: 'segments' })).toBe(false);
    // Un 504 d'un reverse proxy en amont n'a pas de corps du serveur : rien n'est deviné.
    expect(isAiDeadline(504, undefined)).toBe(false);
    expect(isAiDeadline(undefined, undefined)).toBe(false);
  });
  it('keeps the other codes and falls back to technical', () => {
    expect(aiErrorKey(422, { error: 'ai_refused' }, false)).toBe('ai.errors.refused');
    expect(aiErrorKey(409, { error: 'no_provider' }, false)).toBe('ai.errors.noProvider');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'quota' }, false)).toBe('ai.errors.quota');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical' }, false)).toBe('ai.errors.technical');
    expect(aiErrorKey(undefined, undefined, false)).toBe('ai.errors.technical');
  });
});

describe('aiErrorMessage', () => {
  const resetAt = new Date(2026, 9, 21, 0, 0).toISOString();
  it('says how many and when the day starts again when the cap carries its fields', () => {
    const m = aiErrorMessage(429, { error: 'ai_daily_cap', cap: 50, resetAt }, false, 'fr');
    expect(m.key).toBe('ai.errors.capDetail');
    expect(m.params).toEqual({ used: 50, cap: 50, time: new Intl.DateTimeFormat('fr', { timeStyle: 'short' }).format(new Date(resetAt)) });
    expect(m.params?.time).toBe('00:00');
  });
  it('formats the time in the interface language', () => {
    const m = aiErrorMessage(429, { error: 'ai_daily_cap', cap: 5, resetAt }, false, 'en');
    expect(m.params?.time).toBe(new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(new Date(resetAt)));
  });
  it('falls back to the plain cap message when a field is missing or unreadable', () => {
    expect(aiErrorMessage(429, { error: 'ai_daily_cap', cap: 5 }, false, 'fr')).toEqual({ key: 'ai.errors.cap' });
    expect(aiErrorMessage(429, { error: 'ai_daily_cap', resetAt }, false, 'fr')).toEqual({ key: 'ai.errors.cap' });
    expect(aiErrorMessage(429, { error: 'ai_daily_cap', cap: 5, resetAt: 'demain' }, false, 'fr')).toEqual({ key: 'ai.errors.cap' });
    expect(aiErrorMessage(429, { error: 'ai_daily_cap', cap: '5', resetAt } as never, false, 'fr')).toEqual({ key: 'ai.errors.cap' });
  });
  it('passes every other error through aiErrorKey, without params', () => {
    expect(aiErrorMessage(502, { error: 'ai_failed', kind: 'auth' }, false, 'fr')).toEqual({ key: 'ai.errors.authUser' });
    expect(aiErrorMessage(429, undefined, false, 'fr')).toEqual({ key: 'ai.errors.rateLimited' });
  });
});

describe('daily cap wording', () => {
  it('counts AI calls, not summaries: the counter is shared with translations', () => {
    expect(fr.ai.errors.cap).toBe("Limite quotidienne d'appels IA atteinte.");
    expect(fr.ai.errors.capDetail).toBe("Limite quotidienne d'appels IA atteinte ({{used}} sur {{cap}}). Nouvelle journée à {{time}}.");
    expect(fr.ai.user.usage).toBe("Appels IA payés par l'instance aujourd'hui : {{used}} sur {{cap}}");
    for (const s of [en.ai.errors.cap, en.ai.errors.capDetail, en.ai.user.usage]) expect(s.toLowerCase()).not.toContain('summar');
  });
});
