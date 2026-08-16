// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { isFocusToggleTarget } from './readingFocus';

beforeEach(() => {
  document.body.innerHTML = `
    <div class="reading-pane">
      <div class="reading-toolbar"><button id="btn">x</button><span id="tb">meta</span></div>
      <h1 id="title">Title</h1>
      <div class="article-content"><p id="p">hello <a id="lnk">link</a></p></div>
      <div id="margin"></div>
    </div>`;
});

const $ = (id: string) => document.getElementById(id);

describe('isFocusToggleTarget', () => {
  it('toggles on neutral header/margin areas', () => {
    expect(isFocusToggleTarget($('tb'))).toBe(true);   // toolbar meta text
    expect(isFocusToggleTarget($('title'))).toBe(true); // article title (header)
    expect(isFocusToggleTarget($('margin'))).toBe(true);
  });

  it('does not toggle on the article body (preserve text selection)', () => {
    expect(isFocusToggleTarget($('p'))).toBe(false);
    expect(isFocusToggleTarget($('lnk'))).toBe(false);
  });

  it('does not toggle on interactive controls', () => {
    expect(isFocusToggleTarget($('btn'))).toBe(false);
  });

  it('is safe on null', () => {
    expect(isFocusToggleTarget(null)).toBe(false);
  });
});
