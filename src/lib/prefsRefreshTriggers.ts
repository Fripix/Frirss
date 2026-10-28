/**
 * Quand relire les réglages synchronisés depuis le serveur.
 *
 * Le retour au premier plan ne suffit pas : un onglet desktop laissé affiché
 * ne passe jamais en arrière-plan quand on prend le téléphone, et un réglage
 * changé sur l'iPhone n'y arrivait donc jamais. D'où trois déclencheurs : le
 * retour au premier plan, la reprise du focus de la fenêtre, et une relecture
 * périodique tant que l'onglet reste affiché (une requête légère par minute).
 */
export const PREFS_POLL_MS = 60_000;

// Le focus et la visibilité arrivent ensemble quand on revient sur l'onglet :
// une seule relecture suffit.
const MIN_GAP_MS = 2_000;

export function installPrefsRefreshTriggers(refresh: () => void): () => void {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, PREFS_POLL_MS);
  };

  const run = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - last < MIN_GAP_MS) return;
    last = now;
    refresh();
    // La prochaine relecture périodique part de celle-ci.
    schedule();
  };

  function tick() {
    timer = null;
    run();
    if (!timer) schedule();
  }

  document.addEventListener('visibilitychange', run);
  window.addEventListener('focus', run);
  schedule();

  return () => {
    document.removeEventListener('visibilitychange', run);
    window.removeEventListener('focus', run);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
