// @vitest-environment jsdom
//
// Volet de lecture : ce qu'il montre autour de l'extraction de l'article
// complet et des vidéos YouTube (campagne 1.9.0, L-03, L-06, L-08).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import type { Article } from '../../types';

const extractMock = vi.hoisted(() => ({ fn: vi.fn() }));

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
vi.mock('../../utils/extractContent', async (orig) => ({
  ...(await orig<typeof import('../../utils/extractContent')>()),
  extractFullContent: (...args: unknown[]) => extractMock.fn(...args),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { dbGet } from '../../lib/extractStore';

const BODY_SELECTOR = '.reading-body-enter';

const base = {
  title: 'Titre', summary: 's', source: 'Src', sourceId: 'feed/1',
  published: Date.now(), read: false, starred: false, labels: [],
};

async function open(article: Article) {
  useFeedStore.setState({ selectedArticle: article, articles: [article] } as never);
  const view = render(<ReadingPane />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  extractMock.fn.mockReset();
  useUiStore.setState({ feedSettings: {}, autoExtractDefault: false, inlineVideos: true } as never);
});

describe('ReadingPane — article de flux YouTube', () => {
  // L-08 : la vignette FreshRSS (`img.enclosure-thumbnail`) et la façade
  // d'en-tête montraient la même image l'une sous l'autre.
  it('ne montre la vignette de la vidéo qu’une fois, dans la façade d’en-tête', async () => {
    const ID = 'dQw4w9WgXcQ';
    const article = {
      ...base, id: 'yt1', url: `https://www.youtube.com/watch?v=${ID}`,
      content: `<div class="enclosure"><p class="enclosure-content"><img class="enclosure-thumbnail" src="https://i3.ytimg.com/vi/${ID}/hqdefault.jpg" alt=""></p></div><p>description</p>`,
    } as unknown as Article;
    const { container } = await open(article);

    expect(container.querySelectorAll('.yt-facade')).toHaveLength(1);
    const thumbs = [...container.querySelectorAll('img')].filter((img) => (img.getAttribute('src') || '').includes(`/vi/${ID}/`));
    expect(thumbs).toHaveLength(1);
    expect(container.querySelector(`${BODY_SELECTOR}`)?.textContent).toContain('description');
  });

  // L-03 : une vidéo n'a pas d'article à extraire. Avec « Article complet »
  // par défaut, chaque ouverture partait à l'extraction, échouait, et posait
  // un bandeau rouge sur la vidéo.
  it('n’extrait pas une vidéo, même avec « Article complet » par défaut', async () => {
    useUiStore.setState({ autoExtractDefault: true } as never);
    const article = {
      ...base, id: 'yt2', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', content: '',
    } as unknown as Article;
    const { container } = await open(article);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(extractMock.fn).not.toHaveBeenCalled();
    expect(container.querySelector('.reading-skeleton')).toBeNull();
    expect(container.textContent).not.toContain('readingPane.extractError');
    expect(container.textContent).not.toContain('readingPane.extractUnavailable');
  });
});

/** Le texte de l'avis « Article complet » (et non du bouton du même nom). */
const notice = (c: HTMLElement) => [...c.querySelectorAll('div')]
  .some((d) => [...d.childNodes].some((n) => n.nodeType === 3 && n.textContent === 'readingPane.fullContent'));

describe('ReadingPane — échec d’une extraction', () => {
  const article = (id: string) => ({
    ...base, id, url: `https://example.com/${id}`, content: '<p>contenu du flux</p>',
  } as unknown as Article);

  // Idée T2-2 : l'extraction AUTOMATIQUE qui échoue ne pose plus de bandeau
  // rouge sur l'article — une ligne discrète, avec de quoi réessayer.
  it('automatique : une ligne discrète, pas de bandeau d’erreur, et « Réessayer » insiste', async () => {
    useUiStore.setState({ autoExtractDefault: true } as never);
    extractMock.fn.mockRejectedValue(new Error('NO_CONTENT'));
    const { container, getByRole } = await open(article('f1'));
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(extractMock.fn).toHaveBeenCalledWith('https://example.com/f1', { retry: false });
    expect(container.textContent).not.toContain('readingPane.extractError');
    expect(container.textContent).toContain('readingPane.extractUnavailable');
    expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('contenu du flux');

    extractMock.fn.mockClear();
    await act(async () => { getByRole('button', { name: 'readingPane.retry' }).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(extractMock.fn).toHaveBeenCalledWith('https://example.com/f1', { retry: true });
    // Demandé par le lecteur, l'échec se dit en clair.
    expect(container.textContent).toContain('readingPane.extractError');
  });

  // Relecture 1.9.0 : « Réessayer » disparaissait au clic (focus sur <body>),
  // et l'échec de la nouvelle tentative partait en bandeau tout en haut,
  // loin de l'endroit où l'on avait cliqué.
  it('« Réessayer » garde le focus dans le volet, et un nouvel échec se dit au même endroit', async () => {
    useUiStore.setState({ autoExtractDefault: true } as never);
    extractMock.fn.mockRejectedValue(new Error('NO_CONTENT'));
    const { container, getByRole } = await open(article('f3'));
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    const retry = getByRole('button', { name: 'readingPane.retry' });
    act(() => { retry.focus(); });
    let finish!: (e: Error) => void;
    extractMock.fn.mockImplementation(() => new Promise((_, reject) => { finish = reject; }));
    await act(async () => { retry.click(); await Promise.resolve(); });
    // Pendant la tentative : le focus est resté dans le volet.
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
    await act(async () => { finish(new Error('NO_CONTENT')); await new Promise((r) => setTimeout(r, 0)); });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('readingPane.extractError');
    // Sous l'article, avec de quoi réessayer encore — pas en bandeau en tête.
    expect(alert?.closest('article')).not.toBeNull();
    expect(alert?.querySelector('button')?.textContent).toBe('readingPane.retry');
    expect(container.querySelectorAll('[style*="danger-light"]')).toHaveLength(0);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  // M-06 (second round) : au téléphone, la ligne démontée pendant la
  // tentative revenait dans les 52 px que couvre la barre du bas — rien de
  // visible, seul un lecteur d'écran annonçait l'échec.
  it('téléphone : après un « Réessayer » qui échoue, l’erreur est amenée au-dessus de la barre du bas', async () => {
    const width = window.innerWidth;
    window.innerWidth = 375;
    const proto = HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 375, width: 375, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    let scroller: HTMLElement | null = null;
    proto.getBoundingClientRect = function (this: HTMLElement) {
      if (this === scroller) return rect(0, 600);
      if (this.classList.contains('reading-bottombar')) return rect(548, 600);
      const scrolled = scroller?.scrollTop ?? 0;
      if (this.getAttribute('role') === 'alert') return rect(560 - scrolled, 580 - scrolled);
      return rect(0, 10);
    };
    try {
      useUiStore.setState({ autoExtractDefault: true } as never);
      extractMock.fn.mockRejectedValue(new Error('NO_CONTENT'));
      const { container, getByRole } = await open(article('m6'));
      await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
      scroller = container.querySelector<HTMLElement>('.overflow-y-auto[tabindex="-1"]');
      expect(scroller).not.toBeNull();
      await act(async () => { getByRole('button', { name: 'readingPane.retry' }).click(); await new Promise((r) => setTimeout(r, 0)); });
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      // Au plus juste : le bas de la ligne au ras de la barre (580 − 548).
      expect(scroller!.scrollTop).toBe(32);
    } finally {
      proto.getBoundingClientRect = original;
      window.innerWidth = width;
    }
  });

  // M-03 (second round) : un favori épinglé dont la page ne s'extrait plus
  // s'ouvrait complet hors ligne, mais en ligne sur l'erreur et le contenu du
  // flux — l'extrait d'une version antérieure n'était pas servi en ligne, et
  // l'échec de la réextraction ne s'y repliait pas.
  it('réextraction en échec : l’extrait d’une version antérieure est servi, sans erreur', async () => {
    useUiStore.setState({ autoExtractDefault: true } as never);
    const old = { id: 'p1', title: '', content: '<p>ancien article complet</p>', excerpt: '', byline: '', siteName: '', length: 24, cachedAt: Date.now(), pinned: true };
    vi.mocked(dbGet).mockImplementation(async (id: string) => (id === 'p1' ? old : undefined) as never);
    extractMock.fn.mockRejectedValue(new Error('NO_CONTENT'));
    try {
      const { container } = await open(article('p1'));
      await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
      expect(extractMock.fn).toHaveBeenCalled();
      expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('ancien article complet');
      expect(container.textContent).not.toContain('readingPane.extractError');
      expect(container.textContent).not.toContain('readingPane.extractUnavailable');
    } finally {
      vi.mocked(dbGet).mockImplementation(() => Promise.resolve(undefined));
    }
  });

  it('demandée par le lecteur : le bandeau d’erreur, comme avant', async () => {
    extractMock.fn.mockRejectedValue(new Error('NO_CONTENT'));
    const { container } = await open(article('f2'));
    const btn = container.querySelector('[title="readingPane.fullContent"]') as HTMLElement;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(extractMock.fn).toHaveBeenCalledWith('https://example.com/f2', { retry: true });
    expect(container.textContent).toContain('readingPane.extractError');
    expect(container.textContent).not.toContain('readingPane.extractUnavailable');
  });
});

// M-11 (second round) : le balayage du volet prenait tout geste horizontal,
// et annulait le défilement natif : au doigt, même un `<pre>` défilant ne
// défilait pas.
describe('ReadingPane — balayage et bloc qui défile de côté (M-11)', () => {
  it('un geste horizontal né dans un bloc qui défile encore dans ce sens lui revient, pas au balayage', async () => {
    const width = window.innerWidth;
    window.innerWidth = 375;
    try {
      const a = { ...base, id: 'w1', url: 'https://example.com/w1', content: '<pre style="overflow-x: auto">ligne très longue</pre><p>suite</p>' } as unknown as Article;
      const { container } = await open(a);
      const pre = container.querySelector<HTMLElement>('.article-content pre');
      expect(pre).not.toBeNull();
      Object.defineProperty(pre!, 'scrollWidth', { configurable: true, value: 800 });
      Object.defineProperty(pre!, 'clientWidth', { configurable: true, value: 300 });
      const scroller = container.querySelector<HTMLElement>('.overflow-y-auto[tabindex="-1"]')!;
      fireEvent.touchStart(pre!, { touches: [{ clientX: 200, clientY: 100 }] });
      const notCancelled = fireEvent.touchMove(pre!, { touches: [{ clientX: 140, clientY: 102 }] });
      expect(notCancelled).toBe(true);
      expect(scroller.style.transform).toBe('');
      fireEvent.touchEnd(pre!);

      // Le même geste hors du bloc reste un balayage.
      const p = [...container.querySelectorAll<HTMLElement>('.article-content p')].find((x) => x.textContent === 'suite')!;
      fireEvent.touchStart(p, { touches: [{ clientX: 200, clientY: 100 }] });
      expect(fireEvent.touchMove(p, { touches: [{ clientX: 140, clientY: 102 }] })).toBe(false);
      fireEvent.touchEnd(p);
    } finally {
      window.innerWidth = width;
    }
  });
});

describe('ReadingPane — avis « Article complet » (L-06)', () => {
  const full = { title: '', content: `<p>${'texte complet '.repeat(20)}</p>`, excerpt: '', byline: '', siteName: '', length: 280 };

  it('ne s’affiche pas après une extraction automatique due au réglage global', async () => {
    useUiStore.setState({ autoExtractDefault: true } as never);
    extractMock.fn.mockResolvedValue(full);
    const a = { ...base, id: 'n1', url: 'https://example.com/n1', content: '<p>flux</p>' } as unknown as Article;
    const { container } = await open(a);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('texte complet');
    expect(notice(container)).toBe(false);
  });

  it('s’affiche toujours après une extraction demandée par le lecteur', async () => {
    extractMock.fn.mockResolvedValue(full);
    const a = { ...base, id: 'n2', url: 'https://example.com/n2', content: '<p>flux</p>' } as unknown as Article;
    const { container } = await open(a);
    const btn = container.querySelector('[title="readingPane.fullContent"]') as HTMLElement;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('texte complet');
    expect(notice(container)).toBe(true);
  });
});

// Relecture 1.9.0 : un extrait trop court (L-04) n'est écarté que de
// l'extraction automatique. Demandé par le lecteur, il s'affiche, et le
// bouton suit ce qui est réellement montré.
describe('ReadingPane — « Article complet » demandé, extrait court', () => {
  const longRss = `<p>${'Le flux livre ici tout le texte de l’avis. '.repeat(20)}</p>`;
  const short = { title: '', content: '<h2>Solutions</h2><p>Voir l’éditeur.</p>', excerpt: '', byline: '', siteName: '', length: 30 };
  const fullBtn = (c: HTMLElement) => c.querySelector('button[title="readingPane.fullContent"], button[title="readingPane.showRss"]') as HTMLElement;

  it('demandé par le lecteur : l’extrait court s’affiche, le bouton propose « Contenu RSS »', async () => {
    extractMock.fn.mockResolvedValue(short);
    const a = { ...base, id: 's1', url: 'https://example.com/s1', content: longRss } as unknown as Article;
    const { container } = await open(a);
    await act(async () => { fullBtn(container).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('Voir l’éditeur.');
    expect(container.querySelector(BODY_SELECTOR)?.textContent).not.toContain('Le flux livre');
    expect(fullBtn(container).getAttribute('title')).toBe('readingPane.showRss');
    // « Contenu RSS » ramène le flux.
    await act(async () => { fullBtn(container).click(); });
    expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('Le flux livre');
    expect(fullBtn(container).getAttribute('title')).toBe('readingPane.fullContent');
  });

  it('extraction automatique : le flux reste, et le bouton dit « Article complet », qui montre l’extrait', async () => {
    useUiStore.setState({ autoExtractDefault: true } as never);
    extractMock.fn.mockResolvedValue(short);
    const a = { ...base, id: 's2', url: 'https://example.com/s2', content: longRss } as unknown as Article;
    const { container } = await open(a);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(extractMock.fn).toHaveBeenCalledTimes(1);
    expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('Le flux livre');
    expect(fullBtn(container).getAttribute('title')).toBe('readingPane.fullContent');
    await act(async () => { fullBtn(container).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(container.querySelector(BODY_SELECTOR)?.textContent).toContain('Voir l’éditeur.');
    expect(fullBtn(container).getAttribute('title')).toBe('readingPane.showRss');
  });
});
