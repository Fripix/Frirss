// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import OfflineBanner from './OfflineBanner';

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
});
