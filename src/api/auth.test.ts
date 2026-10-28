import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ backendToken: null }) },
}));

import { TIMEOUT_DEFAULT_MS } from '../lib/requestTimeouts';
import { login } from './auth';

afterEach(() => { vi.restoreAllMocks(); });

describe('login — ClientLogin via le proxy', () => {
  // Appel axios direct, hors des deux instances bornées : il doit porter le
  // même délai qu'elles, au-dessus de l'échéance totale du proxy.
  it('borne la requête au délai par défaut', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: 'SID=x\nAuth=tok\n' });
    await expect(login('https://rss.example.com/', 'u', 'p')).resolves.toBe('tok');
    expect(post.mock.calls[0][2]?.timeout).toBe(TIMEOUT_DEFAULT_MS);
  });
});
