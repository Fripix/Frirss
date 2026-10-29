// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../api/backend', () => ({
  updateServer: vi.fn(),
  startActualize: vi.fn(),
  getActualizeStatus: vi.fn(),
}));

import RefreshTokenField from './RefreshTokenField';
import { startActualize } from '../../../api/backend';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

/*
 * La relève partage le seau de cadence du proxy : une préparation hors ligne
 * peut le vider. « Tester » recevait alors un 429 et affichait « Le jeton a
 * été refusé » — un bon jeton déclaré mauvais. Le jeton n'a pas été éprouvé :
 * c'est ce que le message dit désormais.
 */
describe('RefreshTokenField — Tester', () => {
  it('ne déclare pas le jeton refusé quand la cadence a refusé la requête', async () => {
    vi.mocked(startActualize).mockRejectedValue(Object.assign(new Error('429'), { response: { status: 429 } }));
    render(<RefreshTokenField serverId={1} isActive configured onSaved={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'preferences.refresh.test' })); });
    const status = screen.getAllByRole('status').map((s) => s.textContent).join(' ');
    expect(status).toContain('preferences.refresh.testRateLimited');
    expect(status).not.toContain('preferences.refresh.testFail');
  });
});
