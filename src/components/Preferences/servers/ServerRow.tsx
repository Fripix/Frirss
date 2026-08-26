import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { hostnameOf, type DisplayServer } from '../../../lib/serverList';
import RefreshTokenField from './RefreshTokenField';

interface ServerRowProps {
  server: DisplayServer;
  isActive: boolean;
  expanded: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onSwitch: () => void;
  onRename: (name: string) => Promise<void>;
  onSetDefault: () => Promise<void>;
  onDelete: () => Promise<void>;
  onSaved: () => void;
}

/**
 * Un serveur dans l'écran de gestion. Repliée, la ligne montre l'essentiel et
 * bascule d'un tap ; dépliée, elle porte toutes les actions de gestion.
 * La connexion héritée (`synthetic`) se voit mais ne se gère pas : aucun
 * enregistrement en base ne lui correspond.
 */
export default function ServerRow({
  server, isActive, expanded, canDelete,
  onToggle, onSwitch, onRename, onSetDefault, onDelete, onSaved,
}: ServerRowProps) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(server.name || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Les gestionnaires rejettent : sans ce relais, un renommage refusé ne
  // produisait rien à l'écran — six `catch { /* ignore */ }` dans l'ancien
  // menu contextuel. Tolérable dans un menu fugace, pas dans un écran de
  // gestion.
  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch {
      setError(t('servers.errorGeneric'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const isDefault = !!server.is_default;

  return (
    <li className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--panel-border)' }}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onSwitch}
          disabled={isActive || !!server.synthetic}
          title={isActive ? undefined : t('servers.switchTo')}
          className="flex-1 text-left px-3 py-2 min-h-[44px] flex flex-col justify-center gap-0.5 transition-colors hover:bg-black/5 disabled:hover:bg-transparent min-w-0"
        >
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--list-title)' }}>
              {server.name}
            </span>
            {isActive && <Badge label={t('servers.active')} accent />}
            {isDefault && <Badge label={t('servers.defaultBadge')} />}
          </span>
          <span className="text-[11px] truncate" style={{ color: 'var(--list-summary)' }}>
            {hostnameOf(server.url)}
            {server.freshrss_user ? ` · ${server.freshrss_user}` : ''}
          </span>
        </button>

        {!server.synthetic && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? t('servers.collapse') : t('servers.expand')}
            className="w-11 flex-shrink-0 flex items-center justify-center transition-colors hover:bg-black/5"
            style={{ borderLeft: '1px solid var(--panel-border)', color: 'var(--list-summary)' }}
          >
            <svg
              className="w-4 h-4 transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {expanded && !server.synthetic && (
        <div className="px-3 py-3 space-y-3" style={{ borderTop: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}>
          {renaming ? (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                const name = renameValue.trim();
                if (!name || name === server.name) { setRenaming(false); return; }
                run(() => onRename(name)).then((ok) => { if (ok) setRenaming(false); });
              }}
              className="flex items-center gap-2 flex-wrap"
            >
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false); }}
                className="flex-1 min-w-[8rem] text-sm px-2.5 py-1.5 rounded-lg outline-none"
                style={{ border: '1px solid var(--accent)', color: 'var(--list-title)', background: 'var(--panel-bg)' }}
              />
              <button
                type="submit"
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-white min-h-[44px] disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {t('servers.rename')}
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <RowAction label={t('servers.rename')} onClick={() => { setRenameValue(server.name || ''); setRenaming(true); }} disabled={busy} />
              {!isDefault && (
                <RowAction label={t('servers.setDefault')} onClick={() => run(onSetDefault)} disabled={busy} />
              )}
            </div>
          )}

          <RefreshTokenField
            serverId={Number(server.id)}
            isActive={isActive}
            configured={!!server.has_refresh_token}
            onSaved={onSaved}
          />

          <div className="pt-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
            {confirmDelete ? (
              <div className="flex items-center gap-2 flex-wrap pt-2">
                <span className="text-xs" style={{ color: 'var(--list-title)' }}>
                  {t('servers.confirmDelete', { name: server.name })}
                </span>
                <RowAction label={t('sidebar.cancel')} onClick={() => setConfirmDelete(false)} disabled={busy} />
                <button
                  type="button"
                  onClick={() => run(onDelete)}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-white min-h-[44px] disabled:opacity-50"
                  style={{ background: 'var(--danger)' }}
                >
                  {t('servers.delete')}
                </button>
              </div>
            ) : (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy || !canDelete}
                  title={canDelete ? undefined : t('servers.cannotDeleteLast')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] transition-colors hover:bg-black/5 disabled:opacity-50"
                  style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}
                >
                  {t('servers.delete')}
                </button>
                {!canDelete && (
                  <span className="block text-[11px] mt-1.5 opacity-70" style={{ color: 'var(--list-summary)' }}>
                    {t('servers.cannotDeleteLast')}
                  </span>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-[11px]" role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0"
      style={
        accent
          ? { background: 'var(--accent)', color: '#fff' }
          : { border: '1px solid var(--panel-border)', color: 'var(--list-summary)' }
      }
    >
      {label}
    </span>
  );
}

function RowAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] transition-colors hover:bg-black/5 disabled:opacity-50"
      style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
    >
      {label}
    </button>
  );
}
