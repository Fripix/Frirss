/**
 * Processus enfant de `compare.mts` : charge UNE version de `extract.ts`
 * (chemin en argument) et extrait les pages qu'on lui envoie, une à la fois.
 * Un processus par version isole les deux arbres de modules ; le parent tue ce
 * processus si une page dépasse son délai.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type Extract = (url: string, html: string) => unknown;

interface Task {
  id: number;
  url: string;
  file: string;
}

const send = (msg: unknown, then?: () => void) => process.send?.(msg, undefined, {}, () => then?.());

const modPath = process.argv[2];
let extract!: Extract;
try {
  const mod = (await import(pathToFileURL(modPath).href)) as { extractArticle?: Extract };
  if (typeof mod.extractArticle !== 'function') throw new Error(`${modPath} n'exporte pas extractArticle`);
  extract = mod.extractArticle;
} catch (err) {
  send({ type: 'fatal', error: String((err as Error)?.stack ?? err) }, () => process.exit(1));
  await new Promise(() => {});
}

process.on('disconnect', () => process.exit(0));
process.on('message', async (task: Task) => {
  const t0 = performance.now();
  try {
    const html = readFileSync(task.file, 'utf8');
    const r = (await extract(task.url, html)) as { title?: unknown; content?: unknown } | null;
    const result = r ? { title: String(r.title ?? ''), content: String(r.content ?? '') } : null;
    send({ type: 'result', id: task.id, result, ms: performance.now() - t0 });
  } catch (err) {
    send({ type: 'result', id: task.id, error: String((err as Error)?.message ?? err), ms: performance.now() - t0 });
  }
});
send({ type: 'ready' });
