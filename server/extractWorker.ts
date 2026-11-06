// Le worker d'analyse (M-01) : une seule extraction, puis il rend la main.
//
// Lancé par `extractInWorker` (`server/extract.ts`), qui le termine à
// l'échéance. Tout ce qui sort d'ici passe par `WorkerReply` : une instance
// d'erreur ne traverse pas la frontière d'un worker avec sa classe, d'où le
// champ `tooComplex` qui porte la raison d'un refus.
import { parentPort, workerData } from 'node:worker_threads';
import { extractArticle, PageTooComplexError, type WorkerReply } from './extract.js';

const { url, html } = workerData as { url: string; html: string };

let reply: WorkerReply;
try {
  reply = { ok: true, article: extractArticle(url, html) };
} catch (err) {
  reply = err instanceof PageTooComplexError
    ? { ok: false, tooComplex: err.reason, message: err.message }
    : { ok: false, message: err instanceof Error ? err.message : String(err) };
}
parentPort?.postMessage(reply);
