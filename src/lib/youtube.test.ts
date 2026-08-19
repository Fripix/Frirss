import { describe, it, expect } from 'vitest';
import { extractYouTubeId, youtubeThumbnail, injectVideoFacades } from './youtube';

describe('extractYouTubeId', () => {
  it('reads the watch form', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the short form', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the embed form', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the shorts form', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the nocookie form', () => {
    expect(extractYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('keeps other query parameters out of the id', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('preserves a start time in seconds', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=90')).toEqual({ id: 'dQw4w9WgXcQ', start: 90 });
  });
  it('preserves a start time written as 1m30s', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toEqual({ id: 'dQw4w9WgXcQ', start: 90 });
  });
  it('accepts the start parameter', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ?start=42')).toEqual({ id: 'dQw4w9WgXcQ', start: 42 });
  });
  it('rejects non-YouTube urls', () => {
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull();
    expect(extractYouTubeId('https://example.com/watch?v=abc')).toBeNull();
  });
  it('rejects a YouTube url without a video', () => {
    expect(extractYouTubeId('https://www.youtube.com/@channel')).toBeNull();
  });
  it('handles empty input', () => {
    expect(extractYouTubeId('')).toBeNull();
  });
});

describe('youtubeThumbnail', () => {
  it('builds the standard thumbnail url', () => {
    expect(youtubeThumbnail('abc123')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  });
});

describe('injectVideoFacades', () => {
  it('replaces a YouTube iframe with facade markup', () => {
    const { html, ids } = injectVideoFacades('<p>a</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
    expect(ids).toEqual(['dQw4w9WgXcQ']);
    expect(html).toContain('data-yt-id="dQw4w9WgXcQ"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<p>a</p>');
  });

  it('replaces a standalone YouTube link', () => {
    const { html, ids } = injectVideoFacades('<p><a href="https://youtu.be/dQw4w9WgXcQ">Voir</a></p>');
    expect(ids).toEqual(['dQw4w9WgXcQ']);
    expect(html).toContain('data-yt-id="dQw4w9WgXcQ"');
  });

  it('carries the start time into the facade', () => {
    const { html } = injectVideoFacades('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=42"></iframe>');
    expect(html).toContain('data-yt-start="42"');
  });

  it('leaves non-YouTube iframes untouched', () => {
    const src = '<iframe src="https://player.vimeo.com/video/1"></iframe>';
    expect(injectVideoFacades(src).html).toBe(src);
  });

  it('leaves ordinary links untouched', () => {
    const src = '<p><a href="https://example.com/article">lire</a></p>';
    expect(injectVideoFacades(src).html).toBe(src);
  });

  it('reports each video once even when repeated', () => {
    const { ids } = injectVideoFacades(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><a href="https://youtu.be/dQw4w9WgXcQ">x</a>',
    );
    expect(ids).toEqual(['dQw4w9WgXcQ']);
  });

  it('returns the html untouched when there is no video', () => {
    expect(injectVideoFacades('<p>rien</p>')).toEqual({ html: '<p>rien</p>', ids: [] });
  });

  it('handles empty input', () => {
    expect(injectVideoFacades('')).toEqual({ html: '', ids: [] });
  });
});
