import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const backend = axios.create({ baseURL: '/api/reading-stats', headers: { 'Content-Type': 'application/json' } });
backend.interceptors.request.use((config) => {
  const token = useAuthStore.getState().backendToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface ArticleOpenEvent {
  articleId: string;
  openedAt: number;
  title: string;
  text: string;
  wordCount: number;
}

function plainText(value: string): string {
  return (value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function recordArticleOpen(
  serverId: string | number | null | undefined,
  article: { id: string; title?: string; content?: string; summary?: string },
): Promise<void> {
  const id = Number(serverId);
  if (!Number.isSafeInteger(id) || id < 1 || !article?.id) return;
  try {
    const title = plainText(article.title || '').slice(0, 1000);
    const body = plainText(article.content || article.summary || '');
    const text = [title, plainText(article.summary || ''), body.slice(0, 900)].filter(Boolean).join(' ').slice(0, 4000);
    const wordCount = (body || title).split(/\\s+/).filter(Boolean).length;
    await backend.post('/open', { serverId: id, articleId: String(article.id), title, text, wordCount });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('frirss:reading-stats-updated'));
  } catch {
    // Stats are best-effort; recording must never delay or break article reading.
  }
}

export async function getArticleOpenEvents(serverId: string | number | null | undefined): Promise<ArticleOpenEvent[]> {
  const id = Number(serverId);
  if (!Number.isSafeInteger(id) || id < 1) return [];
  const { data } = await backend.get<{ events: ArticleOpenEvent[] }>('/', { params: { serverId: id } });
  return Array.isArray(data.events) ? data.events : [];
}
