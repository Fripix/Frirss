import { useEffect, useState } from 'react';
import { getServers } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import RefreshTokenField from './servers/RefreshTokenField';

/**
 * Section Flux — pour l'instant le seul jeton du serveur actif. La tâche
 * suivante y monte la liste complète des serveurs ; ce composant n'est plus
 * qu'un point de montage en attendant.
 */
export default function FeedsTab() {
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const [configured, setConfigured] = useState(false);
  // Incrémenté après un enregistrement pour relire l'état réel du serveur.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getServers()
      .then((servers) => {
        if (cancelled) return;
        const active = servers.find((s) => String(s.id) === String(activeServerId));
        setConfigured(!!active?.has_refresh_token);
      })
      .catch(() => { /* laisser non configuré */ });
    return () => { cancelled = true; };
  }, [activeServerId, reloadKey]);

  if (activeServerId == null) return null;

  return (
    <RefreshTokenField
      serverId={Number(activeServerId)}
      isActive
      configured={configured}
      onSaved={() => setReloadKey((k) => k + 1)}
    />
  );
}
