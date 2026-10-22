import { describe, it, expect } from 'vitest';
import { providerChoices } from './aiProviderChoices';
import type { AiProviderView } from '../api/backend';

const provider = (id: number, name: string, available = true): AiProviderView =>
  ({ id, name, type: 'openai', hasAdminKey: true, shared: true, hasUserKey: false, available });
const t = (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${String(o.name)}` : k);

describe('providerChoices', () => {
  it('starts with the default choice, then one choice per provider', () => {
    expect(providerChoices([provider(1, 'Ollama'), provider(2, 'Claude')], null, 'Par défaut', t)).toEqual([
      { value: null, label: 'Par défaut', disabled: false },
      { value: 1, label: 'Ollama', disabled: false },
      { value: 2, label: 'Claude', disabled: false },
    ]);
  });
  it('keeps a provider without a usable key listed, but disabled and marked', () => {
    expect(providerChoices([provider(2, 'Claude', false)], null, 'd', t)[1]).toEqual({ value: 2, label: 'ai.user.keyRequired:Claude', disabled: true });
  });
  it('keeps a deleted provider visible while it is the value, never otherwise', () => {
    expect(providerChoices([provider(1, 'Ollama')], 42, 'd', t).at(-1)).toEqual({ value: 42, label: 'ai.user.removedProvider', disabled: false });
    expect(providerChoices([provider(1, 'Ollama')], 1, 'd', t)).toHaveLength(2);
  });
});
