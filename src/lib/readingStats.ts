export interface ArticleOpenEvent {
  articleId: string;
  openedAt: number;
  title: string;
  text: string;
  wordCount: number;
}

const SKIM_FACTOR = 0.6;
const WORDS_PER_MINUTE = 230;

export function estimatedSkimMinutes(wordCount: number): number {
  return Math.max(1, Math.round((Math.max(0, wordCount) / WORDS_PER_MINUTE) * SKIM_FACTOR));
}
