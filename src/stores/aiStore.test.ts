import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/backend', () => ({ getAiConfig: vi.fn() }));
import { getAiConfig } from '../api/backend';
import { useAiStore, aiUsable } from './aiStore';

beforeEach(() => useAiStore.getState().reset());

describe('aiStore', () => {
  it('starts with no config and loads it', async () => {
    expect(useAiStore.getState().config).toBeNull();
    vi.mocked(getAiConfig).mockResolvedValue({ enabled: true, providers: [], userKeysAllowed: false, dailyCap: 50, usageToday: 0, defaultProvider: null });
    await useAiStore.getState().load();
    expect(useAiStore.getState().config?.enabled).toBe(true);
  });
  it('a failed load leaves the feature off, never throws', async () => {
    vi.mocked(getAiConfig).mockRejectedValue(new Error('network'));
    await expect(useAiStore.getState().load()).resolves.toBeUndefined();
    expect(useAiStore.getState().config).not.toBeNull();
    expect(useAiStore.getState().config?.enabled).toBe(false);
  });
  it('aiUsable needs the feature on AND at least one available provider', () => {
    const p = (available: boolean) => ({ id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available });
    const cfg = { userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null };
    expect(aiUsable(useAiStore.getState())).toBe(false); // not loaded yet
    useAiStore.setState({ config: { ...cfg, enabled: true, providers: [p(true)] } });
    expect(aiUsable(useAiStore.getState())).toBe(true);
    useAiStore.setState({ config: { ...cfg, enabled: true, providers: [p(false)] } });
    expect(aiUsable(useAiStore.getState())).toBe(false);
    useAiStore.setState({ config: { ...cfg, enabled: false, providers: [p(true)] } });
    expect(aiUsable(useAiStore.getState())).toBe(false);
  });
});
