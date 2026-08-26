import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../stores/authStore';
import { useFeedStore } from '../../../stores/feedStore';
import { useThemeStore } from '../../../stores/themeStore';
import {
  getServers,
  updateServer,
  deleteServer,
  setDefaultServer,
} from '../../../api/backend';
import {
  displayServers,
  nextServerAfterDelete,
  canDeleteServer,
  shouldShowServerList,
} from '../../../lib/serverList';
import type { ServerConnection } from '../../../types';
import ServerRow from './ServerRow';
import AddServerDialog from './AddServerDialog';

/**
 * Écran de gestion des serveurs FreshRSS — le seul endroit complet. La barre
 * du haut n'y mène que par raccourcis ; masquée, elle ne doit rien emporter
 * avec elle, bascule comprise.
 */
export default function ServerList() {
  const { t } = useTranslation();
  const servers = useAuthStore((s) => s.servers);
  const setServers = useAuthStore((s) => s.setServers);
  const switchServer = useAuthStore((s) => s.switchServer);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const intent = useThemeStore((s) => s.preferencesIntent);
  const clearPreferencesIntent = useThemeStore((s) => s.clearPreferencesIntent);

  const [addOpen, setAddOpen] = useState(false);
  // Le serveur actif est déplié d'office : RefreshBanner pointe ici en
  // promettant le champ jeton, il doit s'y trouver sans repli à ouvrir.
  const [expandedId, setExpandedId] = useState<string | null>(
    activeServerId != null ? String(activeServerId) : null,
  );
  // Avant la première réponse de getServers(), `servers` vaut `[]` et
  // displayServers() rendrait une ligne synthétique en lecture seule —
  // indiscernable d'une vraie connexion héritée. `loaded` bloque ce rendu
  // trompeur ; `loadFailed` distingue une liste vide légitime d'un échec
  // réseau silencieux.
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const wasAddOpen = useRef(false);

  // AddServerDialog se démonte à sa fermeture (Échap ou Annuler) : le focus
  // qu'il portait retombe alors sur `document.body`, hors de l'arbre qui
  // écoute Échap dans Preferences.tsx. On le rend au bouton déclencheur,
  // remonté à ce point du rendu — d'où l'effet plutôt qu'un `.focus()` dans
  // le gestionnaire de fermeture.
  useEffect(() => {
    if (wasAddOpen.current && !addOpen) {
      addButtonRef.current?.focus();
    }
    wasAddOpen.current = addOpen;
  }, [addOpen]);

  async function reload(): Promise<ServerConnection[]> {
    try {
      const list = await getServers();
      setServers(list);
      const active = list.find(
        (s) => String(s.id) === String(useAuthStore.getState().activeServerId),
      );
      useFeedStore.getState().setHasRefreshToken(!!active?.has_refresh_token);
      setLoadFailed(false);
      return list;
    } catch {
      setLoadFailed(true);
      return servers;
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Intention consommée puis vidée : sans cela, rouvrir Préférences
  // relancerait le dialogue d'ajout.
  useEffect(() => {
    if (intent === 'addServer') {
      setAddOpen(true);
      clearPreferencesIntent();
    }
  }, [intent, clearPreferencesIntent]);

  async function handleAdded(server: ServerConnection) {
    setAddOpen(false);
    const list = await reload();
    switchServer(server);
    // Le drapeau se lit dans la liste rechargée, pas dans le paramètre, qui
    // peut être en retard sur l'état réel.
    const added = list.find((s) => String(s.id) === String(server.id));
    useFeedStore.getState().setHasRefreshToken(!!added?.has_refresh_token);
    setExpandedId(String(server.id));
  }

  function handleSwitch(server: ServerConnection) {
    if (String(server.id) === String(activeServerId)) return;
    switchServer(server);
    useFeedStore.getState().setHasRefreshToken(!!server.has_refresh_token);
    setExpandedId(String(server.id));
  }

  // Les trois gestionnaires ci-dessous laissent remonter leur échec : c'est
  // ServerRow qui l'affiche, sur la ligne concernée.
  async function handleRename(server: ServerConnection, name: string) {
    await updateServer(Number(server.id), { name });
    await reload();
  }

  async function handleSetDefault(server: ServerConnection) {
    await setDefaultServer(Number(server.id));
    await reload();
  }

  async function handleDelete(server: ServerConnection) {
    await deleteServer(Number(server.id));
    const list = await reload();
    const next = nextServerAfterDelete(list, server.id, activeServerId);
    if (next) switchServer(next);
  }

  const rows = displayServers(servers, activeServerId, serverUrl);
  const deletable = canDeleteServer(servers);
  // Ce que l'on a déjà s'affiche tout de suite ; la revalidation court derrière.
  const showList = shouldShowServerList(servers.length, loaded);

  return (
    <div className="space-y-4">
      {/* L'échec se dit même quand des données connues restent affichées :
          montrer du périmé en silence serait mentir. */}
      {loadFailed && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
          style={{ border: '1px solid var(--panel-border)' }}
        >
          <span className="text-xs" role="alert" style={{ color: 'var(--danger)' }}>
            {t('servers.errorGeneric')}
          </span>
          <button
            type="button"
            onClick={() => reload()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] flex-shrink-0 transition-colors hover:bg-black/5"
            style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
          >
            {t('readingPane.retry')}
          </button>
        </div>
      )}

      {!showList ? (
        // Squelette réservé au démarrage à froid : sans lui, la ligne
        // synthétique de displayServers() se ferait passer pour un compte
        // hérité. Inutile de l'afficher si le chargement a déjà échoué —
        // l'erreur ci-dessus le dit mieux qu'une attente sans fin.
        !loadFailed && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg px-3 py-2 min-h-[44px]" style={{ border: '1px solid var(--panel-border)' }}>
              <div className="skeleton h-3 w-1/3 mb-1.5" />
              <div className="skeleton h-2.5 w-1/2" />
            </div>
          ))}
        </div>
        )
      ) : (
        <ul className="space-y-2" aria-label={t('servers.label')}>
          {rows.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              isActive={String(server.id) === String(activeServerId)}
              expanded={expandedId === String(server.id)}
              canDelete={deletable}
              onToggle={() =>
                setExpandedId((cur) => (cur === String(server.id) ? null : String(server.id)))
              }
              onSwitch={() => handleSwitch(server as ServerConnection)}
              onRename={(name) => handleRename(server as ServerConnection, name)}
              onSetDefault={() => handleSetDefault(server as ServerConnection)}
              onDelete={() => handleDelete(server as ServerConnection)}
              onSaved={() => { reload(); }}
            />
          ))}
        </ul>
      )}

      <button
        ref={addButtonRef}
        type="button"
        onClick={() => setAddOpen(true)}
        className="w-full px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] transition-colors inline-flex items-center justify-center gap-1.5"
        style={{ border: '1px dashed var(--panel-border)', color: 'var(--list-title)' }}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        {t('servers.addTitle')}
      </button>

      {addOpen && <AddServerDialog onClose={() => setAddOpen(false)} onAdded={handleAdded} />}
    </div>
  );
}
