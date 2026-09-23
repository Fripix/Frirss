import { describe, it, expect } from 'vitest';
import { scanErrorKind } from './scanError';

describe('scanErrorKind', () => {
  it('reconnaît le plafond de requêtes', () => {
    expect(scanErrorKind({ response: { status: 429 } })).toBe('rate-limit');
  });

  it('range tout le reste dans le réseau', () => {
    expect(scanErrorKind({ response: { status: 500 } })).toBe('network');
    expect(scanErrorKind(new Error('Network Error'))).toBe('network');
    expect(scanErrorKind(undefined)).toBe('network');
  });
});
