import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/backend', () => ({ getAiConfig: vi.fn() }));
import { getAiConfig } from '../api/backend';
import { useAiStore } from './aiStore';

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
    expect(useAiStore.getState().config?.enabled ?? false).toBe(false);
  });
});
