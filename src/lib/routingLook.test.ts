import { describe, it, expect } from 'vitest';
import { nextRoutingValue, toggleLook } from './routingLook';

describe('nextRoutingValue — un clic, l\'état suivant', () => {
  it('follows « désactivé → activé → hérité »', () => {
    expect(nextRoutingValue('off')).toBe(true);
    expect(nextRoutingValue('on')).toBe(null);
  });
  it('from « hérité », always changes what applies: off under an inherited on, on under an inherited off', () => {
    expect(nextRoutingValue('inherited')).toBe(false);
    expect(nextRoutingValue('inheritedOff')).toBe(true);
  });
});

describe('toggleLook — quatre aspects', () => {
  it('fills what is set here (green on, grey off) and outlines what is inherited (green on, grey off)', () => {
    expect(toggleLook('on')).toMatchObject({ background: 'var(--accent)', color: 'var(--on-accent)' });
    expect(toggleLook('off')).toMatchObject({ background: 'var(--panel-border)', color: 'var(--list-summary)' });
    expect(toggleLook('inherited')).toMatchObject({ background: 'transparent', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' });
    expect(toggleLook('inheritedOff')).toMatchObject({ background: 'transparent', color: 'var(--list-summary)', boxShadow: 'inset 0 0 0 1px var(--panel-border)' });
  });
});
