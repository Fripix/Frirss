import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { useAuthStore } from '../stores/authStore';

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
}

/**
 * Fetch the full article content from its original URL,
 * parse it with Mozilla Readability, and sanitize with DOMPurify.
 *
 * Returns { title, content, excerpt, byline, siteName, length } or throws.
 */
export async function extractFullContent(url: string): Promise<ExtractedContent> {
  // Fetch through the same-origin backend proxy (avoids CORS; the target is
  // passed in a header, auth via the FriRSS JWT).
  const { backendToken } = useAuthStore.getState();
  const response = await fetch('/api/proxy', {
    headers: {
      'X-Proxy-Target': url,
      'X-Proxy-Accept': 'text/html',
      ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  // Parse into a DOM document that Readability can work with
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Resolve relative URLs in the parsed document
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  // Extract readable content
  const reader = new Readability(doc, {
    charThreshold: 50,
  });
  const result = reader.parse();

  if (!result || !result.content) {
    throw new Error('NO_CONTENT');
  }

  // Sanitize the HTML
  const cleanContent = DOMPurify.sanitize(result.content, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'src'],
    ALLOW_DATA_ATTR: false,
  });

  return {
    title: result.title || '',
    content: cleanContent,
    excerpt: result.excerpt || '',
    byline: result.byline || '',
    siteName: result.siteName || '',
    length: result.length || 0,
  };
}
