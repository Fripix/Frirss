import { describe, it, expect } from 'vitest';
import { availableFor, resolveProvider, fallbackOrder } from './resolve.js';
import type { AiProvider } from './store.js';

const P = (id: number, type: 'anthropic' | 'openai', hasAdminKey: boolean, shared: boolean): AiProvider =>
  ({ id, name: `P${id}`, type, baseUrl: 'https://x', model: 'm', hasAdminKey, shared, position: id });

describe('availableFor', () => {
  it('flags own only for a personal key', () => {
    const providers = [P(1, 'anthropic', true, true), P(2, 'anthropic', true, true), P(3, 'openai', false, false)];
    const avail = availableFor(providers, { user: (id) => (id === 2 ? 'mine' : null), admin: (id) => `admin${id}` });
    expect(avail.map((a) => [a.provider.id, a.own])).toEqual([[1, false], [2, true], [3, false]]);
  });
  it('personal key beats the admin key; shared admin key serves everyone; none → unavailable', () => {
    const providers = [P(1, 'anthropic', true, true), P(2, 'anthropic', true, false), P(3, 'anthropic', false, false)];
    const avail = availableFor(providers, { user: (id) => (id === 2 ? 'mine' : null), admin: (id) => (id === 3 ? null : `admin${id}`) });
    expect(avail.map((a) => [a.provider.id, a.key, a.paidByAdmin])).toEqual([[1, 'admin1', true], [2, 'mine', false]]);
  });
  it('an openai provider without any key (Ollama) is available to all, unpaid', () => {
    const avail = availableFor([P(9, 'openai', false, false)], { user: () => null, admin: () => null });
    expect(avail).toHaveLength(1);
    expect(avail[0].key).toBeNull();
    expect(avail[0].paidByAdmin).toBe(false);
  });
  it('an unshared provider with an admin key and no personal key is absent (shared gate)', () => {
    const avail = availableFor([P(5, 'anthropic', true, false)], { user: () => null, admin: () => 'adm' });
    expect(avail).toEqual([]);
  });
  it('an admin user can use their own admin key on an unshared provider, unpaid', () => {
    const providers = [P(5, 'anthropic', true, false)];
    const keys = { user: () => null, admin: () => 'admin5' };
    expect(availableFor(providers, keys, { adminUser: true })).toEqual([{ provider: providers[0], key: 'admin5', paidByAdmin: false, own: false }]);
    expect(availableFor(providers, keys)).toEqual([]);
  });
  it('an admin user is never paidByAdmin, even on a shared provider; a plain user is', () => {
    const providers = [P(8, 'anthropic', true, true)];
    const keys = { user: () => null, admin: () => 'admin8' };
    expect(availableFor(providers, keys, { adminUser: true })[0].paidByAdmin).toBe(false);
    expect(availableFor(providers, keys)[0].paidByAdmin).toBe(true);
  });
  it('a personal key beats the admin key on a shared provider, unpaid', () => {
    const avail = availableFor([P(6, 'anthropic', true, true)], { user: () => 'mine', admin: () => 'admin' });
    expect(avail.map((a) => [a.provider.id, a.key, a.paidByAdmin])).toEqual([[6, 'mine', false]]);
  });
  it('an openai provider holding an admin key but not shared does not fall through to keyless', () => {
    const avail = availableFor([P(7, 'openai', true, false)], { user: () => null, admin: () => 'adm' });
    expect(avail).toEqual([]);
  });
});

describe('resolveProvider', () => {
  const avail = availableFor([P(1, 'openai', false, false), P(2, 'openai', false, false), P(3, 'openai', false, false)], { user: () => null, admin: () => null });
  it('force > feed > category > preferred > admin default', () => {
    expect(resolveProvider({ force: 3, feed: 2, category: 1, preferred: 1, adminDefault: 1 }, avail)!.provider.id).toBe(3);
    expect(resolveProvider({ feed: 2, category: 1, preferred: 1, adminDefault: 1 }, avail)!.provider.id).toBe(2);
    expect(resolveProvider({ category: 1, preferred: 2, adminDefault: 3 }, avail)!.provider.id).toBe(1);
    expect(resolveProvider({ preferred: 2, adminDefault: 3 }, avail)!.provider.id).toBe(2);
    expect(resolveProvider({ adminDefault: 3 }, avail)!.provider.id).toBe(3);
  });
  it('skips a stage naming a provider that is gone or unavailable, then takes the first available', () => {
    expect(resolveProvider({ feed: 42, adminDefault: 99 }, avail)!.provider.id).toBe(1);
    expect(resolveProvider({}, [])).toBeNull();
  });
  it('a skipped stage lets the next stage win, not just the first available', () => {
    expect(resolveProvider({ feed: 42, preferred: 3 }, avail)!.provider.id).toBe(3);
  });
});

describe('fallbackOrder', () => {
  it('first, then the others by position, no duplicate', () => {
    const avail = availableFor([P(1, 'openai', false, false), P(2, 'openai', false, false), P(3, 'openai', false, false)], { user: () => null, admin: () => null });
    expect(fallbackOrder(avail[1], avail).map((a) => a.provider.id)).toEqual([2, 1, 3]);
  });
  it('a duplicated entry in available appears once', () => {
    const avail = availableFor([P(1, 'openai', false, false), P(2, 'openai', false, false), P(3, 'openai', false, false)], { user: () => null, admin: () => null });
    const dup = [avail[0], avail[1], avail[2], avail[2]];
    expect(fallbackOrder(avail[1], dup).map((a) => a.provider.id)).toEqual([2, 1, 3]);
  });
});
