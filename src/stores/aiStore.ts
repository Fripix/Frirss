import { create } from 'zustand';
import { getAiConfig, type AiConfig } from '../api/backend';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';

/**
 * Ce que le client sait de l'IA : rien tant que `load()` n'a pas répondu, et
 * « éteint » si la PREMIÈRE requête échoue — un réseau en panne ne doit pas
 * faire apparaître de pastille. Un rechargement raté garde la configuration
 * déjà connue : il ne doit pas faire disparaître l'IA d'une session qui
 * l'avait. Rechargé après chaque connexion (prefsSync) et à chaque affichage
 * de la section IA des préférences (consommation du jour à jour).
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
    // Une réponse n'appartient qu'à la session qui l'a demandée : partie avant
    // une déconnexion, elle reviendrait APRÈS `reset()` et rendrait au compte
    // suivant les fournisseurs du précédent. Le jeton ne change qu'à la
    // connexion et à la déconnexion : un jeton différent est un autre compte.
    const token = useAuthStore.getState().backendToken;
    const stillOurs = () => !!token && useAuthStore.getState().backendToken === token;
    try {
      const config = await getAiConfig();
      if (stillOurs()) set({ config });
    } catch {
      if (stillOurs()) set((s) => ({ config: s.config ?? OFF }));
    }
  },
  reset: () => set({ config: null }),
}));

// Oublier la configuration à la déconnexion : le compte suivant sur ce navigateur
// ne doit voir ni les fournisseurs ni la disponibilité du précédent. C'est ici
// que l'on s'abonne, pas dans authStore, qui ne peut pas importer ce module
// (api/backend importe authStore, et ce store importe api/backend). Le 401 qui
// déconnecte passe par `logoutBackend()` : un seul chemin à surveiller.
//
// Le résumé automatique s'éteint aussi, les deux avertissements de coût
// (traduction, résumé) se reposent, et les automatismes et fournisseurs par
// catégorie et par flux s'effacent (`forgetAiAccountChoices`) : ils vivent
// dans le localStorage, et le compte suivant en hériterait sans avoir vu
// l'avertissement de coût (un compte neuf pousse même ses réglages locaux au
// serveur, et `applyServerPrefs` ne trie que les comptes déjà enregistrés). Le compte qui part ne le
// perd pas : son jeton est déjà nul, et `stopSync()` (App, à la déconnexion)
// annule l'envoi différé avant qu'il ne parte — sa valeur serveur reste, et
// revient à sa prochaine connexion. uiStore n'importe rien qui mène ici.
useAuthStore.subscribe((state, prev) => {
  if (prev.backendToken && !state.backendToken) {
    useAiStore.getState().reset();
    useUiStore.getState().setAiAutoSummary(false);
    useUiStore.getState().setAiAutoTranslateConfirmed(false);
    useUiStore.getState().setAiAutoSummaryConfirmed(false);
    useUiStore.getState().forgetAiAccountChoices();
  }
});

export const aiEnabled = (s: AiState): boolean => s.config?.enabled === true;

/**
 * Vrai si résumer est réellement possible pour cet utilisateur : la fonction est
 * allumée ET au moins un fournisseur lui est utilisable. C'est la condition qui
 * affiche la pastille de résumé ; le raccourci, la palette et leurs aide-mémoire
 * s'y alignent — une commande pour une fonction éteinte n'est que du bruit.
 */
export const aiUsable = (s: AiState): boolean => aiEnabled(s) && (s.config?.providers.some((p) => p.available) ?? false);
