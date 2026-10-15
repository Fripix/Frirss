import { describe, it, expect } from 'vitest';
import { AiError, classifyStatus } from './errors.js';

describe('classifyStatus', () => {
  it('maps HTTP status to an error kind', () => {
    expect(classifyStatus(401)).toBe('auth');
    expect(classifyStatus(403)).toBe('auth');
    expect(classifyStatus(402)).toBe('quota');
    expect(classifyStatus(429)).toBe('quota');
    expect(classifyStatus(500)).toBe('technical');
    expect(classifyStatus(302)).toBe('technical');
  });
  it('AiError carries kind and status', () => {
    const e = new AiError('quota', 'rate limited', 429);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('quota');
    expect(e.status).toBe(429);
  });
});
