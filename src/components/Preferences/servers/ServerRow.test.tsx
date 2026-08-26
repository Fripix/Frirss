// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ServerRow from './ServerRow';
import type { DisplayServer } from '../../../lib/serverList';

// Translations aren't under test here — return the key so assertions are stable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const server: DisplayServer = {
  id: 1,
  name: 'Old name',
  url: 'https://example.com',
  freshrss_user: 'alice',
};

function baseProps() {
  return {
    server,
    isActive: false,
    expanded: true,
    canDelete: true,
    onToggle: vi.fn(),
    onSwitch: vi.fn(),
    onSetDefault: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onSaved: vi.fn(),
  };
}

afterEach(cleanup);

describe('ServerRow — rename form', () => {
  it('stays open with the typed value and shows an error when onRename fails', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('nope'));
    const { getByText, getByDisplayValue, findByText } = render(
      <ServerRow {...baseProps()} onRename={onRename} />,
    );

    fireEvent.click(getByText('servers.rename'));
    const input = getByDisplayValue('Old name');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(getByText('servers.rename'));

    await findByText('servers.errorGeneric');

    // The form is still on screen, with the typed value intact.
    expect(getByDisplayValue('New name')).toBeTruthy();
    expect(onRename).toHaveBeenCalledWith('New name');
  });

  it('closes the form once onRename succeeds', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByDisplayValue, queryByDisplayValue } = render(
      <ServerRow {...baseProps()} onRename={onRename} />,
    );

    fireEvent.click(getByText('servers.rename'));
    const input = getByDisplayValue('Old name');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(getByText('servers.rename'));

    await waitFor(() => expect(queryByDisplayValue('New name')).toBeNull());
  });
});
