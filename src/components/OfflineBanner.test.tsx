import fs from 'fs';
import path from 'path';
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import OfflineBanner from './OfflineBanner';
import { useFeedStore } from '../stores/feedStore';

// Translations aren't under test here — return the key so assertions are stable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const fire = (type: 'online' | 'offline') =>
  act(() => { window.dispatchEvent(new Event(type)); });

describe('OfflineBanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('renders nothing while online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container.querySelector('.offline-banner')).toBeNull();
  });

  it('shows the offline notice when the connection drops', () => {
    const { container } = render(<OfflineBanner />);
    fire('offline');
    const b = container.querySelector('.offline-banner');
    expect(b).not.toBeNull();
    expect(b!.getAttribute('data-state')).toBe('offline');
    expect(b!.textContent).toContain('connection.offline');
  });

  it('confirms the reconnection, then hides after the delay', () => {
    const { container } = render(<OfflineBanner />);
    fire('offline');
    fire('online');

    const b = container.querySelector('.offline-banner');
    expect(b).not.toBeNull();
    expect(b!.getAttribute('data-state')).toBe('online');
    expect(b!.textContent).toContain('connection.backOnline');

    act(() => { vi.advanceTimersByTime(2600); });
    expect(container.querySelector('.offline-banner')).toBeNull();
  });

  it('stays hidden on a spurious online event (never went offline)', () => {
    const { container } = render(<OfflineBanner />);
    fire('online');
    expect(container.querySelector('.offline-banner')).toBeNull();
  });

  // Discussion #19 : fixée en haut de l'écran, la bannière recouvrait
  // l'en-tête mobile (Android, pas de safe-area). Elle doit occuper sa
  // propre rangée dans la coquille, jamais flotter par-dessus.
  it('takes its own row in the shell: no fixed positioning in the stylesheet', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/index.css'), 'utf8');
    const rule = css.match(/\.offline-banner \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toMatch(/position:\s*fixed/);
    expect(rule).not.toMatch(/z-index/);
  });

  // N4 : un 401 relayé de FreshRSS arrête le rejeu et garde la file. Sans un
  // mot, les actions attendaient sans que rien ne dise pourquoi ni quoi faire.
  it('dit que FreshRSS refuse les actions en attente, et reste affiché', () => {
    useFeedStore.setState({ replayRefusedByServer: true, failedActions: 0 });
    const { container } = render(<OfflineBanner />);
    const b = container.querySelector('.offline-banner');
    expect(b?.textContent).toContain('connection.refusedByServer');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(container.querySelector('.offline-banner')?.textContent).toContain('connection.refusedByServer');
    act(() => { useFeedStore.setState({ replayRefusedByServer: false }); });
    expect(container.querySelector('.offline-banner')).toBeNull();
  });

  // La phrase renvoyait d'abord à Préférences › Flux, où rien ne changeait le
  // mot de passe d'API d'un serveur existant. Ce champ existe désormais
  // (« Changer le mot de passe API ») : la phrase y renvoie, avec les vrais
  // libellés de chaque langue — un libellé renommé un jour la rendrait fausse.
  it('la phrase du refus renvoie à la vraie commande, dans chaque langue', () => {
    const dir = path.join(process.cwd(), 'src/locales');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const loc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const text: string = loc.connection.refusedByServer;
      expect(text, file).toContain(loc.preferences.title);
      expect(text, file).toContain(loc.preferences.sections.feeds);
      expect(text, file).toContain(loc.servers.changeCredentials);
    }
  });
});
