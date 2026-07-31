import { describe, it, expect } from 'vitest';
import { groupLabels } from './labels';
import type { Tag } from '../types';

const tag = (name: string): Tag => ({ id: `user/-/label/${name}` });

describe('groupLabels', () => {
  it('returns an empty list for no labels', () => {
    expect(groupLabels([])).toEqual([]);
  });

  it('lists flat labels as singles, sorted alphabetically', () => {
    const res = groupLabels([tag('Zeta'), tag('Alpha'), tag('Mu')]);
    expect(res.map((i) => [i.type, i.name])).toEqual([
      ['single', 'Alpha'],
      ['single', 'Mu'],
      ['single', 'Zeta'],
    ]);
    expect(res[0].tag).toEqual(tag('Alpha'));
  });

  it('builds a group (prefix with children, no own label)', () => {
    const res = groupLabels([tag('Tech/AI'), tag('Tech/Web')]);
    expect(res).toHaveLength(1);
    const g = res[0];
    expect(g.type).toBe('group');
    expect(g.name).toBe('Tech');
    expect(g.tag).toBeUndefined();
    expect(g.children).toEqual([
      { tag: tag('Tech/AI'), leafName: 'AI', fullName: 'Tech/AI' },
      { tag: tag('Tech/Web'), leafName: 'Web', fullName: 'Tech/Web' },
    ]);
  });

  it('promotes a flat label that shares a prefix name to a parent', () => {
    const res = groupLabels([tag('Tech'), tag('Tech/AI')]);
    expect(res).toHaveLength(1);
    const p = res[0];
    expect(p.type).toBe('parent');
    expect(p.name).toBe('Tech');
    expect(p.tag).toEqual(tag('Tech'));
    expect(p.children).toEqual([
      { tag: tag('Tech/AI'), leafName: 'AI', fullName: 'Tech/AI' },
    ]);
  });

  it('mixes singles, groups and parents in one alphabetical list', () => {
    const res = groupLabels([tag('News'), tag('Tech/AI'), tag('Tech'), tag('Zoo/Cat')]);
    expect(res.map((i) => [i.type, i.name])).toEqual([
      ['single', 'News'],
      ['parent', 'Tech'],
      ['group', 'Zoo'],
    ]);
  });

  it('nested leaf names keep only the first level as the group', () => {
    // "Tech/AI/LLM" groups under "Tech" with the leaf "AI/LLM".
    const res = groupLabels([tag('Tech/AI/LLM')]);
    expect(res[0].type).toBe('group');
    expect(res[0].name).toBe('Tech');
    expect(res[0].children).toEqual([
      { tag: tag('Tech/AI/LLM'), leafName: 'AI/LLM', fullName: 'Tech/AI/LLM' },
    ]);
  });

  it('skips a tag whose label part is empty', () => {
    expect(groupLabels([{ id: 'user/-/label/' }])).toEqual([]);
  });

  it('ignores custom order while sortAlpha is true', () => {
    const res = groupLabels([tag('Alpha'), tag('Zeta')], [tag('Zeta').id, tag('Alpha').id], true);
    expect(res.map((i) => i.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('applies the custom top-level order when sortAlpha is false', () => {
    const res = groupLabels([tag('Alpha'), tag('Zeta')], [tag('Zeta').id, tag('Alpha').id], false);
    expect(res.map((i) => i.name)).toEqual(['Zeta', 'Alpha']);
  });

  it('places labels missing from the custom order last', () => {
    const res = groupLabels([tag('Alpha'), tag('Zeta')], [tag('Zeta').id], false);
    expect(res.map((i) => i.name)).toEqual(['Zeta', 'Alpha']);
  });

  it('applies the custom order to children within a group', () => {
    const res = groupLabels(
      [tag('Tech/AI'), tag('Tech/Web')],
      [tag('Tech/Web').id, tag('Tech/AI').id],
      false,
    );
    expect(res[0].children!.map((c) => c.leafName)).toEqual(['Web', 'AI']);
  });
});
