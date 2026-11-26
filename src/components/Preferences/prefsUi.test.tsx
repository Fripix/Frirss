// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PrefHeading } from './prefsUi';

afterEach(cleanup);

describe('PrefHeading — action sur la ligne du titre', () => {
  // En allemand, « KI aktivieren (Zusammenfassungen und Übersetzungen) » et
  // son interrupteur ne tenaient pas sur 320-375 px : l'action, interdite de
  // rétrécir, poussait l'interrupteur hors de l'écran (campagne 1.10.1, M5).
  // Une action courte garde sa largeur : le passage à la ligne d'une rangée
  // `flex-wrap` se décide sur la largeur naturelle, pas sur la largeur rétrécie.
  it('l’action peut rétrécir sous la largeur de son texte', () => {
    const c = render(<PrefHeading action={<button type="button">Tout réafficher</button>}>Titre</PrefHeading>);
    const wrap = c.getByRole('button', { name: 'Tout réafficher' }).parentElement as HTMLElement;
    expect(wrap.classList.contains('flex-shrink-0')).toBe(false);
    expect(wrap.classList.contains('min-w-0')).toBe(true);
    expect(wrap.parentElement?.classList.contains('flex-wrap')).toBe(true);
  });
});
