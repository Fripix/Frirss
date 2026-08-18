// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import ViewModeSwitcher from './ViewModeSwitcher';
import { useUiStore } from '../../stores/uiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

afterEach(cleanup);

describe('ViewModeSwitcher', () => {
  it('offers a grid mode button', () => {
    const { getByTitle } = render(<ViewModeSwitcher />);
    expect(getByTitle('viewMode.grid')).toBeTruthy();
  });
  it('selects grid mode on click', () => {
    const { getByTitle } = render(<ViewModeSwitcher />);
    fireEvent.click(getByTitle('viewMode.grid'));
    expect(useUiStore.getState().viewMode).toBe('grid');
  });
});
