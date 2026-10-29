// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';

/*
 * Avant la première lecture réussie, une modification persistait la liste des
 * clés modifiées de CETTE session seule, et écrasait celles d'une session
 * précédente restées en attente : changer un réglage hors ligne, tuer l'app,
 * en changer un second toujours hors ligne, puis retrouver le réseau — le
 * premier revenait à la valeur du serveur, sans rien dire.
 */
vi.mock('../api/backend', () => ({ getPreferences: vi.fn(), savePreferences: vi.fn() }));
const b64url = (v: string) => btoa(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwtFor = (userId: number) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ userId, jti: 'x' }))}.sig`;

it('une clé en attente d’une session précédente survit à une 2e modification faite avant le retour du réseau', async () => {
  vi.useFakeTimers();
  localStorage.clear();
  const token = jwtFor(1);
  localStorage.setItem('frirss_backendToken', token);
  // Session 1 : lecture OK, puis X (viewMode) modifié, envoi en échec.
  let b = await import('../api/backend');
  let s = await import('./prefsSync');
  let { useUiStore } = await import('../stores/uiStore');
  let { useAuthStore } = await import('../stores/authStore');
  useAuthStore.setState({ backendToken: token, backendUser: null });
  vi.mocked(b.getPreferences).mockResolvedValue({ viewMode: 'normal', showFavicons: true });
  vi.mocked(b.savePreferences).mockRejectedValue(new Error('Network Error'));
  await s.hydratePrefs();
  useUiStore.getState().setViewMode('compact');
  await vi.advanceTimersByTimeAsync(1000);
  // App tuée. Session 2 : hors ligne, lecture en échec, l'utilisateur change Y (showFavicons).
  vi.clearAllTimers(); vi.resetModules();
  b = await import('../api/backend'); s = await import('./prefsSync');
  ({ useUiStore } = await import('../stores/uiStore')); ({ useAuthStore } = await import('../stores/authStore'));
  useAuthStore.setState({ backendToken: token, backendUser: null });
  vi.mocked(b.getPreferences).mockReset().mockRejectedValue(new Error('Network Error'));
  await s.hydratePrefs();
  useUiStore.getState().toggleFavicons();
  // App tuée. Session 3 : réseau revenu.
  vi.clearAllTimers(); vi.resetModules();
  b = await import('../api/backend'); s = await import('./prefsSync');
  ({ useUiStore } = await import('../stores/uiStore')); ({ useAuthStore } = await import('../stores/authStore'));
  useAuthStore.setState({ backendToken: token, backendUser: null });
  const state: Record<string, unknown> = { viewMode: 'normal', showFavicons: true };
  vi.mocked(b.getPreferences).mockReset().mockImplementation(async () => structuredClone(state));
  vi.mocked(b.savePreferences).mockReset().mockImplementation(async (q) => { Object.assign(state, q); });
  await s.hydratePrefs();
  await vi.advanceTimersByTimeAsync(1000);
  expect(useUiStore.getState().showFavicons).toBe(false);
  expect(useUiStore.getState().viewMode).toBe('compact');
});
