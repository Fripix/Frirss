// ═══════════════════════════════════════════════════════════════════════
// Preference sync — server-side, per-user (not tied to the browser)
//
// Scope ("tout sauf le géométrique"): logical preferences (theme, feed /
// category / label order, display toggles, shortcuts, title/logo, viewMode,
// topbarVisible) are synced to the backend per user. Screen-dependent prefs
// (panel widths, 2/3-column layout, sidebar visibility) stay local.
//
//   • hydratePrefs()  — pull from the server on login and apply to the stores
//   • write-through   — debounced push of the keys changed HERE, and only those
//   • refreshPrefs()  — re-read the server on return to the foreground
//
// Clés modifiées seulement : le client garde la dernière valeur connue du
// serveur (`known`, posée à la lecture et après chaque envoi réussi) et la
// liste des clés modifiées ici et pas encore reçues (`dirty`). Un envoi ne
// porte que ces clés : un appareil resté ouvert ne réécrit plus, avec ses
// vieilles valeurs, ce qu'un autre a changé entre-temps (reproduit le
// 2026-10-27 : le panneau IA replié sur Android, rouvert par Oya qui repliait
// une catégorie). Au-delà, le dernier écrivain gagne au niveau de la clé.
//
// Aucune modification perdue : `known` et `dirty` sont persistés
// (localStorage) — un rechargement, l'app iOS tuée ou un envoi hors ligne
// les retrouvent, et au démarrage une clé sale l'emporte sur le serveur et
// repart. Un envoi en échec est retenté au retour du réseau (`online`), au
// retour au premier plan (`refreshPrefs`) et par attente croissante. Une clé
// refusée par le serveur (400 qui la nomme) sort du lot, reprend la valeur
// connue du serveur, et les autres repartent.
//
// A `hydrating` guard prevents the hydration writes from re-triggering a push.
//
// A failed read is NOT an empty account: on any error the stores are left
// alone, nothing is written, and write-through stays off (without a server
// read there is no known value to tell what really changed). The read is
// retried with backoff; the first successful one decides.
// ═══════════════════════════════════════════════════════════════════════
import { getPreferences, savePreferences } from '../api/backend';
import { useUiStore, UI_SYNC_KEYS } from '../stores/uiStore';
import { useThemeStore, THEME_SYNC_KEYS } from '../stores/themeStore';
import { useAiStore } from '../stores/aiStore';
import { useFeedStore } from '../stores/feedStore';
import { effectiveOrder } from './effectiveOrder';
import { changedKeys, mergeForRelecture, pickKeys, type PrefsSnapshot } from './prefsDiff';

let hydrating = false;
let started = false;
let unsubUi: (() => void) | null = null;
let unsubTheme: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 0;
let pushRetryTimer: ReturnType<typeof setTimeout> | null = null;
let pushRetryDelay = 0;
let inFlight: Promise<void> | null = null;
// Bumped by stopSync() and by every new hydration, so a read still in flight
// from an older session can no longer apply, seed or start anything.
let generation = 0;

// Dernière valeur connue du serveur, clé par clé, et clés modifiées ici.
let known: PrefsSnapshot = {};
let dirty = new Set<string>();

const KNOWN_STORAGE = 'frirss_prefsKnown';
const DIRTY_STORAGE = 'frirss_prefsDirty';

const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 60_000;

const SYNCED_KEYS: readonly string[] = [...UI_SYNC_KEYS, ...THEME_SYNC_KEYS];

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function clearPushRetry(): void {
  if (pushRetryTimer) clearTimeout(pushRetryTimer);
  pushRetryTimer = null;
}

// ── Persistance ─────────────────────────────────────────────────────
// Un localStorage plein ou interdit ne doit rien casser : la synchronisation
// continue en mémoire, seule la reprise après rechargement est perdue.
function readStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota, mode privé : sans reprise après rechargement */
  }
}

const persistKnown = () => writeStored(KNOWN_STORAGE, known);
const persistDirty = () => writeStored(DIRTY_STORAGE, [...dirty]);

// Build the full set of synced prefs from the current store state.
function collectPrefs(): PrefsSnapshot {
  const ui = useUiStore.getState() as unknown as Record<string, unknown>;
  const th = useThemeStore.getState() as unknown as Record<string, unknown>;
  const out: PrefsSnapshot = {};
  for (const k of UI_SYNC_KEYS) out[k] = ui[k];
  for (const k of THEME_SYNC_KEYS) out[k] = th[k];
  return out;
}

// Appliquer aux deux stores sans que leurs abonnements marquent quoi que ce
// soit comme modifié ici.
function applyQuietly(prefs: PrefsSnapshot, opts?: { onlyPresent?: boolean }): void {
  hydrating = true;
  try {
    useUiStore.getState().applyServerPrefs(prefs, opts);
    useThemeStore.getState().applyServerPrefs(prefs, opts);
  } finally {
    hydrating = false;
  }
}

/** Ordre de la liste affichée : le global, ou celui du flux ouvert. */
function shownOrder(): string {
  const ui = useUiStore.getState();
  return effectiveOrder(ui.articleOrder, ui.feedSettings, useFeedStore.getState().selectedFeed?.id);
}

// ── Envoi ───────────────────────────────────────────────────────────
function armPushRetry(): void {
  clearPushRetry();
  pushRetryDelay = pushRetryDelay ? Math.min(pushRetryDelay * 2, RETRY_MAX_MS) : RETRY_FIRST_MS;
  pushRetryTimer = setTimeout(() => {
    pushRetryTimer = null;
    void pushNow();
  }, pushRetryDelay);
}

// Clé refusée : elle sort du lot et reprend la dernière valeur connue du
// serveur. Sans valeur connue (jamais reçue), elle garde la valeur locale
// mais n'est plus renvoyée tant qu'elle ne change pas.
function dropRefused(key: string): void {
  dirty.delete(key);
  persistDirty();
  if (Object.prototype.hasOwnProperty.call(known, key)) {
    applyQuietly({ [key]: known[key] }, { onlyPresent: true });
  }
}

async function doPush(): Promise<void> {
  const gen = generation;
  const local = collectPrefs();
  const keys = changedKeys(pickKeys(local, [...dirty]), known);
  // Une clé revenue à la valeur du serveur n'a plus rien à envoyer.
  for (const k of [...dirty]) if (!keys.includes(k)) dirty.delete(k);
  persistDirty();
  if (!keys.length) {
    pushRetryDelay = 0;
    return;
  }
  const batch = pickKeys(local, keys);
  try {
    await savePreferences(batch);
  } catch (err) {
    if (gen !== generation) return;
    const res = (err as { response?: { status?: number; data?: { key?: unknown } } })?.response;
    // A 401 has already logged the user out (backend interceptor): no retry.
    if (res?.status === 401) return;
    const refusedKey = res?.status === 400 ? res.data?.key : undefined;
    if (typeof refusedKey === 'string' && keys.includes(refusedKey)) {
      // Le serveur valide tout avant d'écrire : rien n'est passé, les autres
      // clés repartent tout de suite, sans la fautive.
      dropRefused(refusedKey);
      return doPush();
    }
    armPushRetry();
    return;
  }
  if (gen !== generation) return;
  pushRetryDelay = 0;
  const now = collectPrefs();
  for (const k of keys) {
    known[k] = batch[k];
    // Modifiée de nouveau pendant l'envoi : elle reste sale pour le suivant.
    if (!changedKeys({ [k]: now[k] }, { [k]: batch[k] }).length) dirty.delete(k);
  }
  persistKnown();
  persistDirty();
}

// Envoyer maintenant les clés sales (annule l'envoi différé en attente). Un
// envoi déjà en cours est attendu, puis ce qui est resté sale repart.
function pushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  clearPushRetry();
  if (inFlight) return inFlight.then(() => (started && dirty.size ? pushNow() : undefined));
  if (!dirty.size) return Promise.resolve();
  const p: Promise<void> = doPush().finally(() => {
    if (inFlight === p) inFlight = null;
  });
  inFlight = p;
  return p;
}

// Debounced write-through to the server.
function schedulePush(): void {
  if (hydrating) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pushNow();
  }, 800);
}

function onOnline(): void {
  if (started && dirty.size) void pushNow();
}

// Marquer comme modifiées ici les clés synchronisées qui ont changé de référence.
function track(keys: readonly string[], state: unknown, prev: unknown): void {
  if (hydrating) return;
  const s = state as Record<string, unknown>;
  const p = prev as Record<string, unknown>;
  let touched = false;
  for (const k of keys) {
    if (s[k] !== p[k]) {
      dirty.add(k);
      touched = true;
    }
  }
  if (touched) {
    persistDirty();
    schedulePush();
  }
}

// Subscribe to both stores; push when any synced field changes by reference.
function startSync(): void {
  if (started) return;
  started = true;
  unsubUi = useUiStore.subscribe((state, prev) => track(UI_SYNC_KEYS, state, prev));
  unsubTheme = useThemeStore.subscribe((state, prev) => track(THEME_SYNC_KEYS, state, prev));
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
}

// Pull preferences from the server and apply them; then start write-through.
// On a brand-new account (the server answered, with nothing stored), seed the
// server with whatever is currently local so future devices inherit it.
export async function hydratePrefs(): Promise<void> {
  clearRetry();
  const gen = ++generation;

  let serverPrefs: Record<string, unknown>;
  try {
    serverPrefs = await getPreferences();
  } catch (err) {
    if (gen !== generation) return;
    // A 401 has already logged the user out (backend interceptor): no retry.
    if ((err as { response?: { status?: number } })?.response?.status === 401) return;
    retryDelay = retryDelay ? Math.min(retryDelay * 2, RETRY_MAX_MS) : RETRY_FIRST_MS;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void hydratePrefs();
    }, retryDelay);
    return;
  }
  if (gen !== generation) return;
  retryDelay = 0;

  const server = serverPrefs && typeof serverPrefs === 'object' ? pickKeys(serverPrefs, SYNCED_KEYS) : {};
  const hasAny = Object.keys(server).length > 0;

  // Clés modifiées ici lors d'une session précédente et jamais reçues par le
  // serveur. Une clé revenue depuis à la valeur alors connue n'a plus rien à dire.
  const local = collectPrefs();
  const storedKnown = readStored<PrefsSnapshot>(KNOWN_STORAGE);
  const storedDirty = readStored<string[]>(DIRTY_STORAGE);
  dirty = new Set(
    (Array.isArray(storedDirty) ? storedDirty : []).filter((k) =>
      SYNCED_KEYS.includes(k) && (!storedKnown || changedKeys({ [k]: local[k] }, storedKnown).length > 0)),
  );
  const pending = pickKeys(local, [...dirty]);

  if (hasAny) applyQuietly(serverPrefs);
  // Le serveur d'abord (avec ses défauts de compte ancien), puis les clés
  // sales locales par-dessus : elles l'emportent, et repartent.
  if (dirty.size) applyQuietly(pending, { onlyPresent: true });

  known = server;
  persistKnown();
  if (!hasAny) {
    // Seed the server from local state (migration on first login).
    for (const k of SYNCED_KEYS) dirty.add(k);
  }
  persistDirty();

  startSync();
  void useAiStore.getState().load();

  if (dirty.size) void pushNow();
}

/**
 * Relecture du serveur au retour au premier plan : un autre appareil a pu
 * changer des réglages pendant que celui-ci dormait. L'envoi en attente part
 * d'abord ; ensuite seules s'appliquent les clés que le serveur porte, qui ont
 * changé depuis la dernière valeur connue, et qui ne sont pas sales ici.
 */
export async function refreshPrefs(): Promise<void> {
  if (!started) return;
  const gen = generation;
  await pushNow();
  if (gen !== generation) return;

  let serverPrefs: Record<string, unknown>;
  try {
    serverPrefs = await getPreferences();
  } catch {
    return; // rien de su : rien ne change, le prochain retour réessaiera
  }
  if (gen !== generation || !serverPrefs || typeof serverPrefs !== 'object') return;

  const server = pickKeys(serverPrefs, SYNCED_KEYS);
  // `dirty` est lu APRÈS la lecture : une modification faite pendant qu'elle
  // était en route est protégée elle aussi.
  const incoming = mergeForRelecture(server, dirty);
  const changes = pickKeys(incoming, changedKeys(incoming, known));
  const orderBefore = shownOrder();
  if (Object.keys(changes).length) applyQuietly(changes, { onlyPresent: true });
  known = server;
  persistKnown();

  // Changer l'ordre ne recharge que là où l'interface le fait (Préférences,
  // menu du flux) : un ordre arrivé d'ailleurs doit recharger la liste aussi.
  if (shownOrder() !== orderBefore) void useFeedStore.getState().loadArticles();
  if (Object.keys(changes).some((k) => k.startsWith('ai'))) void useAiStore.getState().load();
}

// Tear down the write-through subscriptions (on logout).
export function stopSync(): void {
  if (unsubUi) unsubUi();
  if (unsubTheme) unsubTheme();
  unsubUi = null;
  unsubTheme = null;
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  started = false;
  generation++;
  clearRetry();
  retryDelay = 0;
  clearPushRetry();
  pushRetryDelay = 0;
  inFlight = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // Le compte suivant sur ce navigateur n'hérite ni des clés sales ni des
  // valeurs connues du serveur de celui-ci.
  known = {};
  dirty = new Set();
  try {
    localStorage.removeItem(KNOWN_STORAGE);
    localStorage.removeItem(DIRTY_STORAGE);
  } catch {
    /* rien à effacer */
  }
}
