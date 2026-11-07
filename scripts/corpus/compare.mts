/**
 * Compare l'extraction de deux versions de `server/extract.ts` sur un corpus
 * de pages capturées (`capture.mts`). Mode d'emploi : `scripts/corpus/README.md`.
 *
 *   npx tsx scripts/corpus/compare.mts --corpus <dossier> --base <ref|chemin> --head <ref|chemin>
 *     [--accepted <fichier>] [--report <fichier.json>] [--only <motif>] [--jobs N] [--timeout ms] [--oracle-strict]
 *
 * Code de sortie : 1 s'il existe une perte non acceptée, un `null` nouveau ou
 * une image perdue, ou si la tête manque une phrase du flux que la base rendait
 * (avec `--oracle-strict` : une phrase du flux tout court) ; 0 sinon ; 2 si
 * l'outil lui-même échoue.
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareExtracts,
  compileAccepted,
  comparablePages,
  hostOf,
  parseAccepted,
  parseArgs,
  parseIndex,
  type ExtractLike,
  type IndexEntry,
  type PageDiff,
} from './lib.ts';
import { buildFeedOracle, judgeOracle, takeFlag, type OracleVerdict } from './feedOracle.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, 'extract-worker.mts');

type Outcome =
  | { kind: 'ok'; result: ExtractLike | null; ms: number }
  | { kind: 'error'; message: string; ms: number }
  | { kind: 'timeout'; ms: number };

interface Side {
  spec: string;
  sha?: string;
  modPath: string;
  cleanup?: () => void;
}

// ── Versions comparées ─────────────────────────────────────────────────

function repoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE, encoding: 'utf8' }).trim();
}

/** Une ref git est extraite (`server` + `package.json`) ; un chemin est pris tel quel. */
function resolveSide(spec: string, root: string): Side {
  if (existsSync(spec)) {
    const abs = path.resolve(spec);
    if (statSync(abs).isFile()) return { spec, modPath: abs };
    for (const candidate of [path.join(abs, 'server', 'extract.ts'), path.join(abs, 'extract.ts')]) {
      if (existsSync(candidate)) return { spec, modPath: candidate };
    }
    throw new Error(`${spec} : aucun extract.ts dans ce dossier`);
  }
  let sha: string;
  try {
    sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${spec}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(`${spec} : ni un chemin existant ni une ref git`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), `frirss-corpus-${sha.slice(0, 8)}-`));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const tar = path.join(dir, 'tree.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha, 'server', 'package.json'], { cwd: root });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar);
    symlinkSync(realpathSync(path.join(root, 'node_modules')), path.join(dir, 'node_modules'), 'dir');
    const modPath = path.join(dir, 'server', 'extract.ts');
    if (!existsSync(modPath)) throw new Error(`${spec} : pas de server/extract.ts à cette ref`);
    return { spec, sha, modPath, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

// ── Processus d'extraction ─────────────────────────────────────────────

interface Slot {
  child: ChildProcess;
  ready: Promise<void>;
  busy: boolean;
}

/** Un groupe de processus enfants qui chargent une même version d'`extract.ts`. */
class ExtractPool {
  private slots: Slot[] = [];
  private queue: { url: string; file: string; resolve: (o: Outcome) => void; reject: (e: Error) => void }[] = [];
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly modPath: string,
    size: number,
    private readonly timeoutMs: number,
  ) {
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    // `npx tsx` lance Node avec son chargeur dans `execArgv` ; sinon on le pose.
    const execArgv = process.execArgv.some((a) => a.includes('tsx'))
      ? process.execArgv
      : ['--import', import.meta.resolve('tsx')];
    const child = fork(WORKER, [this.modPath], { execArgv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const ready = new Promise<void>((resolve, reject) => {
      const onMessage = (msg: { type: string; error?: string }) => {
        if (msg.type === 'ready') {
          child.off('message', onMessage);
          resolve();
        } else if (msg.type === 'fatal') {
          child.off('message', onMessage);
          reject(new Error(`chargement de ${this.modPath} impossible :\n${msg.error}`));
        }
      };
      child.on('message', onMessage);
      child.once('exit', (code) => reject(new Error(`processus d'extraction arrêté (code ${code}) :\n${stderr}`)));
    });
    ready.catch(() => {});
    return { child, ready, busy: false };
  }

  run(url: string, file: string): Promise<Outcome> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, file, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy || !this.queue.length || this.closed) continue;
      const task = this.queue.shift()!;
      slot.busy = true;
      this.execute(slot, task.url, task.file).then(
        (o) => {
          slot.busy = false;
          task.resolve(o);
          this.pump();
        },
        (e: Error) => {
          slot.busy = false;
          task.reject(e);
        },
      );
    }
  }

  private async execute(slot: Slot, url: string, file: string): Promise<Outcome> {
    await slot.ready; // un échec de chargement remonte : l'outil échoue (code 2)
    const id = this.nextId++;
    const t0 = performance.now();
    return new Promise<Outcome>((resolve) => {
      const done = (o: Outcome, replace: boolean) => {
        clearTimeout(timer);
        slot.child.off('message', onMessage);
        slot.child.off('exit', onExit);
        if (replace) {
          slot.child.kill('SIGKILL');
          Object.assign(slot, this.spawn());
          slot.busy = true;
        }
        resolve(o);
      };
      const onMessage = (msg: { type: string; id?: number; result?: ExtractLike | null; error?: string; ms?: number }) => {
        if (msg.type !== 'result' || msg.id !== id) return;
        if (msg.error !== undefined) done({ kind: 'error', message: msg.error, ms: msg.ms ?? 0 }, false);
        else done({ kind: 'ok', result: msg.result ?? null, ms: msg.ms ?? 0 }, false);
      };
      const onExit = (code: number | null, signal: string | null) =>
        done({ kind: 'error', message: `processus arrêté (${signal ?? code})`, ms: performance.now() - t0 }, true);
      const timer = setTimeout(() => done({ kind: 'timeout', ms: performance.now() - t0 }, true), this.timeoutMs);
      slot.child.on('message', onMessage);
      slot.child.once('exit', onExit);
      slot.child.send({ id, url, file });
    });
  }

  close(): void {
    this.closed = true;
    for (const s of this.slots) s.child.kill('SIGKILL');
  }
}

// ── Rapport ────────────────────────────────────────────────────────────

interface PageReport {
  file: string;
  url: string;
  host: string;
  base: { kind: Outcome['kind']; ms: number; length: number | null; title: string | null; error?: string };
  head: { kind: Outcome['kind']; ms: number; length: number | null; title: string | null; error?: string };
  /** `ok` = comparé ; `timeout` = délai d'un côté ; `error` = exception d'un côté. */
  verdict: 'ok' | 'timeout' | 'error';
  /** Exception nouvelle en tête alors que la base extrayait : compte comme un échec. */
  newError: boolean;
  diff: PageDiff | null;
  /** Mesure contre le contenu du flux (`feedFile`), absente sans contenu de flux. */
  oracle?: OracleReport;
}

interface OracleReport {
  feedFile: string;
  /** Phrases et fragments du flux que l'extrait doit contenir. */
  sentences: number;
  fragments: number;
  /** Écartés : fins de flux, retraits acceptés, absents de la page. */
  trailers: number;
  accepted: number;
  offPage: number;
  verdict: OracleVerdict;
}

const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function summarizeOutcome(o: Outcome): PageReport['base'] {
  if (o.kind === 'ok') {
    return { kind: o.kind, ms: Math.round(o.ms), length: o.result ? o.result.content.length : null, title: o.result?.title ?? null };
  }
  return { kind: o.kind, ms: Math.round(o.ms), length: null, title: null, ...(o.kind === 'error' ? { error: o.message } : {}) };
}

function printPage(p: PageReport): void {
  const d = p.diff;
  const lines: string[] = [];
  const len = d ? `${d.baseLength} → ${d.headLength} car.${d.baseLength ? ` (${Math.round(((d.headLength - d.baseLength) / d.baseLength) * 100)} %)` : ''}` : '';
  lines.push(`── ${p.host || '?'}  ${p.file}  ${len}`);
  lines.push(`   ${p.url}`);
  if (p.verdict === 'timeout') {
    lines.push(`   DÉLAI : base ${p.base.error ?? p.base.kind}, tête ${p.head.error ?? p.head.kind}`);
  }
  if (p.verdict === 'error') {
    lines.push(`   ERREUR${p.newError ? ' NOUVELLE' : ''} : base ${p.base.error ?? p.base.kind}, tête ${p.head.error ?? p.head.kind}`);
  }
  if (d) {
    if (d.newNull) lines.push('   NULL NOUVEAU : la base extrayait, la tête rend null');
    if (d.baseNull && !d.headNull) lines.push('   la base rendait null, la tête extrait');
    for (const s of d.lost) lines.push(`   PERTE   « ${clip(s)} »`);
    if (d.lostFragments.length) lines.push(`   FRAGMENTS « ${clip(d.lostFragments.join(' · '))} »`);
    for (const s of d.lostImages) lines.push(`   IMAGE   ${clip(s)}`);
    const tally = [
      `perdues ${d.lost.length}`,
      `acceptées ${d.accepted.length + d.acceptedImages.length}`,
      `gagnées ${d.gained.length}`,
      `images perdues ${d.lostImages.length}`,
      `doublons ${d.duplicated.length}`,
    ];
    if (d.lengthDrop) tally.push('chute > 20 %');
    lines.push(`   ${tally.join(' · ')}`);
    for (const s of d.duplicated) lines.push(`   doublon « ${clip(s)} »`);
    if (d.titleChanged) lines.push(`   titre : « ${clip(d.titleChanged.base, 80)} » → « ${clip(d.titleChanged.head, 80)} »`);
  }
  console.log(lines.join('\n'));
}

// ── Programme ──────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const strictFlag = takeFlag(process.argv.slice(2), 'oracle-strict');
  const args = parseArgs(strictFlag.argv);
  const oracleStrict = strictFlag.present;
  for (const key of ['corpus', 'base', 'head']) if (!args[key]) throw new Error(`--${key} est obligatoire`);
  const corpus = path.resolve(args.corpus);
  const jobs = Math.max(1, Number(args.jobs) || Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))));
  const timeoutMs = Math.max(1000, Number(args.timeout) || 15_000);
  const accepted = compileAccepted(args.accepted ? parseAccepted(readFileSync(args.accepted, 'utf8')) : []);

  const { entries, errors } = parseIndex(readFileSync(path.join(corpus, 'index.jsonl'), 'utf8'));
  for (const e of errors) console.error(`index.jsonl:${e.line} ignorée : ${e.message}`);
  let pages: IndexEntry[] = comparablePages(entries).filter((e) => existsSync(path.join(corpus, 'pages', e.file!)));
  if (args.only) {
    const motif = args.only.toLowerCase();
    pages = pages.filter((e) => [e.url, e.finalUrl ?? '', e.file!].some((v) => v.toLowerCase().includes(motif)));
  }
  if (!pages.length) throw new Error('aucune page à comparer');

  const root = repoRoot();
  const sides: Side[] = [];
  const pools: ExtractPool[] = [];
  const stop = () => {
    for (const p of pools) p.close();
    for (const s of sides) s.cleanup?.();
  };
  process.once('SIGINT', () => {
    stop();
    process.exit(2);
  });

  const t0 = performance.now();
  try {
    sides.push(resolveSide(args.base, root), resolveSide(args.head, root));
    const [base, head] = sides;
    console.log(`base : ${base.spec}${base.sha ? ` (${base.sha.slice(0, 7)})` : ''}`);
    console.log(`tête : ${head.spec}${head.sha ? ` (${head.sha.slice(0, 7)})` : ''}`);
    console.log(`${pages.length} pages, ${jobs} processus par version, délai ${timeoutMs / 1000} s\n`);
    const basePool = new ExtractPool(base.modPath, jobs, timeoutMs);
    const headPool = new ExtractPool(head.modPath, jobs, timeoutMs);
    pools.push(basePool, headPool);

    const reports = await Promise.all(
      pages.map(async (e): Promise<PageReport> => {
        const url = e.finalUrl ?? e.url;
        const file = path.join(corpus, 'pages', e.file!);
        const [b, h] = await Promise.all([basePool.run(url, file), headPool.run(url, file)]);
        const report: PageReport = {
          file: e.file!,
          url,
          host: hostOf(url),
          base: summarizeOutcome(b),
          head: summarizeOutcome(h),
          verdict: 'ok',
          newError: false,
          diff: null,
        };
        const feedFile = (e as IndexEntry & { feedFile?: string }).feedFile;
        if (feedFile && existsSync(path.join(corpus, 'feed', feedFile))) {
          const oracle = buildFeedOracle(
            readFileSync(path.join(corpus, 'feed', feedFile), 'utf8'),
            report.host,
            accepted,
            readFileSync(file, 'utf8'),
          );
          report.oracle = {
            feedFile,
            sentences: oracle.sentences.length,
            fragments: oracle.fragments.length,
            trailers: oracle.trailers.length,
            accepted: oracle.accepted.length,
            offPage: oracle.offPage.length,
            verdict: judgeOracle(oracle, b.kind === 'ok' ? b.result : undefined, h.kind === 'ok' ? h.result : undefined),
          };
        }
        if (b.kind === 'timeout' || h.kind === 'timeout') report.verdict = 'timeout';
        else if (b.kind === 'error' || h.kind === 'error') {
          report.verdict = 'error';
          report.newError = b.kind === 'ok' && b.result !== null && h.kind === 'error';
        } else if (b.kind === 'ok' && h.kind === 'ok') {
          report.diff = compareExtracts(b.result, h.result, report.host, accepted);
        }
        return report;
      }),
    );
    const durationMs = performance.now() - t0;

    const shown = reports.filter((r) => r.verdict !== 'ok' || r.diff?.changed);
    shown.sort((a, b) => Number(isFailing(b)) - Number(isFailing(a)) || a.host.localeCompare(b.host));
    for (const r of shown) printPage(r);

    const totals = {
      pages: reports.length,
      changed: shown.length,
      failing: reports.filter(isFailing).length,
      lostSentences: sum(reports, (r) => r.diff?.lost.length ?? 0),
      lostFragments: sum(reports, (r) => r.diff?.lostFragments.length ?? 0),
      acceptedSentences: sum(reports, (r) => r.diff?.accepted.length ?? 0),
      gainedSentences: sum(reports, (r) => r.diff?.gained.length ?? 0),
      lostImages: sum(reports, (r) => r.diff?.lostImages.length ?? 0),
      newNull: reports.filter((r) => r.diff?.newNull).length,
      newErrors: reports.filter((r) => r.newError).length,
      duplicated: sum(reports, (r) => r.diff?.duplicated.length ?? 0),
      lengthDrops: reports.filter((r) => r.diff?.lengthDrop).length,
      titleChanges: reports.filter((r) => r.diff?.titleChanged).length,
      timeouts: reports.filter((r) => r.verdict === 'timeout').length,
      errors: reports.filter((r) => r.verdict === 'error').length,
    };
    console.log(
      `\n${totals.pages} pages · ${totals.changed} changent · ${totals.failing} en échec` +
        ` · phrases perdues ${totals.lostSentences}, fragments perdus ${totals.lostFragments}, acceptées ${totals.acceptedSentences}, gagnées ${totals.gainedSentences}` +
        ` · images perdues ${totals.lostImages} · null nouveaux ${totals.newNull} · erreurs nouvelles ${totals.newErrors}` +
        ` · doublons ${totals.duplicated} · chutes > 20 % ${totals.lengthDrops} · titres changés ${totals.titleChanges}` +
        ` · délais ${totals.timeouts} · erreurs ${totals.errors} · ${(durationMs / 1000).toFixed(1)} s`,
    );

    const oracleTotals = printOracle(reports, oracleStrict);

    if (args.report) {
      const full = {
        corpus,
        base: { spec: base.spec, sha: base.sha ?? null, modPath: base.sha ? null : base.modPath },
        head: { spec: head.spec, sha: head.sha ?? null, modPath: head.sha ? null : head.modPath },
        accepted: args.accepted ?? null,
        finishedAt: new Date().toISOString(),
        durationMs: Math.round(durationMs),
        totals: { ...totals, oracle: oracleTotals },
        oracleStrict,
        pages: reports,
      };
      writeFileSync(args.report, JSON.stringify(full, null, 2) + '\n');
      console.log(`rapport : ${path.resolve(args.report)}`);
    }
    return totals.failing > 0 || oracleTotals.failingPages > 0 ? 1 : 0;
  } finally {
    stop();
  }
}

// ── Oracle du flux ─────────────────────────────────────────────────────

const ORACLE_EXAMPLES = 5;

/** Détail par page puis lignes de synthèse de l'oracle du flux ; rend les totaux. */
function printOracle(reports: PageReport[], strict: boolean) {
  const covered = reports.filter((r) => r.oracle && r.oracle.sentences + r.oracle.fragments > 0);
  const failingOf = (r: PageReport) => !!r.oracle && (r.oracle.verdict.failing || (strict && r.oracle.verdict.strictFailing));
  const side = (pick: (v: OracleVerdict) => OracleVerdict['base']) => {
    const measured = covered.filter((r) => pick(r.oracle!.verdict));
    return {
      measured: measured.length,
      incomplete: measured.filter((r) => pick(r.oracle!.verdict)!.missing.length > 0).length,
      missing: sum(measured, (r) => pick(r.oracle!.verdict)!.missing.length),
      missingFragments: sum(measured, (r) => pick(r.oracle!.verdict)!.missingFragments.length),
    };
  };
  const totals = {
    withFeed: reports.filter((r) => r.oracle).length,
    covered: covered.length,
    sentences: sum(covered, (r) => r.oracle!.sentences),
    fragments: sum(covered, (r) => r.oracle!.fragments),
    trailers: sum(covered, (r) => r.oracle!.trailers),
    accepted: sum(covered, (r) => r.oracle!.accepted),
    offPage: sum(covered, (r) => r.oracle!.offPage),
    base: side((v) => v.base),
    head: side((v) => v.head),
    regressions: sum(covered, (r) => r.oracle!.verdict.regressions.length),
    fragmentRegressions: sum(covered, (r) => r.oracle!.verdict.fragmentRegressions.length),
    regressedPages: covered.filter((r) => r.oracle!.verdict.regressions.length > 0).length,
    failingPages: covered.filter(failingOf).length,
  };
  if (!totals.withFeed) {
    console.log('\noracle du flux : aucune page n’a de contenu de flux (`capture.mts --backfill`)');
    return totals;
  }

  const shown = covered.filter((r) => {
    const v = r.oracle!.verdict;
    return (v.head?.missing.length ?? 0) > 0 || (v.base?.missing.length ?? 0) > 0 || v.fragmentRegressions.length > 0;
  });
  shown.sort(
    (a, b) =>
      Number(failingOf(b)) - Number(failingOf(a)) ||
      (b.oracle!.verdict.head?.missing.length ?? 0) - (a.oracle!.verdict.head?.missing.length ?? 0) ||
      a.host.localeCompare(b.host),
  );
  if (shown.length) console.log('\n══ oracle du flux : pages incomplètes ══');
  for (const r of shown) {
    const o = r.oracle!;
    const v = o.verdict;
    const n = (m: OracleVerdict['base']) => (m ? String(m.missing.length) : '?');
    console.log(
      `── ${r.host || '?'}  ${r.file}  flux ${o.sentences} phrases · base manque ${n(v.base)} · tête manque ${n(v.head)}` +
        (v.regressions.length ? ` · RÉGRESSIONS ${v.regressions.length}` : ''),
    );
    console.log(`   ${r.url}`);
    for (const s of v.regressions) console.log(`   RÉGRESSION « ${clip(s)} »`);
    const others = (v.head?.missing ?? []).filter((s) => !v.regressions.includes(s));
    for (const s of others.slice(0, ORACLE_EXAMPLES)) console.log(`   manque  « ${clip(s)} »`);
    if (others.length > ORACLE_EXAMPLES) console.log(`   … et ${others.length - ORACLE_EXAMPLES} autres`);
    if (v.fragmentRegressions.length) console.log(`   fragments régressés « ${clip(v.fragmentRegressions.join(' · '))} »`);
  }

  const line = (name: string, t: typeof totals.base) =>
    `oracle du flux (${name}) : ${totals.covered} pages couvertes, ${t.incomplete} pages incomplètes, ${t.missing} phrases manquantes` +
    ` (fragments ${t.missingFragments})${t.measured < totals.covered ? ` · ${totals.covered - t.measured} non mesurées` : ''}`;
  console.log(`\n${line('base', totals.base)}`);
  console.log(line('tête', totals.head));
  console.log(
    `oracle du flux : ${totals.withFeed} pages avec flux · ${totals.sentences} phrases et ${totals.fragments} fragments attendus` +
      ` · écartés : fins de flux ${totals.trailers}, acceptés ${totals.accepted}, absents de la page ${totals.offPage}` +
      ` · régressions ${totals.regressions} sur ${totals.regressedPages} pages (fragments ${totals.fragmentRegressions})` +
      (strict ? ` · strict : ${totals.failingPages} pages en échec` : ''),
  );
  return totals;
}

function isFailing(r: PageReport): boolean {
  return r.newError || !!r.diff?.failing;
}

function sum<T>(list: T[], f: (x: T) => number): number {
  return list.reduce((n, x) => n + f(x), 0);
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`compare : ${err.message}`);
    process.exit(2);
  },
);
