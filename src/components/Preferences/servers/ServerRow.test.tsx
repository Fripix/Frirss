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

  it('discards the typed value when cancel is clicked', () => {
    const onRename = vi.fn();
    const { getByText, getByDisplayValue, queryByDisplayValue } = render(
      <ServerRow {...baseProps()} onRename={onRename} />,
    );

    fireEvent.click(getByText('servers.rename'));
    const input = getByDisplayValue('Old name');
    fireEvent.change(input, { target: { value: 'Abandoned name' } });
    fireEvent.click(getByText('sidebar.cancel'));

    expect(queryByDisplayValue('Abandoned name')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe('ServerRow — synthetic (legacy) connection', () => {
  // En usage réel, la ligne synthétique EST la ligne active (displayServers()
  // lui attribue id = activeServerId) : isActive: true rend le test fidèle
  // sans changer ce qu'il affirme (le corps reste inerte, `synthetic` prime).
  const syntheticServer: DisplayServer = {
    id: 1,
    name: 'Legacy connection',
    url: 'https://legacy.example.com',
    freshrss_user: 'alice',
    synthetic: true,
  };

  it('stays inert even when expanded is true: no expand control, no token field, no toggle', () => {
    const onToggle = vi.fn();
    const onSwitch = vi.fn();
    const { queryByLabelText, queryByText, getByText } = render(
      <ServerRow
        {...baseProps()}
        server={syntheticServer}
        isActive
        expanded
        onToggle={onToggle}
        onSwitch={onSwitch}
        onRename={vi.fn()}
      />,
    );

    expect(queryByLabelText('servers.expand')).toBeNull();
    expect(queryByLabelText('servers.collapse')).toBeNull();
    expect(queryByText('preferences.refresh.tokenLabel')).toBeNull();

    const bodyButton = getByText('Legacy connection').closest('button');
    expect(bodyButton).not.toBeNull();
    fireEvent.click(bodyButton!);

    expect(onToggle).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });
});

describe('ServerRow — active row body click', () => {
  it('routes a click on the active row body to onToggle, not onSwitch', () => {
    const onToggle = vi.fn();
    const onSwitch = vi.fn();
    const { getByText } = render(
      <ServerRow
        {...baseProps()}
        isActive
        onToggle={onToggle}
        onSwitch={onSwitch}
        onRename={vi.fn()}
      />,
    );

    const bodyButton = getByText('Old name').closest('button');
    expect(bodyButton).not.toBeNull();
    fireEvent.click(bodyButton!);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });
});

describe('ServerRow — cannotDeleteLast', () => {
  it('disables the delete button when canDelete is false', () => {
    const { getByText } = render(
      <ServerRow {...baseProps()} canDelete={false} onRename={vi.fn()} />,
    );

    const deleteButton = getByText('servers.delete').closest('button') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
  });
});
