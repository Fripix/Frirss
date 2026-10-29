// Remplace en test le module virtuel de vite-plugin-pwa, qui n'existe qu'au
// build (`vitest.config.js` l'y fait pointer). Les tests le simulent par
// `vi.mock('virtual:pwa-register/react', …)`.
export function useRegisterSW(): {
  needRefresh: [boolean, (v: boolean) => void];
  offlineReady: [boolean, (v: boolean) => void];
  updateServiceWorker: (reload?: boolean) => Promise<void>;
} {
  return { needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} };
}
