import { create } from 'zustand';
import { getAiConfig, type AiConfig } from '../api/backend';
import { useAuthStore } from './authStore';

/**
 * Ce que le client sait de l'IA : rien tant que `load()` n'a pas répondu, et
 * « éteint » si la requête échoue — un réseau en panne ne doit pas faire
 * apparaître de pastille. Rechargé après chaque connexion (prefsSync).
 */
interface AiState {
  config: AiConfig | null;
  load: () => Promise<void>;
  reset: () => void;
}
const OFF: AiConfig = { enabled: false, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null };

export const useAiStore = create<AiState>()((set) => ({
  config: null,
  load: async () => {
    try { set({ config: await getAiConfig() }); } catch { set({ config: OFF }); }
  },
  reset: () => set({ config: null }),
}));

// Oublier la configuration à la déconnexion : le compte suivant sur ce navigateur
// ne doit voir ni les fournisseurs ni la disponibilité du précédent. C'est ici
// que l'on s'abonne, pas dans authStore, qui ne peut pas importer ce module
// (api/backend importe authStore, et ce store importe api/backend). Le 401 qui
// déconnecte passe par `logoutBackend()` : un seul chemin à surveiller.
useAuthStore.subscribe((state, prev) => {
  if (prev.backendToken && !state.backendToken) useAiStore.getState().reset();
});

export const aiEnabled = (s: AiState): boolean => s.config?.enabled === true;

/**
 * Vrai si résumer est réellement possible pour cet utilisateur : la fonction est
 * allumée ET au moins un fournisseur lui est utilisable. C'est la condition qui
 * affiche la pastille de résumé ; le raccourci, la palette et leurs aide-mémoire
 * s'y alignent — une commande pour une fonction éteinte n'est que du bruit.
 */
export const aiUsable = (s: AiState): boolean => aiEnabled(s) && (s.config?.providers.some((p) => p.available) ?? false);
