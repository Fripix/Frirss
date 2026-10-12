import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const backend = axios.create({ baseURL: '/api/intelligence', headers: { 'Content-Type': 'application/json' } });
backend.interceptors.request.use((config) => {
  const token = useAuthStore.getState().backendToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface ArticleFeedback {
  articleId: string;
  url: string;
  title: string;
  summary: string;
  content: string;
  sourceId: string;
  vote: 1 | -1;
  createdAt?: string;
  updatedAt?: string;
}

export async function getArticleFeedback(): Promise<ArticleFeedback[]> {
  const { data } = await backend.get<{ feedback: ArticleFeedback[] }>('/feedback');
  return data.feedback;
}

export async function setArticleFeedback(
  feedback: Omit<ArticleFeedback, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  await backend.put('/feedback', feedback);
}

export async function removeArticleFeedback(articleId: string): Promise<void> {
  await backend.delete(`/feedback/${encodeURIComponent(articleId)}`);
}
