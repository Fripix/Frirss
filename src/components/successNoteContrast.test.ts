// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SHIPPED_THEMES } from '../stores/themeStore';
import { contrastRatio } from '../lib/readableText';

/*
 * Les messages de réussite (« Enregistré », « FreshRSS a accepté ces
 * identifiants… ») s'écrivaient en couleur d'accent : #4cd4a1 sur le panneau
 * clair, 1,8:1. `.success-note` mêle l'accent au texte du thème.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../styles/index.css'), 'utf8');

function mix(a: string, b: string, wA: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v * wA + y[i] * (1 - wA)).toString(16).padStart(2, '0')).join('');
}

describe('messages de réussite lisibles', () => {
  const rule = css.match(/\.success-note\s*\{([^}]*)\}/)?.[1] ?? '';
  const weight = Number(rule.match(/var\(--accent\)\s+(\d+)%/)?.[1]) / 100;

  it('mêle l’accent au texte du thème', () => {
    expect(rule).toMatch(/color-mix\(in srgb, var\(--accent\) \d+%, var\(--list-title\)\)/);
  });

  it('atteint 4,5:1 sur les panneaux de chaque thème livré', () => {
    for (const th of SHIPPED_THEMES) {
      const c = th.colors as Record<string, string>;
      const ink = mix(c['accent'], c['list-title'], weight);
      for (const bg of ['panel-bg', 'panel-header-bg']) {
        expect(contrastRatio(ink, c[bg]), `${th.name} sur ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('plus aucun message de réussite écrit en accent brut', () => {
    for (const f of ['Preferences/servers/ServerCredentialsForm.tsx', 'Preferences/servers/RefreshTokenField.tsx', 'Preferences/AccountSection.tsx', 'Preferences/ai/KeysBlock.tsx', 'Preferences/ai/AdminProviders.tsx', 'backup/RestoreFlow.tsx']) {
      const src = fs.readFileSync(path.resolve(__dirname, f), 'utf8');
      expect(src, f).toContain('success-note');
    }
  });
});
