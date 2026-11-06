import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// M-08 (1.9.0) : seules trois couches poussaient une entrée d'historique, et
// le retour d'Android fermait l'app sous chaque surface oubliée. Garde-fou
// d'inventaire : toute surface flottante (rendue par portail sous <body>,
// règle de CLAUDE.md) branche `useBackLayer` — elle-même, ou en passant par
// `Popover`, `BottomSheet` ou `ConfirmDialog`, qui le font.

const ROOT = join(__dirname, '..', 'components');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}

describe('Retour Android — inventaire des surfaces flottantes', () => {
  it('chaque fichier qui rend une surface par portail branche useBackLayer (ou ne portalise qu’un Popover)', () => {
    const missing = sources(ROOT).filter((file) => {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('createPortal(')) return false;
      if (src.includes('useBackLayer(')) return false;
      // Chaque portail n'y rend qu'un Popover, qui porte la couche.
      const portals = src.split('createPortal(').slice(1);
      return !portals.every((rest) => /^\s*<Popover\b/.test(rest));
    }).map((f) => f.slice(ROOT.length + 1));
    expect(missing).toEqual([]);
  });

  it('les surfaces partagées portent la couche elles-mêmes', () => {
    for (const f of ['BottomSheet.tsx', 'ConfirmDialog.tsx', 'ReadingPane/Popover.tsx']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toContain('useBackLayer(');
    }
  });
});
