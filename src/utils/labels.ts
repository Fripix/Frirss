import type { Tag } from '../types';

// FreshRSS tags are flat ids like `user/-/label/Parent/Child`. This module
// turns that flat list into the sidebar's tree of single labels, groups
// (a prefix with children but no own tag), and parents (a prefix that is
// itself a label AND has children).

export interface LabelChild {
  tag: Tag;
  leafName: string;
  fullName: string;
}

export interface LabelItem {
  type: 'single' | 'parent' | 'group';
  tag?: Tag;
  name: string;
  children?: LabelChild[];
}

export function groupLabels(
  labels: Tag[],
  labelOrder: string[] = [],
  sortAlpha = true,
): LabelItem[] {
  const childrenByPrefix: Record<string, LabelChild[]> = {};
  const flatByName: Record<string, { tag: Tag; name: string }> = {};

  labels.forEach((tag) => {
    const fullName = tag.id.split('/label/').pop();
    if (!fullName) return;
    const slashIdx = fullName.indexOf('/');
    if (slashIdx > 0) {
      const prefix = fullName.substring(0, slashIdx);
      if (!childrenByPrefix[prefix]) childrenByPrefix[prefix] = [];
      childrenByPrefix[prefix].push({ tag, leafName: fullName.substring(slashIdx + 1), fullName });
    } else {
      flatByName[fullName] = { tag, name: fullName };
    }
  });

  const result: LabelItem[] = [];

  // Build merged list: flat labels that match a group prefix become parents
  const allNames = new Set([...Object.keys(flatByName), ...Object.keys(childrenByPrefix)]);
  const sorted = [...allNames].sort();

  sorted.forEach((name) => {
    const flat = flatByName[name];
    const children = childrenByPrefix[name];

    if (flat && children) {
      result.push({ type: 'parent', tag: flat.tag, name: flat.name, children });
    } else if (children) {
      result.push({ type: 'group', name, children });
    } else if (flat) {
      result.push({ type: 'single', tag: flat.tag, name: flat.name });
    }
  });

  // Apply custom ordering if not alphabetical and order exists
  if (!sortAlpha && labelOrder.length > 0) {
    // Sort top-level items by position of their first label ID in labelOrder
    result.sort((a, b) => {
      const aId = a.tag?.id || a.children?.[0]?.tag.id || '';
      const bId = b.tag?.id || b.children?.[0]?.tag.id || '';
      const ai = labelOrder.indexOf(aId);
      const bi = labelOrder.indexOf(bId);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    // Sort children within groups
    result.forEach((item) => {
      if (item.children) {
        item.children.sort((a, b) => {
          const ai = labelOrder.indexOf(a.tag.id);
          const bi = labelOrder.indexOf(b.tag.id);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }
    });
  }

  return result;
}
