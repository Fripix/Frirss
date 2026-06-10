import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import {
  getServers,
  updateServer,
  deleteServer,
  setDefaultServer,
} from '../../api/backend';
import AddServerDialog from './AddServerDialog';
import type { ServerConnection } from '../../types';

type DisplayServer = Omit<ServerConnection, 'id'> & { id: string | number; synthetic?: boolean };

interface ContextMenuState {
  server: ServerConnection;
  x: number;
  y: number;
}

// ═════════════════════════════════════════════════════════════════════
// Topbar server switcher — horizontal pills (KitchenOwl-style)
// ═════════════════════════════════════════════════════════════════════
export default function ServerSwitcher() {
  const { t } = useTranslation();
  const servers = useAuthStore((s) => s.servers);
  const setServers = useAuthStore((s) => s.setServers);
  const switchServer = useAuthStore((s) => s.switchServer);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const isMobile = useBreakpoint() === 'mobile';

  async function reload(): Promise<ServerConnection[]> {
    try {
      const list = await getServers();
      setServers(list);
      return list;
    } catch {
      return servers;
    }
  }

  // Load the server list on mount
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSwitch(server: DisplayServer) {
    if (String(server.id) === String(activeServerId)) return;
    switchServer(server);
  }

  async function handleAdded(server: ServerConnection) {
    setAddOpen(false);
    await reload();
    // Switch straight to the newly added server
    switchServer(server);
  }

  async function handleSetDefault(server: ServerConnection) {
    setMenu(null);
    try {
      await setDefaultServer(server.id);
      await reload();
    } catch { /* ignore */ }
  }

  async function handleRename(server: ServerConnection, name: string) {
    setMenu(null);
    try {
      await updateServer(server.id, { name });
      await reload();
    } catch { /* ignore */ }
  }

  async function handleDelete(server: ServerConnection) {
    setMenu(null);
    try {
      await deleteServer(server.id);
      const list = await reload();
      // If the deleted server was active, switch to the default / first remaining
      if (String(server.id) === String(activeServerId)) {
        const next = list.find((s) => s.is_default) || list[0];
        if (next?.has_token) switchServer(next);
      }
    } catch { /* ignore */ }
  }

  // Build the list of pills to render. When the active FreshRSS connection
  // isn't backed by a DB server record (legacy / first connection), prepend a
  // synthetic pill so the current RSS is always represented.
  const hasActiveRecord = servers.some(
    (s) => String(s.id) === String(activeServerId)
  );
  const displayServers: DisplayServer[] = [...servers];
  if (serverUrl && !hasActiveRecord) {
    displayServers.unshift({
      id: activeServerId || '__current__',
      name: hostnameOf(serverUrl),
      url: serverUrl,
      freshrss_user: '',
      synthetic: true,
    });
  }

  return (
    <div
      className={`flex justify-center flex-shrink-0 ${isMobile ? 'px-2 py-1' : 'px-3 py-2'}`}
      style={{
        background: 'var(--topbar-bg)',
        borderBottom: '1px solid var(--sidebar-divider)',
      }}
    >
      {/* Segmented control — subtle inset track holding the servers */}
      <div
        className="server-track flex items-center gap-0.5 p-[3px] rounded-full max-w-full overflow-x-auto no-scrollbar"
      >
        {displayServers.map((server) => {
          const isActive =
            server.synthetic || String(server.id) === String(activeServerId);
          return (
            <button
              key={server.id}
              onClick={() => !server.synthetic && handleSwitch(server)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (server.synthetic) return;
                setMenu({ server: server as ServerConnection, x: e.clientX, y: e.clientY });
              }}
              className={`server-seg ${isActive ? 'server-seg-active' : ''} flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap flex-shrink-0 ${isMobile ? 'px-3 py-0.5 text-[11px]' : 'px-3.5 py-1 text-xs'}`}
              style={{ color: isActive ? 'var(--topbar-text-active)' : 'var(--topbar-text)' }}
              title={server.url}
            >
              <span>{server.name}</span>
              {server.is_default ? (
                <svg className="w-2.5 h-2.5 opacity-70 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.05 3.69c.3-.92 1.6-.92 1.9 0l1.07 3.29a1 1 0 00.95.69h3.46c.97 0 1.37 1.24.59 1.81l-2.8 2.03a1 1 0 00-.36 1.12l1.07 3.29c.3.92-.76 1.69-1.54 1.12l-2.8-2.03a1 1 0 00-1.18 0l-2.8 2.03c-.78.57-1.84-.2-1.54-1.12l1.07-3.29a1 1 0 00-.36-1.12l-2.8-2.03c-.78-.57-.38-1.81.59-1.81h3.46a1 1 0 00.95-.69l1.07-3.29z" />
                </svg>
              ) : null}
            </button>
          );
        })}

        {/* Thin divider, then add-server button */}
        <span
          className="w-px self-stretch my-1.5 flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.10)' }}
        />
        <button
          onClick={() => setAddOpen(true)}
          className="server-seg-add flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
          title={t('servers.addTitle')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {addOpen && <AddServerDialog onClose={() => setAddOpen(false)} onAdded={handleAdded} />}
      {menu && (
        <ServerContextMenu
          server={menu.server}
          x={menu.x}
          y={menu.y}
          canDelete={servers.length > 1}
          onRename={handleRename}
          onSetDefault={handleSetDefault}
          onDelete={handleDelete}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
interface ServerContextMenuProps {
  server: ServerConnection;
  x: number;
  y: number;
  canDelete: boolean;
  onRename: (server: ServerConnection, name: string) => void;
  onSetDefault: (server: ServerConnection) => void;
  onDelete: (server: ServerConnection) => void;
  onClose: () => void;
}

function ServerContextMenu({ server, x, y, canDelete, onRename, onSetDefault, onDelete, onClose }: ServerContextMenuProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'rename' | 'confirmDelete' | null>(null);
  const [renameValue, setRenameValue] = useState(server.name || '');
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

  if (mode === 'rename') {
    return (
      <div ref={ref} style={style} className="p-3">
        <form onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (renameValue.trim() && renameValue.trim() !== server.name) {
            onRename(server, renameValue.trim());
          } else {
            onClose();
          }
        }}>
          <label className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--list-summary)' }}>
            {t('servers.rename')}
          </label>
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            className="w-full text-sm px-2.5 py-1.5 rounded-lg border outline-none mb-2"
            style={{ borderColor: 'var(--accent)', color: 'var(--list-title)', background: 'var(--panel-bg)' }}
          />
          <div className="flex gap-1.5 justify-end">
            <button type="button" onClick={onClose} className="px-2.5 py-1 text-xs rounded-lg hover:bg-black/5" style={{ color: 'var(--list-summary)' }}>
              {t('sidebar.cancel')}
            </button>
            <button type="submit" className="px-2.5 py-1 text-xs font-medium rounded-lg text-white" style={{ background: 'var(--accent)' }}>
              {t('servers.rename')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === 'confirmDelete') {
    return (
      <div ref={ref} style={style} className="p-3">
        <p className="text-xs mb-3" style={{ color: 'var(--list-title)' }}>
          {t('servers.confirmDelete', { name: server.name })}
        </p>
        <div className="flex gap-1.5 justify-end">
          <button onClick={onClose} className="px-2.5 py-1 text-xs rounded-lg hover:bg-black/5" style={{ color: 'var(--list-summary)' }}>
            {t('sidebar.cancel')}
          </button>
          <button onClick={() => onDelete(server)} className="px-2.5 py-1 text-xs font-medium rounded-lg text-white" style={{ background: 'var(--danger)' }}>
            {t('servers.delete')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={style} className="py-1">
      <MenuItem label={t('servers.rename')} onClick={() => setMode('rename')} />
      {!server.is_default && (
        <MenuItem label={t('servers.setDefault')} onClick={() => onSetDefault(server)} />
      )}
      {canDelete && (
        <>
          <div className="h-px mx-2 my-1" style={{ background: 'var(--panel-border)' }} />
          <MenuItem label={t('servers.delete')} danger onClick={() => setMode('confirmDelete')} />
        </>
      )}
    </div>
  );
}

// Derive a short display name from a server URL (its hostname, sans "www.").
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface MenuItemProps {
  label: string;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
}

function MenuItem({ label, onClick, danger }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-black/5"
      style={{ color: danger ? 'var(--danger)' : 'var(--list-title)' }}
    >
      {label}
    </button>
  );
}
