import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { getServers } from '../../api/backend';
import { displayServers, type DisplayServer } from '../../lib/serverList';
import { switchToServer } from '../../lib/switchServer';

// ═════════════════════════════════════════════════════════════════════
// Sélecteur de serveur — pastilles horizontales dans la barre du haut.
//
// Il ne gère plus rien : ajouter, renommer, définir par défaut et supprimer
// vivent dans Préférences → Flux, atteignables même barre masquée et sans
// dépendre du clic droit — que Safari iOS n'émet pas. Le `+` et le menu
// contextuel n'y mènent que par raccourci.
// ═════════════════════════════════════════════════════════════════════
export default function ServerSwitcher() {
  const { t } = useTranslation();
  const servers = useAuthStore((s) => s.servers);
  const setServers = useAuthStore((s) => s.setServers);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const openPreferences = useThemeStore((s) => s.openPreferences);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isMobile = useBreakpoint() === 'mobile';

  useEffect(() => {
    getServers()
      .then(setServers)
      .catch(() => { /* garder la liste connue */ });
  }, [setServers]);

  // Le geste vit dans `lib/switchServer` : la palette de commandes l'utilise
  // aussi, et il ne doit pas exister en deux exemplaires.
  const handleSwitch = switchToServer;

  const rows = displayServers(servers, activeServerId, serverUrl);

  return (
    <div
      className={`flex justify-center flex-shrink-0 ${isMobile ? 'px-2 py-1' : 'px-3 py-2'}`}
      style={{
        background: 'var(--topbar-bg)',
        borderBottom: '1px solid var(--sidebar-divider)',
      }}
    >
      {/* Contrôle segmenté — piste discrète portant les serveurs */}
      <div className="server-track flex items-center gap-0.5 p-[3px] rounded-full max-w-full overflow-x-auto no-scrollbar">
        {rows.map((server) => {
          const isActive = !!server.synthetic || String(server.id) === String(activeServerId);
          return (
            <button
              key={server.id}
              onClick={() => handleSwitch(server)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY });
              }}
              className={`server-seg ${isActive ? 'server-seg-active' : ''} flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap flex-shrink-0 ${isMobile ? 'px-3 py-0.5 text-[11px]' : 'px-3.5 py-1 text-xs'}`}
              style={{ color: isActive ? 'var(--topbar-text-active)' : 'var(--topbar-text)' }}
              title={server.url}
            >
              <span>{server.name}</span>
              {server.is_default ? (
                <svg className="w-2.5 h-2.5 opacity-70 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M9.05 3.69c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.36 1.12l1.07 3.29c.3.92-.76 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.84-.2-1.54-1.12l1.07-3.29a1 1 0 00-.36-1.12l-2.8-2.03c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69l1.07-3.29z" />
                </svg>
              ) : null}
            </button>
          );
        })}

        {/* Fin séparateur, puis le raccourci d'ajout */}
        <span className="w-px self-stretch my-1.5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.10)' }} />
        <button
          onClick={() => openPreferences('feeds', 'addServer')}
          className="server-seg-add flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
          title={t('servers.addTitle')}
          aria-label={t('servers.addTitle')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {menu && (
        <ManageMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} onManage={() => { setMenu(null); openPreferences('feeds'); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Menu contextuel réduit à un raccourci. Il n'exécute plus d'action : rien
// d'essentiel ne doit dépendre du clic droit, absent au tactile.
function ManageMenu({ x, y, onClose, onManage }: { x: number; y: number; onClose: () => void; onManage: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const style: CSSProperties = {
    position: 'fixed', left: x, top: y, zIndex: 300,
    background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
    borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    minWidth: '200px', overflow: 'hidden',
  };

  return (
    <div ref={ref} style={style} className="py-1">
      <button
        onClick={onManage}
        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-black/5"
        style={{ color: 'var(--list-title)' }}
      >
        {t('servers.manage')}
      </button>
    </div>
  );
}
