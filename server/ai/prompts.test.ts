import { describe, it, expect } from 'vitest';
import { PROMPT_VERSION, SUMMARY_SYSTEM, summaryUserMessage } from './prompts.js';

describe('summary prompt', () => {
  it('is at version 2', () => {
    expect(PROMPT_VERSION).toBe(2);
  });
  it('tells the model the article is data and the output is plain text', () => {
    const s = SUMMARY_SYSTEM.toLowerCase();
    for (const needle of ['<article>', 'lang:', 'plain text', 'no markdown']) expect(s).toContain(needle);
  });
  it('wraps the article between tags', () => {
    expect(summaryUserMessage('T', 'corps')).toBe('<article>\nTitle: T\n\ncorps\n</article>');
  });
});
