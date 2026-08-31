// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isAppleKeyboard, commandKeyLabel } from './platformKeys';

afterEach(() => vi.unstubAllGlobals());

function stubPlatform(value: string) {
  vi.stubGlobal('navigator', { ...navigator, userAgent: value, platform: value });
}

describe('isAppleKeyboard', () => {
  it('is true on a Mac', () => {
    stubPlatform('MacIntel');
    expect(isAppleKeyboard()).toBe(true);
  });

  it('is true on an iPad or iPhone, where a keyboard may be attached', () => {
    stubPlatform('iPhone');
    expect(isAppleKeyboard()).toBe(true);
  });

  it('is false on Windows and on Linux', () => {
    stubPlatform('Win32');
    expect(isAppleKeyboard()).toBe(false);
    stubPlatform('Linux x86_64');
    expect(isAppleKeyboard()).toBe(false);
  });

  it('falls back to Ctrl when the platform cannot be read', () => {
    // Guessing ⌘ on a machine that has no ⌘ key is the worse mistake: the hint
    // would name a key the reader cannot find.
    vi.stubGlobal('navigator', undefined);
    expect(isAppleKeyboard()).toBe(false);
  });
});

describe('commandKeyLabel', () => {
  it('is ⌘ on Apple and Ctrl elsewhere', () => {
    stubPlatform('MacIntel');
    expect(commandKeyLabel()).toBe('⌘');
    stubPlatform('Win32');
    expect(commandKeyLabel()).toBe('Ctrl');
  });
});
