import { describe, it, expect } from 'vitest';
import { shortcutRefusal } from './shortcutKeys';

const shortcuts = {
  nextArticle: 'ArrowDown', prevArticle: 'ArrowUp', openArticle: 'ArrowRight',
  markRead: 'r', toggleStar: 'd',
};

describe('shortcutRefusal', () => {
  it.each(['F1', 'F5', 'F12', 'Tab', ' ', 'Enter', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', '/', "'", '?'])(
    'refuses %j: the browser, the system or the help sheet owns it',
    (key) => {
      expect(shortcutRefusal(key, 'markRead', shortcuts)).toEqual({ reason: 'reserved' });
    },
  );

  it('refuses a key another action already has, and names that action', () => {
    expect(shortcutRefusal('d', 'markRead', shortcuts)).toEqual({ reason: 'taken', action: 'toggleStar' });
  });

  it('accepts the key the action already has', () => {
    expect(shortcutRefusal('r', 'markRead', shortcuts)).toBeNull();
  });

  it.each(['ArrowLeft', 'ArrowDown', 'x', 'F', 'Backspace'])('accepts %j', (key) => {
    const own = key === 'ArrowDown' ? 'nextArticle' : 'markRead';
    expect(shortcutRefusal(key, own, shortcuts)).toBeNull();
  });

  it('does not mistake F13+ or a letter F for a function key', () => {
    expect(shortcutRefusal('F13', 'markRead', shortcuts)).toBeNull();
    expect(shortcutRefusal('f', 'markRead', shortcuts)).toBeNull();
  });
});
