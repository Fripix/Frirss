import { describe, it, expect } from 'vitest';
import { aiErrorKey, aiErrorMessage } from './aiErrorKey';

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
