// @vitest-environment jsdom
//
// M-12 (second round 1.9.0) : deux écritures du même attribut d'un même
// article partent dans l'ordre des gestes. « Lu » puis « non lu » aussitôt sur
// un réseau lent : FreshRSS recevait parfois le second avant le premier et
// gardait « lu » quand l'écran disait « non lu ».
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async () => undefined),
  listPut: vi.fn(async () => {}),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async () => undefined),
  subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}),
  queueGet: vi.fn(async () => []),
  queuePut: vi.fn(async () => {}),
}));
vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}),
  markAsStarred: vi.fn(async () => {}), removeStarred: vi.fn(async () => {}),
  markAllAsRead: vi.fn(async () => {}), getUnreadItemIds: vi.fn(async () => ({ ids: [], complete: true })),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(async () => {}),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(async () => []),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../lib/extractCache', () => ({
  peekExtract: vi.fn(() => undefined), getExtract: vi.fn(async () => undefined), putExtract: vi.fn(async () => {}),
  pinExtract: vi.fn(async () => {}), unpinExtractsExcept: vi.fn(async () => {}),
}));
vi.mock('../utils/extractContent', () => ({ extractFullContent: vi.fn(async () => { throw new Error('no'); }) }));

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const { useFeedStore, READ_LATER_LABEL } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(2), item(1)], continuation: null } as never);
  useFeedStore.getState().selectView({ id: 'feed/1', title: 'F1', categories: [] } as never, 'all');
  await settled();
  return { api, useFeedStore, READ_LATER_LABEL };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 6; i++) await flush(); };
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const item = (n: number) => ({
  id: hex(n), title: `T${n}`, published: Math.floor(Date.now() / 1000) - n,
  origin: { streamId: 'feed/1', title: 'F' }, categories: [], alternate: [{ href: `https://example.com/${n}` }],
});

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('écritures d’un même article mises en série (M-12)', () => {
  it('« lu » puis « non lu » aussitôt : « non lu » part après la réponse à « lu »', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); await slow.promise; order.push('lu ✓'); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleRead(a);
    const p2 = useFeedStore.getState().toggleRead({ ...a, read: true });
    await settled();
    expect(order).toEqual(['lu']);
    slow.resolve();
    await p1; await p2; await settled();
    expect(order).toEqual(['lu', 'lu ✓', 'non lu']);
    expect(useFeedStore.getState().articles[0].read).toBe(false);
  });

  it('l’ouverture marque lu, « non lu » aussitôt attend sa réponse', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); await slow.promise; });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);
    const p = useFeedStore.getState().toggleRead(useFeedStore.getState().selectedArticle!);
    await settled();
    expect(order).toEqual(['lu']);
    slow.resolve();
    await p; await settled();
    expect(order).toEqual(['lu', 'non lu']);
  });

  it('un refus de la première n’empêche pas la seconde de partir', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); throw Object.assign(new Error('refus'), { response: { status: 400 } }); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleRead(a);
    const p2 = useFeedStore.getState().toggleRead({ ...a, read: true });
    await p1; await p2; await settled();
    expect(order).toEqual(['lu', 'non lu']);
  });

  it('favori : le retrait attend la réponse à l’ajout', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsStarred).mockImplementation(async () => { order.push('favori'); await slow.promise; });
    vi.mocked(api.removeStarred).mockImplementation(async () => { order.push('retrait'); });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleStar(a);
    const p2 = useFeedStore.getState().toggleStar({ ...a, starred: true });
    await settled();
    expect(order).toEqual(['favori']);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual(['favori', 'retrait']);
  });

  it('« Plus tard » : le retrait attend la réponse à l’ajout', async () => {
    const { api, useFeedStore, READ_LATER_LABEL } = await load();
    const order: boolean[] = [];
    const slow = deferred();
    vi.mocked(api.setArticleLabel).mockImplementation(async (_id: string | string[], _label: string, on?: boolean) => {
      order.push(!!on);
      if (on) await slow.promise;
    });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleReadLater(a);
    const p2 = useFeedStore.getState().toggleReadLater({ ...a, labels: [READ_LATER_LABEL] });
    await settled();
    expect(order).toEqual([true]);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual([true, false]);
  });

  it('deux articles différents ne s’attendent pas', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    vi.mocked(api.markAsRead).mockImplementation(async (id: string | string[]) => { order.push(String(id)); await new Promise(() => {}); });
    const [a, b] = useFeedStore.getState().articles;
    void useFeedStore.getState().toggleRead(a);
    void useFeedStore.getState().toggleRead(b);
    await settled();
    expect(order).toEqual([a.id, b.id]);
  });
});

// Relecture du second round 1.9.0 (R2) : trois chemins d'écriture restaient
// hors de la mise en série — le rejeu de la file hors ligne, les étiquettes
// ordinaires et les écritures groupées.
const netErr = () => Object.assign(new Error('Network Error'), { response: undefined });

describe('écritures hors série rattrapées (relecture R2)', () => {
  it('rejeu : un « non lu » direct pendant l’envoi rejoué de « lu » attend son règlement', async () => {
    const { api, useFeedStore } = await load();
    const a = useFeedStore.getState().articles[0];
    // « Lu » hors ligne : l'action entre en file.
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(a);
    expect(useFeedStore.getState().pendingActions).toBe(1);
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); await slow.promise; order.push('lu ✓'); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const replay = useFeedStore.getState().replayQueue();
    await settled();
    expect(order).toEqual(['lu']);
    const p = useFeedStore.getState().toggleRead({ ...a, read: true });
    await settled();
    expect(order, 'le geste direct attend l’envoi rejoué').toEqual(['lu']);
    slow.resolve();
    await replay; await p; await settled();
    expect(order).toEqual(['lu', 'lu ✓', 'non lu']);
  });

  it('rejeu qui attend un geste direct plus récent : il ne renvoie pas l’ancienne intention', async () => {
    const { api, useFeedStore } = await load();
    const a = useFeedStore.getState().articles[0];
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(a); // « lu » en file
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); await slow.promise; order.push('non lu ✓'); });
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu rejoué'); });
    const p = useFeedStore.getState().toggleRead({ ...a, read: true }); // « non lu » direct, lent
    await settled();
    const replay = useFeedStore.getState().replayQueue();
    await settled();
    slow.resolve();
    await p; await replay; await settled();
    expect(order).toEqual(['non lu', 'non lu ✓']);
    expect(useFeedStore.getState().pendingActions).toBe(0);
  });

  it('étiquette ordinaire : le retrait attend la réponse à la pose, une autre étiquette n’attend pas', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.setArticleLabel).mockImplementation(async (_id: string | string[], label: string, on?: boolean) => {
      order.push(`${label}:${on}`);
      if (label === 'user/-/label/A' && on) await slow.promise;
    });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleArticleLabel(a, 'user/-/label/A');
    const p2 = useFeedStore.getState().toggleArticleLabel({ ...a, labels: ['user/-/label/A'] }, 'user/-/label/A');
    const p3 = useFeedStore.getState().toggleArticleLabel(a, 'user/-/label/B');
    await settled();
    expect(order).toEqual(['user/-/label/A:true', 'user/-/label/B:true']);
    slow.resolve();
    await p1; await p2; await p3;
    expect(order).toEqual(['user/-/label/A:true', 'user/-/label/B:true', 'user/-/label/A:false']);
  });

  it('plage « au-dessus » : le lot attend l’écriture « non lu » en vol d’un article qu’il contient', async () => {
    const { api, useFeedStore } = await load();
    const [recent, older] = useFeedStore.getState().articles; // item(2), item(1)
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); await slow.promise; order.push('non lu ✓'); });
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lot lu'); });
    // Identifiants décimaux de `stream/items/ids`, quand les lignes portent la forme greader.
    vi.mocked(api.itemIdsNewerThanEntry).mockResolvedValue(['2']);
    const p1 = useFeedStore.getState().toggleRead({ ...recent, read: true });
    const p2 = useFeedStore.getState().markReadRelative(older, 'above');
    await settled();
    expect(order).toEqual(['non lu']);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual(['non lu', 'non lu ✓', 'lot lu']);
  });

  it('plage « au-dessus » : un lot dont aucun article n’est en vol n’attend pas', async () => {
    const { api, useFeedStore } = await load();
    const [recent, older] = useFeedStore.getState().articles;
    const order: string[] = [];
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('autre'); await new Promise(() => {}); });
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lot lu'); });
    vi.mocked(api.itemIdsNewerThanEntry).mockResolvedValue(['2']);
    void useFeedStore.getState().toggleRead({ ...older, read: true }); // en vol, hors du lot
    await useFeedStore.getState().markReadRelative(older, 'above');
    expect(order).toEqual(['autre', 'lot lu']);
    expect(recent.id).toBeTruthy();
  });

  it('retour en arrière de « tout lu » : le lot « non lu » attend l’écriture « lu » en vol d’un article qu’il contient', async () => {
    const { api, useFeedStore } = await load();
    const { useUiStore } = await import('./uiStore');
    useUiStore.setState({ toasts: [] } as never);
    const a = useFeedStore.getState().articles[0]; // item(2)
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); await slow.promise; order.push('lu ✓'); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('lot non lu'); });
    vi.mocked(api.getUnreadItemIds).mockResolvedValue({ ids: ['2', '1'], complete: true } as never);
    await useFeedStore.getState().markAllAsRead();
    // « Lu » lent touché APRÈS « tout lu » (qui, lui, attend les écritures
    // « lu » en vol de la portée), juste avant le retour en arrière.
    const p1 = useFeedStore.getState().toggleRead({ ...a, read: false });
    const undo = useUiStore.getState().toasts.at(-1)!.action!.run();
    await settled();
    expect(order).toEqual(['lu']);
    slow.resolve();
    await p1; await undo;
    expect(order).toEqual(['lu', 'lu ✓', 'lot non lu']);
  });
});

// Limites restantes du second round : « tout marquer comme lu » et le
// marquage « en dessous » envoient une borne (`mark-all-as-read`), pas une
// liste d'articles. Ils passaient hors série : un « non lu » encore en vol
// pouvait arriver chez FreshRSS APRÈS la borne et laisser l'article non lu
// là-bas, lu à l'écran.
describe('écritures à borne mises en série (« tout lu », « en dessous »)', () => {
  it('« tout lu » attend le règlement d’un « non lu » en vol', async () => {
    const { api, useFeedStore } = await load();
    const a = useFeedStore.getState().articles[0];
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); await slow.promise; order.push('non lu ✓'); });
    vi.mocked(api.markAllAsRead).mockImplementation(async () => { order.push('tout lu'); });
    const p1 = useFeedStore.getState().toggleRead({ ...a, read: true });
    const p2 = useFeedStore.getState().markAllAsRead();
    await settled();
    expect(order).toEqual(['non lu']);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual(['non lu', 'non lu ✓', 'tout lu']);
  });

  it('« tout lu » n’attend pas une écriture d’un autre attribut', async () => {
    const { api, useFeedStore } = await load();
    const a = useFeedStore.getState().articles[0];
    vi.mocked(api.markAsStarred).mockImplementation(async () => { await new Promise(() => {}); });
    void useFeedStore.getState().toggleStar(a);
    await useFeedStore.getState().markAllAsRead();
    expect(api.markAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('un « lu » lancé pendant « tout lu » attend son règlement', async () => {
    const { api, useFeedStore } = await load();
    const a = useFeedStore.getState().articles[0];
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAllAsRead).mockImplementation(async () => { order.push('tout lu'); await slow.promise; order.push('tout lu ✓'); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const p1 = useFeedStore.getState().markAllAsRead();
    await settled();
    expect(order).toEqual(['tout lu']);
    const p2 = useFeedStore.getState().toggleRead({ ...a, read: true });
    await settled();
    expect(order, 'le geste attend la borne').toEqual(['tout lu']);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual(['tout lu', 'tout lu ✓', 'non lu']);
  });

  it('« tout lu » revoit le serveur après l’attente : rien ne part vers un autre serveur', async () => {
    const { api, useFeedStore } = await load();
    const { useAuthStore } = await import('./authStore');
    const a = useFeedStore.getState().articles[0];
    const slow = deferred();
    vi.mocked(api.markAsUnread).mockImplementation(async () => { await slow.promise; });
    const p1 = useFeedStore.getState().toggleRead({ ...a, read: true });
    const p2 = useFeedStore.getState().markAllAsRead();
    await settled();
    useAuthStore.setState({ activeServerId: '2' } as never);
    slow.resolve();
    await p1; await p2;
    expect(api.markAllAsRead).not.toHaveBeenCalled();
  });

  it('« en dessous » attend le règlement d’un « non lu » en vol', async () => {
    const { api, useFeedStore } = await load();
    const [recent, older] = useFeedStore.getState().articles; // item(2), item(1)
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); await slow.promise; order.push('non lu ✓'); });
    vi.mocked(api.markAllAsRead).mockImplementation(async () => { order.push('en dessous'); });
    const p1 = useFeedStore.getState().toggleRead({ ...older, read: true });
    const p2 = useFeedStore.getState().markReadRelative(recent, 'below');
    await settled();
    expect(order).toEqual(['non lu']);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual(['non lu', 'non lu ✓', 'en dessous']);
  });

  it('« en dessous » sans écriture « lu » en vol part au clic', async () => {
    const { api, useFeedStore } = await load();
    const [recent] = useFeedStore.getState().articles;
    void useFeedStore.getState().markReadRelative(recent, 'below');
    expect(api.markAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('un « non lu » lancé pendant « en dessous » attend son règlement', async () => {
    const { api, useFeedStore } = await load();
    const [recent, older] = useFeedStore.getState().articles;
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAllAsRead).mockImplementation(async () => { order.push('en dessous'); await slow.promise; order.push('en dessous ✓'); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const p1 = useFeedStore.getState().markReadRelative(recent, 'below');
    await settled();
    const p2 = useFeedStore.getState().toggleRead({ ...older, read: true });
    await settled();
    expect(order).toEqual(['en dessous']);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual(['en dessous', 'en dessous ✓', 'non lu']);
  });
});
