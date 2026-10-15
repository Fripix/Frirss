// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// t(key) → key, as in the other component tests.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import InterestingAlgorithmSelect from './InterestingAlgorithmSelect';

afterEach(cleanup);

const LABELS = [
  'Current',
  'Weighted terms + IDF',
  'Synonyms + stemming',
  'Topic / interest profiles',
  'Combined',
  'MS NewsRec',
  'Personal News',
  'Intelligence Next',
];

describe.each(['toolbar', 'sheet'] as const)('InterestingAlgorithmSelect (%s)', (variant) => {
  it('lists every algorithm, existing ones first and Intelligence Next last', () => {
    render(<InterestingAlgorithmSelect value="current" onChange={() => {}} variant={variant} />);
    const select = screen.getByRole('combobox', { name: 'articleList.rankingAlgorithmLabel' }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(LABELS);
    expect(select.value).toBe('current');
  });

  it('shows the stored choice and reports a new one', () => {
    const onChange = vi.fn();
    render(<InterestingAlgorithmSelect value="personal-news" onChange={onChange} variant={variant} />);
    const select = screen.getByRole('combobox', { name: 'articleList.rankingAlgorithmLabel' }) as HTMLSelectElement;
    expect(select.value).toBe('personal-news');
    fireEvent.change(select, { target: { value: 'intelligence-next' } });
    expect(onChange).toHaveBeenCalledWith('intelligence-next');
  });
});

it('labels the mobile row so it reads as a setting', () => {
  render(<InterestingAlgorithmSelect value="current" onChange={() => {}} variant="sheet" />);
  expect(screen.getByText('articleList.rankingAlgorithmRow')).toBeTruthy();
});

it('labels the desktop control through the translations', () => {
  render(<InterestingAlgorithmSelect value="current" onChange={() => {}} />);
  expect(screen.getByText('articleList.rankingAlgorithm')).toBeTruthy();
  expect(screen.getByTitle('articleList.rankingAlgorithmHint')).toBeTruthy();
});
