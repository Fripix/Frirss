// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ShortcutHelp from './ShortcutHelp';
import { useUiStore } from '../stores/uiStore';
import { useAiStore } from '../stores/aiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };
const cfg = { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };

beforeEach(() => {
  useUiStore.setState({ shortcutHelpOpen: true });
  useAiStore.setState({ config: null });
});
afterEach(cleanup);

describe('ShortcutHelp — summarize entry', () => {
  it('is hidden while AI is off', () => {
    render(<ShortcutHelp />);
    expect(document.body.textContent).not.toContain('preferences.shortcuts.summarize');
    // …and the other configurable shortcuts are still listed.
    expect(document.body.textContent).toContain('preferences.shortcuts.nextArticle');
  });

  it('is hidden while no provider is usable', () => {
    useAiStore.setState({ config: { ...cfg, providers: [{ ...provider, available: false }] } });
    render(<ShortcutHelp />);
    expect(document.body.textContent).not.toContain('preferences.shortcuts.summarize');
  });

  it('is listed with its configured key once AI is usable', () => {
    useAiStore.setState({ config: cfg });
    useUiStore.getState().setShortcut('summarize', 'z');
    render(<ShortcutHelp />);
    expect(document.body.textContent).toContain('preferences.shortcuts.summarize');
    expect(document.body.textContent).toContain('Z');
    useUiStore.getState().setShortcut('summarize', 's');
  });
});
