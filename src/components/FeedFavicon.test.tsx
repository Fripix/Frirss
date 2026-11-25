// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { FAVICON_MAX_AGE_MS, resetFaviconSession, setFavicon } from '../lib/faviconCache';

const get = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ default: { get } }));

import FeedFavicon from './FeedFavicon';

const URL_ = 'https://rss.example/f.php?h=abc';
const GLOBE = 'data:image/x-icon;base64,R0xPQkU=';
const imageBlob = (body: string, type = 'image/png') => ({ data: new Blob([body], { type }) });

beforeEach(() => {
  localStorage.clear();
  resetFaviconSession({ dropMemory: true });
  get.mockReset();
});
afterEach(cleanup);

// Le globe de FreshRSS restait pour toujours une fois gardé (capture de Fripix,
// 2026-11-24) : l'icône gardée s'affiche tout de suite, puis se répare.
describe('FeedFavicon — icône gardée', () => {
  it('affiche l’icône gardée tout de suite, puis celle que le serveur sert aujourd’hui', async () => {
    localStorage.setItem('frirss_favicon:' + URL_, GLOBE); // gardée avant 1.10.0, sans date
    get.mockResolvedValue(imageBlob('REAL'));
    const { container } = render(<FeedFavicon iconUrl={URL_} title="Clubic" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(GLOBE);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).not.toBe(GLOBE));
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('ne redemande pas une icône vérifiée récemment', async () => {
    setFavicon(URL_, GLOBE, Date.now());
    const { container } = render(<FeedFavicon iconUrl={URL_} title="Clubic" />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(GLOBE);
    expect(get).not.toHaveBeenCalled();
  });

  it('redemande une icône vérifiée il y a plus d’une semaine', async () => {
    setFavicon(URL_, GLOBE, Date.now() - FAVICON_MAX_AGE_MS - 1000);
    get.mockResolvedValue(imageBlob('REAL'));
    render(<FeedFavicon iconUrl={URL_} title="Clubic" />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  });

  it('une seule requête quand la barre latérale et la liste montrent la même icône', async () => {
    localStorage.setItem('frirss_favicon:' + URL_, GLOBE);
    get.mockResolvedValue(imageBlob('REAL'));
    render(<><FeedFavicon iconUrl={URL_} title="A" /><FeedFavicon iconUrl={URL_} title="A" size={16} /></>);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('garde l’icône gardée si le serveur répond autre chose qu’une image', async () => {
    localStorage.setItem('frirss_favicon:' + URL_, GLOBE);
    get.mockResolvedValue(imageBlob('<html>', 'text/html'));
    const { container } = render(<FeedFavicon iconUrl={URL_} title="Clubic" />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(GLOBE);
  });
});
