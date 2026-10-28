import axios from 'axios';
import { useAuthStore } from '../stores/authStore';
import { TIMEOUT_DEFAULT_MS } from '../lib/requestTimeouts';

/**
 * FreshRSS ClientLogin — échange identifiants → token greader.
 * Passe par le proxy backend (même origine). Renvoie le token brut.
 */
export async function login(
  serverUrl: string,
  username: string,
  password: string
): Promise<string> {
  const target = `${serverUrl.replace(/\/+$/, '')}/api/greader.php/accounts/ClientLogin`;
  const params = new URLSearchParams();
  params.append('Email', username);
  params.append('Passwd', password);

  const { backendToken } = useAuthStore.getState();
  const response = await axios.post('/api/proxy', params, {
    // Hors des instances bornées : même délai qu'elles (`requestTimeouts.ts`).
    timeout: TIMEOUT_DEFAULT_MS,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Proxy-Target': target,
      ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
    },
  });

  const match = String(response.data).match(/Auth=(.+)/);
  if (!match) {
    throw new Error('Token not found in response');
  }
  return match[1].trim();
}
