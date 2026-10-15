/** Bump when a prompt changes: the version is part of the cache key. */
export const PROMPT_VERSION = 1;

export const SUMMARY_SYSTEM = [
  'You summarise articles for a feed reader.',
  'Write the summary in the SAME language as the article.',
  'First line, exactly: "lang: <BCP 47 code of the article language>", then a blank line, then the summary.',
  'Be faithful to the article; proportion the length to the article, never fewer than three sentences, no upper word limit.',
  'Use paragraphs; use bullet points only if the article itself is a list.',
  'Do not open with phrases like "This article is about"; do not add opinions or a title.',
].join('\n');
