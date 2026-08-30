import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import {
  getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser,
  setAdminUserPassword, getAdminSettings, updateAdminSettings,
} from '../../api/backend';
import type { User } from '../../types';
import BackupBlock from './admin/BackupBlock';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AdminSettings {
  registrationEnabled?: boolean;
  loginAnimation?: string;
  oidcEnabled?: boolean;
  ssoOnly?: boolean;
  redirectUri?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcButtonLabel?: string;
  oidcClientSecret?: string;
}

/* ── Small text input used in the admin create-user form ───────────── */
interface AdminInputProps {
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}
function AdminInput({ type = 'text', placeholder, value, onChange }: AdminInputProps) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-1.5 text-sm rounded-md"
      style={{
        border: '1px solid var(--panel-border)',
        color: 'var(--list-title)',
        background: 'var(--panel-header-bg)',
      }}
    />
  );
}

/* ── Read-only value with a copy button (callback URL, break-glass URL…) ── */
function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="text-[10px] font-medium mb-0.5 block" style={{ color: 'var(--list-summary)' }}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-md font-mono"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }).catch(() => {});
          }}
          className="px-2.5 py-1.5 text-xs font-medium rounded-md flex-shrink-0 transition-colors"
          style={{ background: copied ? 'var(--accent)' : 'var(--panel-border)', color: copied ? '#fff' : 'var(--list-title)' }}
        >
          {copied ? `✓ ${t('admin.copied')}` : t('admin.copy')}
        </button>
      </div>
      {hint && (
        <p className="text-[11px] opacity-70 mt-1" style={{ color: 'var(--list-summary)' }}>{hint}</p>
      )}
    </div>
  );
}

/* ── Admin Tab ─────────────────────────────────────────────────────── */
export default function AdminTab({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const currentUser = useAuthStore((s) => s.backendUser);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<AdminSettings>({});
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [oidcForm, setOidcForm] = useState<Record<string, string>>({});

  // New-user form
  const emptyNewUser = { username: '', displayName: '', email: '', password: '', role: 'user' };
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Per-user password reset
  const [pwUserId, setPwUserId] = useState<number | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  // Per-user profile edit (display name + email)
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ displayName: '', email: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // La section reste montée une fois visitée : revenir dessus doit être
  // instantané. On revalide donc à chaque retour, mais sans toucher à
  // `loading` — repasser par l'écran vide annulerait le bénéfice, et les
  // données affichées restent valables le temps de l'aller-retour.
  useEffect(() => {
    if (!active) return;
    Promise.all([getAdminUsers(), getAdminSettings()])
      .then(([u, s]) => {
        setUsers(u);
        setSettings(s as AdminSettings);
        setOidcForm({
          oidcIssuer: (s.oidcIssuer as string) || '',
          oidcClientId: (s.oidcClientId as string) || '',
          oidcClientSecret: '',
          oidcButtonLabel: (s.oidcButtonLabel as string) || 'Authentik',
        });
      })
      .finally(() => setLoading(false));
  }, [active]);

  async function toggleActive(user: User) {
    const updated = await updateAdminUser(user.id, { active: !user.active });
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  }

  async function toggleRole(user: User) {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    const updated = await updateAdminUser(user.id, { role: newRole });
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  }

  async function handleDelete(user: User) {
    if (confirmDelete !== user.id) {
      setConfirmDelete(user.id);
      setTimeout(() => setConfirmDelete(null), 5000);
      return;
    }
    await deleteAdminUser(user.id);
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    setConfirmDelete(null);
  }

  function togglePwEditor(user: User) {
    setPwError('');
    setPwDone(false);
    setPwValue('');
    setEditUserId(null);
    setPwUserId((prev) => (prev === user.id ? null : user.id));
  }

  function toggleEditor(user: User) {
    setEditError('');
    setPwUserId(null);
    setEditUserId((prev) => {
      if (prev === user.id) return null;
      setEditDraft({ displayName: user.display_name || '', email: user.email || '' });
      return user.id;
    });
  }

  async function saveProfile(user: User) {
    setEditError('');
    if (editDraft.email && !EMAIL_RE.test(editDraft.email)) {
      return setEditError(t('admin.errorEmailInvalid'));
    }
    setEditSaving(true);
    try {
      const updated = await updateAdminUser(user.id, {
        displayName: editDraft.displayName.trim() || undefined,
        email: editDraft.email.trim() || undefined,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditUserId(null);
    } catch {
      setEditError(t('admin.errorUpdate'));
    } finally {
      setEditSaving(false);
    }
  }

  async function savePassword(user: User) {
    setPwError('');
    if (pwValue.length < 6) {
      return setPwError(t('admin.errorPasswordShort'));
    }
    setPwSaving(true);
    try {
      await setAdminUserPassword(user.id, pwValue);
      setPwUserId(null);
      setPwValue('');
      setPwDone(true);
      setTimeout(() => setPwDone(false), 2500);
    } catch {
      setPwError(t('admin.errorPasswordReset'));
    } finally {
      setPwSaving(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    if (newUser.username.trim().length < 3) {
      return setCreateError(t('admin.errorUsernameShort'));
    }
    if (!EMAIL_RE.test(newUser.email)) {
      return setCreateError(t('admin.errorEmailInvalid'));
    }
    if (newUser.password.length < 6) {
      return setCreateError(t('admin.errorPasswordShort'));
    }
    setCreating(true);
    try {
      const created = await createAdminUser({
        username: newUser.username.trim(),
        password: newUser.password,
        email: newUser.email.trim(),
        displayName: newUser.displayName.trim() || undefined,
        role: newUser.role,
      });
      setUsers((prev) => [...prev, created]);
      setNewUser(emptyNewUser);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setCreateError(
        status === 409
          ? t('admin.errorUsernameTaken')
          : t('admin.errorCreate')
      );
    } finally {
      setCreating(false);
    }
  }

  async function toggleRegistration() {
    const next = !settings.registrationEnabled;
    await updateAdminSettings({ registrationEnabled: next });
    setSettings((s) => ({ ...s, registrationEnabled: next }));
  }

  async function changeLoginAnimation(v: string) {
    if (v === settings.loginAnimation) return;
    await updateAdminSettings({ loginAnimation: v });
    setSettings((s) => ({ ...s, loginAnimation: v }));
    // Refresh the client cache so the next login uses the new choice immediately
    localStorage.setItem('frirss_loginAnimation', v);
  }

  async function toggleSso() {
    const next = !settings.oidcEnabled;
    await updateAdminSettings({ oidcEnabled: next });
    setSettings((s) => ({ ...s, oidcEnabled: next }));
  }

  async function setSsoOnly(next: boolean) {
    await updateAdminSettings({ ssoOnly: next });
    setSettings((s) => ({ ...s, ssoOnly: next }));
  }

  async function saveOidc() {
    const payload = { ...oidcForm };
    if (!payload.oidcClientSecret) delete payload.oidcClientSecret;
    await updateAdminSettings(payload);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--list-summary)' }}>{t('app.loading')}</p>;
  }

  // Cinq groupes sans rapport entre eux : on vient ici pour l'un d'eux, jamais
  // pour lire la page.
  //
  // Premier essai raté : un filet de 1 px en --panel-border sous chaque titre.
  // Or tous les encadrés du contenu portent DÉJÀ cette bordure-là : le
  // séparateur avait le même poids que ce qu'il séparait, il rejoignait le
  // bruit. Et le titre était en 11 px gris — le texte le plus petit et le plus
  // pâle de la page, plus discret que ce qu'il titrait.
  //
  // La hiérarchie se fait donc par le TYPE et la PROXIMITÉ, pas par des traits
  // supplémentaires : un titre franchement plus gros et plus sombre, collé à
  // son contenu, et beaucoup d'air entre les groupes. Un seul repère visuel
  // s'y ajoute — un tiret accentué épais, une marque que le contenu ne fait
  // jamais, donc impossible à confondre avec une bordure d'encadré.
  const sectionTitle = "flex items-center gap-2.5 text-sm font-bold mb-3";
  const rowStyle = { background: 'var(--panel-header-bg)', border: '1px solid var(--panel-border)' };

  return (
    <div className="space-y-10">
      {/* ── Users ──────────────────────────────────────────── */}
      <div>
        <h3 className={sectionTitle} style={{ color: 'var(--list-title)' }}>
          <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
          {t('admin.users')} — {t('admin.userCount', { count: users.length })}
          {pwDone && (
            <span className="ml-2 normal-case tracking-normal font-normal" style={{ color: 'var(--accent)' }}>
              {t('admin.passwordUpdated')}
            </span>
          )}
        </h3>
        <div className="space-y-1">
          {users.map((user) => {
            const isSelf = user.id === currentUser?.id;
            return (
              <div
                key={user.id}
                className="rounded-md text-sm"
                style={rowStyle}
              >
              <div className="flex items-center gap-2 px-3 py-2">
                {/* Name + provider badge */}
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate" style={{ color: 'var(--list-title)' }}>
                    {user.display_name || user.username}
                  </span>
                  {isSelf && (
                    <span className="ml-1 text-[10px]" style={{ color: 'var(--accent)' }}>{t('admin.you')}</span>
                  )}
                  <div className="text-[10px] flex gap-2 mt-0.5 flex-wrap" style={{ color: 'var(--list-summary)' }}>
                    <span>@{user.username}</span>
                    {user.email && <span>{user.email}</span>}
                    <span style={{
                      color: user.auth_provider === 'oidc' ? 'var(--accent)' : 'var(--list-time)',
                    }}>
                      {user.auth_provider === 'oidc' ? t('admin.oidc') : t('admin.local')}
                    </span>
                  </div>
                </div>

                {/* Role badge */}
                <button
                  onClick={() => !isSelf && toggleRole(user)}
                  disabled={isSelf}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    background: user.role === 'admin' ? 'var(--accent)' : 'var(--panel-border)',
                    color: user.role === 'admin' ? '#fff' : 'var(--list-title)',
                    opacity: isSelf ? 0.5 : 1,
                    cursor: isSelf ? 'default' : 'pointer',
                  }}
                  title={user.role === 'admin' ? t('admin.demoteUser') : t('admin.promoteAdmin')}
                >
                  {user.role === 'admin' ? t('admin.admin') : t('admin.user')}
                </button>

                {/* Active toggle */}
                {!isSelf && (
                  <button
                    onClick={() => toggleActive(user)}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      background: user.active ? 'rgba(45, 212, 191, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: user.active ? 'var(--accent)' : 'var(--danger)',
                    }}
                  >
                    {user.active ? t('admin.active') : t('admin.inactive')}
                  </button>
                )}

                {/* Edit profile (display name + email) */}
                <button
                  onClick={() => toggleEditor(user)}
                  className="text-[11px] px-1.5 py-0.5 rounded"
                  style={{ color: editUserId === user.id ? 'var(--accent)' : 'var(--list-summary)' }}
                  title={t('admin.editUser')}
                >
                  ✏️
                </button>

                {/* Reset password (local users only) */}
                {user.auth_provider === 'local' && (
                  <button
                    onClick={() => togglePwEditor(user)}
                    className="text-[11px] px-1.5 py-0.5 rounded"
                    style={{ color: pwUserId === user.id ? 'var(--accent)' : 'var(--list-summary)' }}
                    title={t('admin.resetPassword')}
                  >
                    🔑
                  </button>
                )}

                {/* Delete */}
                {!isSelf && (
                  <button
                    onClick={() => handleDelete(user)}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--danger)' }}
                    title={t('admin.deleteUser')}
                  >
                    {confirmDelete === user.id ? '?' : '×'}
                  </button>
                )}
              </div>

              {/* Inline profile editor */}
              {editUserId === user.id && (
                <div className="px-3 pb-2 pt-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <AdminInput
                      placeholder={t('admin.fieldDisplayName')}
                      value={editDraft.displayName}
                      onChange={(v) => setEditDraft((d) => ({ ...d, displayName: v }))}
                    />
                    <AdminInput
                      type="email"
                      placeholder={t('admin.fieldEmail')}
                      value={editDraft.email}
                      onChange={(v) => setEditDraft((d) => ({ ...d, email: v }))}
                    />
                    <button
                      onClick={() => saveProfile(user)}
                      disabled={editSaving}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-md whitespace-nowrap"
                      style={{ background: 'var(--accent)', color: '#fff', opacity: editSaving ? 0.6 : 1 }}
                    >
                      {editSaving ? t('admin.saving') : t('admin.save')}
                    </button>
                    <button
                      onClick={() => toggleEditor(user)}
                      className="text-[11px] px-2 py-1.5 rounded-md"
                      style={{ color: 'var(--list-summary)' }}
                    >
                      {t('admin.cancel')}
                    </button>
                  </div>
                  {editError && (
                    <p className="text-[11px]" style={{ color: 'var(--danger)' }}>{editError}</p>
                  )}
                </div>
              )}

              {/* Inline password editor */}
              {pwUserId === user.id && (
                <div className="px-3 pb-2 pt-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <AdminInput
                      type="password"
                      placeholder={t('admin.newPassword')}
                      value={pwValue}
                      onChange={setPwValue}
                    />
                    <button
                      onClick={() => savePassword(user)}
                      disabled={pwSaving}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-md whitespace-nowrap"
                      style={{ background: 'var(--accent)', color: '#fff', opacity: pwSaving ? 0.6 : 1 }}
                    >
                      {pwSaving ? t('admin.saving') : t('admin.setPassword')}
                    </button>
                    <button
                      onClick={() => togglePwEditor(user)}
                      className="text-[11px] px-2 py-1.5 rounded-md"
                      style={{ color: 'var(--list-summary)' }}
                    >
                      {t('admin.cancel')}
                    </button>
                  </div>
                  {pwError && (
                    <p className="text-[11px]" style={{ color: 'var(--danger)' }}>{pwError}</p>
                  )}
                </div>
              )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Create user ────────────────────────────────────── */}
      <div>
        <h3 className={sectionTitle} style={{ color: 'var(--list-title)' }}>
          <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
          {t('admin.createUser')}
        </h3>
        <form onSubmit={handleCreateUser} className="space-y-2 p-3 rounded-md" style={rowStyle}>
          <div className="grid grid-cols-2 gap-2">
            <AdminInput
              placeholder={t('admin.fieldUsername')}
              value={newUser.username}
              onChange={(v) => setNewUser((u) => ({ ...u, username: v }))}
            />
            <AdminInput
              placeholder={t('admin.fieldDisplayName')}
              value={newUser.displayName}
              onChange={(v) => setNewUser((u) => ({ ...u, displayName: v }))}
            />
            <AdminInput
              type="email"
              placeholder={t('admin.fieldEmail')}
              value={newUser.email}
              onChange={(v) => setNewUser((u) => ({ ...u, email: v }))}
            />
            <AdminInput
              type="password"
              placeholder={t('admin.fieldPassword')}
              value={newUser.password}
              onChange={(v) => setNewUser((u) => ({ ...u, password: v }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={newUser.role}
              onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}
              className="px-2 py-1.5 text-sm rounded-md"
              style={{
                border: '1px solid var(--panel-border)',
                color: 'var(--list-title)',
                background: 'var(--panel-header-bg)',
              }}
            >
              <option value="user">{t('admin.user')}</option>
              <option value="admin">{t('admin.admin')}</option>
            </select>
            <button
              type="submit"
              disabled={creating}
              className="px-3 py-1.5 text-xs font-medium rounded-md disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              {creating ? t('admin.creating') : t('admin.create')}
            </button>
            {createError && (
              <span className="text-[11px]" style={{ color: 'var(--danger)' }}>{createError}</span>
            )}
          </div>
        </form>
      </div>

      {/* ── Registration toggle ────────────────────────────── */}
      <div>
        <h3 className={sectionTitle} style={{ color: 'var(--list-title)' }}>
          <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
          {t('admin.registration')}
        </h3>
        <button
          onClick={toggleRegistration}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full"
          style={rowStyle}
        >
          <div
            className="w-8 h-4 rounded-full relative transition-colors"
            style={{ background: settings.registrationEnabled ? 'var(--accent)' : 'var(--panel-border)' }}
          >
            <div
              className="w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all"
              style={{ left: settings.registrationEnabled ? '17px' : '1px' }}
            />
          </div>
          <span style={{ color: 'var(--list-title)' }}>
            {settings.registrationEnabled ? t('admin.registrationOpen') : t('admin.registrationClosed')}
          </span>
        </button>
      </div>

      {/* ── Login animation ────────────────────────────────── */}
      <div>
        <h3 className={sectionTitle} style={{ color: 'var(--list-title)' }}>
          <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
          {t('admin.loginAnimation')}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'none', label: t('admin.animNone') },
            { id: 'portal', label: t('admin.animPortal') },
            { id: 'scanline', label: t('admin.animScanline') },
          ].map((opt) => {
            const active = (settings.loginAnimation || 'portal') === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => changeLoginAnimation(opt.id)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{
                  background: active ? 'var(--accent)' : 'var(--panel-header-bg)',
                  color: active ? '#fff' : 'var(--list-title)',
                  border: active ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── SSO Configuration ──────────────────────────────── */}
      <div>
        <h3 className={sectionTitle} style={{ color: 'var(--list-title)' }}>
          <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
          {t('admin.ssoConfig')}
        </h3>

        {/* SSO toggle */}
        <button
          onClick={toggleSso}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full mb-2"
          style={rowStyle}
        >
          <div
            className="w-8 h-4 rounded-full relative transition-colors"
            style={{ background: settings.oidcEnabled ? 'var(--accent)' : 'var(--panel-border)' }}
          >
            <div
              className="w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all"
              style={{ left: settings.oidcEnabled ? '17px' : '1px' }}
            />
          </div>
          <span style={{ color: 'var(--list-title)' }}>
            {settings.oidcEnabled ? t('admin.ssoEnabled') : t('admin.ssoDisabled')}
          </span>
        </button>

        {/* OIDC fields */}
        {settings.oidcEnabled && (
          <div className="space-y-2 mt-2">
            {settings.redirectUri && (
              <CopyField
                label={t('admin.redirectUri')}
                value={settings.redirectUri}
                hint={t('admin.redirectUriHint')}
              />
            )}
            {[
              { key: 'oidcIssuer', label: t('admin.oidcIssuer'), placeholder: 'https://auth.example.com/application/o/frirss/' },
              { key: 'oidcClientId', label: t('admin.oidcClientId') },
              { key: 'oidcClientSecret', label: t('admin.oidcClientSecret'), type: 'password', placeholder: '••••••••' },
              { key: 'oidcButtonLabel', label: t('admin.oidcButtonLabel') },
            ].map((field) => (
              <div key={field.key}>
                <label className="text-[10px] font-medium mb-0.5 block" style={{ color: 'var(--list-summary)' }}>
                  {field.label}
                </label>
                <input
                  type={field.type || 'text'}
                  value={oidcForm[field.key] || ''}
                  onChange={(e) => setOidcForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  placeholder={field.placeholder || ''}
                  className="w-full px-3 py-1.5 text-sm rounded-md"
                  style={{
                    border: '1px solid var(--panel-border)',
                    color: 'var(--list-title)',
                    background: 'var(--panel-header-bg)',
                  }}
                />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={saveOidc}
                className="px-3 py-1.5 text-xs font-medium rounded-md"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              >
                {t('admin.save')}
              </button>
              {saved && (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
                >
                  ✓ {t('admin.saved')}
                </span>
              )}
            </div>

            {/* Authentication mode: Local + SSO vs SSO only */}
            <div className="pt-3 mt-1 space-y-2" style={{ borderTop: '1px solid var(--panel-border)' }}>
              <label className="text-[10px] font-medium block" style={{ color: 'var(--list-summary)' }}>
                {t('admin.authMode')}
              </label>
              {/* Segmented control — plain buttons, so a single click always
                  registers (unlike a native radio nested in a label). */}
              <div
                className="flex gap-1 p-0.5 rounded-lg"
                role="radiogroup"
                style={{ background: 'var(--panel-header-bg)', border: '1px solid var(--panel-border)' }}
              >
                {[
                  { only: false, label: t('admin.authModeLocalSso') },
                  { only: true, label: t('admin.authModeSsoOnly') },
                ].map((opt) => {
                  const selected = !!settings.ssoOnly === opt.only;
                  return (
                    <button
                      key={String(opt.only)}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSsoOnly(opt.only)}
                      className="flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                      style={{
                        background: selected ? 'var(--accent)' : 'transparent',
                        color: selected ? '#fff' : 'var(--list-title)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] opacity-70" style={{ color: 'var(--list-summary)' }}>
                {t('admin.authModeHint')}
              </p>
              <CopyField
                label={t('admin.breakGlassUrl')}
                value={`${window.location.origin}/?local=1`}
              />
            </div>
          </div>
        )}
      </div>

      <BackupBlock />
    </div>
  );
}
