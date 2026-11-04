// @vitest-environment jsdom
// Barre du volet de lecture personnalisable sur desktop (Préférences → Mise en page).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
}));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()), markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()), markAllAsRead: vi.fn(() => Promise.resolve()),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(),
}));
vi.mock('../../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn(), getAiConfig: vi.fn(), requestAiSummary: vi.fn() }));
vi.mock('../../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(() => Promise.resolve(undefined)), listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()), subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()), queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/extractStore', () => ({
  dbGet: vi.fn(() => Promise.resolve(undefined)), dbPut: vi.fn(() => Promise.resolve()),
  dbRecent: vi.fn(() => Promise.resolve([])), dbEvictOlderThan: vi.fn(() => Promise.resolve()),
  dbSetPinned: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

let breakpoint: 'desktop' | 'tablet' | 'mobile' = 'desktop';
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => breakpoint, useRawBreakpoint: () => breakpoint }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { DEFAULT_TOOLBAR_VISIBILITY, TOOLBAR_ITEMS, type ToolbarVisibility } from '../../lib/toolbarItems';
import { probeToolbarCommands, runToolbarCommand } from '../../lib/toolbarCommands';

const LABEL = 'user/-/label/Tech';
const article = (over: Partial<Article> = {}) => ({
  id: 'r1', title: 'Titre', summary: 's', source: 'Src', sourceId: 'feed/1',
  content: '<p>rss</p>', url: 'https://example.com/1', published: Date.now(), read: true, starred: false, labels: [],
  ...over,
}) as unknown as Article;
const READING = TOOLBAR_ITEMS.filter((i) => i.zone === 'reading').map((i) => i.id);

function visibility(hidden: string[]): ToolbarVisibility {
  const v = { ...DEFAULT_TOOLBAR_VISIBILITY };
  for (const id of hidden) (v as Record<string, boolean>)[id] = false;
  return v;
}

async function show(opts: { hidden?: string[]; showBack?: boolean; art?: Article } = {}) {
  const a = opts.art ?? article();
  useUiStore.setState({ toolbarVisibility: visibility(opts.hidden ?? []), readingFocus: false } as never);
  useFeedStore.setState({ selectedArticle: a, articles: [a], labels: [{ id: LABEL }], categoryIds: [] } as never);
  const r = render(<ReadingPane showBack={opts.showBack} />);
  await act(async () => { await Promise.resolve(); });
  return r;
}
const toolbar = () => document.querySelector('.reading-toolbar');
const separators = () => [...(toolbar()?.children ?? [])].filter((e) => e.className.includes('w-px')).length;
const btn = (c: ReturnType<typeof render>, name: string) => c.queryAllByRole('button', { name })[0];

afterEach(() => { cleanup(); breakpoint = 'desktop'; });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('barre du volet — séparateurs', () => {
  it('rien de masqué : deux séparateurs (témoin)', async () => {
    await show();
    expect(separators()).toBe(2);
  });

  it('Étiquettes masquées : un seul séparateur entre les deux groupes restants', async () => {
    const c = await show({ hidden: ['labels'] });
    expect(separators()).toBe(1);
    expect(btn(c, 'readingPane.labels')).toBeUndefined();
  });

  it('Lu, Favori et À lire plus tard masqués : rien avant Étiquettes', async () => {
    await show({ hidden: ['read', 'star', 'readLater'] });
    expect(separators()).toBe(1);
    const first = toolbar()!.children[0];
    expect(first.className.includes('w-px')).toBe(false);
  });

  it('A− / A+ masqués : plus de réglage de taille dans la barre', async () => {
    const c = await show({ hidden: ['fontSize'] });
    expect(btn(c, 'sidebar.reduceText (14px)')).toBeUndefined();
    expect(toolbar()!.querySelector('.font-size-value')).toBeNull();
  });
});

describe('barre du volet — tout masqué', () => {
  it('en 2 colonnes : pas de barre, la progression en liseré en haut, Retour dans la palette', async () => {
    await show({ hidden: READING, showBack: true });
    expect(toolbar()).toBeNull();
    const scroller = document.querySelector('.nice-scroll') as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 });
    scroller.scrollTop = 750;
    await act(async () => {
      fireEvent.scroll(scroller);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const line = document.querySelector('.reading-progress');
    expect(line?.className).toContain('top-0');
    expect(probeToolbarCommands().map((o) => o.command)).toContain('back');
  });

  it('tablette : rendu inchangé, pas de liseré ajouté hors progression', async () => {
    breakpoint = 'tablet';
    await show({ hidden: READING });
    expect(toolbar()).toBeNull();
  });
});

describe('barre du volet — commandes offertes à la palette', () => {
  const commands = () => probeToolbarCommands().map((o) => o.command);

  it('chaque bouton a sa commande, même masqué', async () => {
    await show({ hidden: READING, showBack: true });
    expect(commands()).toEqual(expect.arrayContaining([
      'back', 'read', 'star', 'readLater', `label:${LABEL}`, 'fullContent', 'original', 'share', 'focus', 'fontDown', 'fontUp',
    ]));
  });

  it('pas de Retour hors 2 colonnes, pas de Texte source sans traduction affichée', async () => {
    await show();
    expect(commands()).not.toContain('back');
    expect(commands()).not.toContain('showSource');
  });

  it('Favori bascule l’étoile de l’article ouvert', async () => {
    await show({ hidden: ['star'] });
    await act(async () => { runToolbarCommand('star'); await Promise.resolve(); });
    expect(useFeedStore.getState().selectedArticle?.starred).toBe(true);
  });

  it('une étiquette se pose depuis la palette, libellé « ajouter » puis « retirer »', async () => {
    const spy = vi.fn(async () => {});
    useFeedStore.setState({ toggleArticleLabel: spy } as never);
    await show();
    expect(probeToolbarCommands().find((o) => o.command === `label:${LABEL}`)?.label).toBe('palette.labelAdd');
    act(() => { runToolbarCommand(`label:${LABEL}`); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), LABEL);
    cleanup();
    await show({ art: article({ labels: [LABEL] }) });
    expect(probeToolbarCommands().find((o) => o.command === `label:${LABEL}`)?.label).toBe('palette.labelRemove');
  });

  it('Mode Focus bascule depuis la palette', async () => {
    await show({ hidden: ['focus'] });
    act(() => { runToolbarCommand('focus'); });
    expect(useUiStore.getState().readingFocus).toBe(true);
  });
});
