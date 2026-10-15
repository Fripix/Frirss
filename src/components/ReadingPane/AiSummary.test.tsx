// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import AiSummary from './AiSummary';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k) }) }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));
afterEach(cleanup);

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
});
