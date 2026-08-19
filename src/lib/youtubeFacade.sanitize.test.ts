// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { facadeMarkup, injectVideoFacades } from './youtube';
import { sanitizeHtml } from '../utils/sanitizeHtml';

/**
 * The load-bearing invariant of the whole feature: whatever the facade is built
 * from must survive DOMPurify. This has bitten twice — <iframe> is stripped
 * (that is the bug being fixed) and so is <svg> (which silently emptied the
 * play button). Anything added to the facade must keep these green.
 */
describe('facade survives sanitisation', () => {
  const L = { play: 'Lire', open: 'Ouvrir sur YouTube' };
  const clean = sanitizeHtml(facadeMarkup({ id: 'dQw4w9WgXcQ', start: 42 }, 'https://x/t.jpg', L));

  it('keeps the container and its video id', () => {
    expect(clean).toContain('class="yt-facade"');
    expect(clean).toContain('data-yt-id="dQw4w9WgXcQ"');
  });

  it('keeps the start time', () => {
    expect(clean).toContain('data-yt-start="42"');
  });

  it('keeps the thumbnail', () => {
    expect(clean).toContain('class="yt-facade__thumb"');
    expect(clean).toContain('src="https://x/t.jpg"');
  });

  it('keeps the play button and its label', () => {
    expect(clean).toContain('class="yt-facade__play"');
    expect(clean).toContain('aria-label="Lire"');
  });

  it('keeps the escape hatch to YouTube', () => {
    expect(clean).toContain('class="yt-facade__link"');
    expect(clean).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=42s"');
    expect(clean).toContain('Ouvrir sur YouTube');
  });

  it('uses no element the sanitizer would drop', () => {
    // Round-tripping must not lose anything.
    expect(sanitizeHtml(clean)).toBe(clean);
  });
});

describe('embedded videos survive the pipeline', () => {
  it('turns a stripped-away iframe into a visible facade', () => {
    const blog = '<p>Intro</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><p>Suite</p>';

    // Today, without the injection, the video vanishes without a trace.
    expect(sanitizeHtml(blog)).not.toContain('iframe');
    expect(sanitizeHtml(blog)).not.toContain('dQw4w9WgXcQ');

    const fixed = sanitizeHtml(injectVideoFacades(blog, { play: 'Lire', open: 'Ouvrir sur YouTube' }).html);
    expect(fixed).toContain('data-yt-id="dQw4w9WgXcQ"');
    expect(fixed).toContain('Intro');
    expect(fixed).toContain('Suite');
    expect(fixed).not.toContain('<iframe');
  });
});
