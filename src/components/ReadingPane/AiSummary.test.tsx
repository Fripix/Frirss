// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import AiSummary from './AiSummary';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k) }) }));
const breakpoint = vi.fn<() => 'desktop' | 'tablet' | 'mobile'>(() => 'desktop');
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => breakpoint() }));
afterEach(() => { cleanup(); breakpoint.mockReset(); breakpoint.mockImplementation(() => 'desktop'); });

const providers: AiProviderView[] = [
  { id: 1, name: 'Claude', type: 'anthropic', hasAdminKey: true, shared: true, hasUserKey: false, available: true },
  { id: 2, name: 'Ollama', type: 'openai', hasAdminKey: false, shared: false, hasUserKey: false, available: true },
  { id: 3, name: 'Privé', type: 'anthropic', hasAdminKey: true, shared: false, hasUserKey: false, available: false },
];
const result: AiSummaryResult = { text: 'Premier.\n\nSecond.', lang: 'fr', providerId: 2, providerName: 'Ollama', model: 'm', fromCache: false, fellBackFrom: 'Claude' };
const noop = () => {};

describe('AiSummary', () => {
  it('idle: the chip asks for a summary with the default provider', () => {
    const onSummarize = vi.fn();
    const { getByRole } = render(<AiSummary status="idle" result={null} error={null} providers={providers} onSummarize={onSummarize} onHide={noop} />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(onSummarize).toHaveBeenCalledWith(undefined);
  });
  it('loading: the chip is disabled', () => {
    const { getByRole } = render(<AiSummary status="loading" result={null} error={null} providers={providers} onSummarize={noop} onHide={noop} />);
    expect((getByRole('button', { name: 'ai.summarize' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('done: shows provider, fallback notice, paragraphs, and only available providers in the menu', () => {
    const onSummarize = vi.fn();
    const { getByText, getByRole, queryByText } = render(<AiSummary status="done" result={result} error={null} providers={providers} onSummarize={onSummarize} onHide={noop} />);
    expect(getByText('ai.by:Ollama')).toBeTruthy();
    expect(getByText('ai.fellBack:Claude')).toBeTruthy();
    expect(getByText('Premier.')).toBeTruthy();
    expect(getByText('Second.')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(queryByText('Privé')).toBeNull();
    fireEvent.click(getByText('Claude'));
    expect(onSummarize).toHaveBeenCalledWith(1);
  });
  it('done: clicking the chip hides the block', () => {
    const onHide = vi.fn();
    const { getByRole } = render(<AiSummary status="done" result={result} error={null} providers={providers} onSummarize={noop} onHide={onHide} />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(onHide).toHaveBeenCalledOnce();
  });
  it('error: the message is shown and the chip retries', () => {
    const onSummarize = vi.fn();
    const { getByText, getByRole } = render(<AiSummary status="error" result={null} error="ai.errors.auth" providers={providers} onSummarize={onSummarize} onHide={noop} />);
    expect(getByText('ai.errors.auth')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(onSummarize).toHaveBeenCalled();
  });

  const doneProps = { status: 'done' as const, result, error: null, providers, onSummarize: noop, onHide: noop };

  it('aria-pressed is false when idle and true when done', () => {
    const idle = render(<AiSummary status="idle" result={null} error={null} providers={providers} onSummarize={noop} onHide={noop} />);
    expect(idle.getByRole('button', { name: 'ai.summarize' }).getAttribute('aria-pressed')).toBe('false');
    cleanup();
    const done = render(<AiSummary {...doneProps} />);
    expect(done.getByRole('button', { name: 'ai.summarize' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('error: the message is a role=alert', () => {
    const { getByRole } = render(<AiSummary status="error" result={null} error="ai.errors.auth" providers={providers} onSummarize={noop} onHide={noop} />);
    expect(getByRole('alert').textContent).toBe('ai.errors.auth');
  });
  it('shows the cache note only when the summary came from the cache', () => {
    const fresh = render(<AiSummary {...doneProps} />);
    expect(fresh.queryByText('ai.fromCache')).toBeNull();
    cleanup();
    const cached = render(<AiSummary {...doneProps} result={{ ...result, fromCache: true }} />);
    expect(cached.getByText('ai.fromCache')).toBeTruthy();
  });
  it('the fallback notice is information, not an alert', () => {
    const { getByText, queryByRole } = render(<AiSummary {...doneProps} />);
    expect(getByText('ai.fellBack:Claude').style.color).toBe('var(--reading-meta)');
    expect(queryByRole('alert')).toBeNull();
  });
  it('the summary lives in a polite live region that is mounted before the result arrives', () => {
    const { getByRole, rerender, queryByLabelText } = render(<AiSummary status="loading" result={null} error={null} providers={providers} onSummarize={noop} onHide={noop} />);
    const region = getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(queryByLabelText('ai.summaryTitle')).toBeNull();
    rerender(<AiSummary {...doneProps} />);
    expect(getByRole('status')).toBe(region);
    expect(region.contains(queryByLabelText('ai.summaryTitle'))).toBe(true);
  });
  it('desktop: the menu is a role=menu portal under body, with menuitem children', () => {
    const { getByRole, getAllByRole, container } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    const menu = getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Claude', 'Ollama']);
  });
  it('desktop: Escape closes the menu and returns focus to the trigger', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} />);
    const trigger = getByRole('button', { name: 'ai.withProvider' });
    fireEvent.click(trigger);
    expect(getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('desktop: Tab closes the menu', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(queryByRole('menu')).toBeNull();
  });
  it('desktop: ArrowDown moves between menu items', () => {
    const { getByRole, getAllByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    const items = getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });
  it('desktop: a click outside closes the menu', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.click(document.body.querySelector('[aria-hidden="true"].fixed') as Element);
    expect(queryByRole('menu')).toBeNull();
  });
  it('touch: the menu is a bottom sheet, not a popover, and Escape returns focus to the trigger', () => {
    breakpoint.mockImplementation(() => 'mobile');
    const { getByRole, queryByRole, getByText } = render(<AiSummary {...doneProps} />);
    const trigger = getByRole('button', { name: 'ai.withProvider' });
    fireEvent.click(trigger);
    const dialog = getByRole('dialog');
    expect(dialog.className).toContain('bottom-sheet');
    expect(queryByRole('menu')).toBeNull();
    expect(getByText('Claude').closest('button')?.className).toContain('sheet-row');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('desktop rows do not use the sheet-row class', () => {
    const { getByRole, getAllByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(getAllByRole('menuitem')[0].className).not.toContain('sheet-row');
  });
  it('the menu closes when the status leaves done, and does not reopen', () => {
    const { getByRole, queryByRole, rerender } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    rerender(<AiSummary {...doneProps} status="loading" result={null} />);
    expect(queryByRole('menu')).toBeNull();
    rerender(<AiSummary {...doneProps} />);
    expect(queryByRole('menu')).toBeNull();
  });
});
