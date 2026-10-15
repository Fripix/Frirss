import { describe, it, expect } from 'vitest';
import { aiErrorKey } from './aiErrorKey';

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
  it('keeps the other codes and falls back to technical', () => {
    expect(aiErrorKey(422, { error: 'ai_refused' }, false)).toBe('ai.errors.refused');
    expect(aiErrorKey(409, { error: 'no_provider' }, false)).toBe('ai.errors.noProvider');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'quota' }, false)).toBe('ai.errors.quota');
    expect(aiErrorKey(502, { error: 'ai_failed', kind: 'technical' }, false)).toBe('ai.errors.technical');
    expect(aiErrorKey(undefined, undefined, false)).toBe('ai.errors.technical');
  });
});
