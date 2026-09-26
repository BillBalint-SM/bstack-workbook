/** Render local HTML through the packaged browser. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export const RENDER_SENTINEL = 'BFSTACK_RENDER_OK';
const DEFAULT_TIMEOUT_MS = 120_000;
/** Default budget for a waitFor selector/expression, on either engine. */
const DEFAULT_WAIT_MS = 30_000;
/** Default cap (chars) on an inline eval result. */
const DEFAULT_MAX_INLINE = 20_000;
/** Screenshot height when only a width is given (4:3). */
const DEFAULT_ASPECT = 0.75;
/** The page-number footer shared by bfstack-render and the browse `pdf` command. */
export const PAGE_NUMBER_FOOTER = '<div style="font-size:9pt; font-family:Helvetica,Arial,sans-serif; color:#666; width:100%; text-align:center;"><span class="pageNumber"></span> of <span class="totalPages"></span></div>';

/** CDP Page.printToPDF options and optional layout wait. Inches for paper/margins. */
export interface PdfStepOptions {
  paperWidth?: number;
  paperHeight?: number;
  landscape?: boolean;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  preferCSSPageSize?: boolean;
  generateTaggedPDF?: boolean;
  generateDocumentOutline?: boolean;
  pageRanges?: string;
  scale?: number;
  /** Wait (≤3s, non-fatal) for `window.__pagedjsAfterFired` before printing. */
  waitForPagedJs?: boolean;
}

export type RenderStep =
  | { kind: 'pdf'; out: string; options?: PdfStepOptions }
  | { kind: 'screenshot'; out: string; width?: number; height?: number; deviceScaleFactor?: number; mobile?: boolean; fullPage?: boolean; selector?: string; type?: 'png' | 'jpeg'; quality?: number }
  /**
   * Evaluate a JS expression in the page (promises are awaited). With `out`,
   * the result is written to that file: strings verbatim; `data:` URLs are
   * decoded to bytes; other values as JSON. Without `out`, the result comes
   * back in `RenderResult.evals` (strings are truncated to `maxInline` chars).
   */
  | { kind: 'eval'; expression: string; out?: string; maxInline?: number };

export interface RenderSpec {
  /** Absolute path of the HTML file to open. */
  file: string;
  /** Directory served over loopback (default: the file's directory). Must contain `file`. */
  serveRoot?: string;
  /** Readiness: a selector that must be attached, and/or an expression that must be truthy. */
  waitFor?: { selector?: string; expression?: string; timeoutMs?: number };
  steps: RenderStep[];
  timeoutMs?: number;
}

export type RenderEngine = 'browse';

export interface RenderResult {
  ok: boolean;
  /** Which browser ran the spec (absent when none could). */
  engine?: RenderEngine;
  /** Files written on the caller's side, in step order (steps without `out` contribute nothing). */
  outputs: string[];
  /** Inline eval results keyed by step index. */
  evals: Record<number, string>;
  stdout: string;
  error?: string;
}

// ─── Paper + margin helpers (named paper sizes → CDP inches) ──────────

const PAPER_INCHES: Record<string, [number, number]> = {
  letter: [8.5, 11], legal: [8.5, 14], tabloid: [11, 17], ledger: [17, 11],
  a0: [33.1, 46.8], a1: [23.4, 33.1], a2: [16.54, 23.4], a3: [11.7, 16.54], a4: [8.27, 11.7], a5: [5.83, 8.27], a6: [4.13, 5.83],
};

/** "1in" | "20mm" | "72px" | "2cm" | "12pt" | bare number (px) → inches. */
export function lengthToInches(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return v / 96;
  const m = String(v).trim().match(/^([0-9]*\.?[0-9]+)\s*(in|mm|cm|px|pt)?$/i);
  if (!m) throw new Error(`unsupported length: ${v}`);
  const n = parseFloat(m[1]);
  switch ((m[2] || 'px').toLowerCase()) {
    case 'in': return n;
    case 'mm': return n / 25.4;
    case 'cm': return n / 2.54;
    case 'pt': return n / 72;
    default: return n / 96;
  }
}

/** Paper format name → [width, height] in inches; undefined for unknown names. */
export function paperInches(format: string | undefined): [number, number] | undefined {
  if (!format) return undefined;
  return PAPER_INCHES[format.toLowerCase()];
}

// ─── Script generation ───────────────────────────────────────────────────────

const HOOK = `(() => { window.__bfstackErrs = window.__bfstackErrs || []; const oe = console.error; console.error = (...a) => { window.__bfstackErrs.push(a.map(String).join(" ")); oe.apply(console, a); }; window.addEventListener("error", e => window.__bfstackErrs.push("uncaught: " + e.message)); })()`;

function artifactName(i: number, out: string): string {
  const ext = path.extname(out) || '.bin';
  return `bfstack-render-${i}${ext}`;
}

export function serveDir(root: string, nonce: string = randomBytes(16).toString('hex')): { url: string; stop: () => void } {
  const realRoot = fs.realpathSync(root);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  const inside = (p: string) => p === realRoot || p.startsWith(prefix);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      let pathname: string;
      try { pathname = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response('bad request', { status: 400 }); }
      if (!pathname.startsWith(`/${nonce}/`)) return new Response('not found', { status: 404 });
      pathname = pathname.slice(nonce.length + 1);
      const target = path.resolve(realRoot, '.' + pathname);
      if (!inside(target)) return new Response('forbidden', { status: 403 });
      let real: string;
      try { real = fs.realpathSync(target); } catch { return new Response('not found', { status: 404 }); }
      if (!inside(real)) return new Response('forbidden', { status: 403 });
      if (fs.statSync(real).isDirectory()) return new Response('not found', { status: 404 });
      return new Response(Bun.file(real));
    },
  });
  return { url: `http://127.0.0.1:${server.port}/${nonce}`, stop: () => server.stop(true) };
}

// ─── Async spawn (keeps the loopback server's event loop free) ────────────────

async function runProc(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([cmd, ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  } catch (e) {
    return { code: null, stdout: '', stderr: '', error: (e as Error).message };
  }
  let timedOut = false;
  // Every timer is tracked and cleared on exit: a dangling one keeps the event
  // loop alive and a CLI with no explicit process.exit (bfstack-render) would sit
  // for up to timeoutMs after printing its result.
  const timers: ReturnType<typeof setTimeout>[] = [];
  const after = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
  after(timeoutMs, () => { timedOut = true; try { child.kill(); } catch {} });
  // A child that ignores SIGTERM (a CLI blocked on its app) gets SIGKILL; a
  // grandchild holding the pipes open must not hang the render either.
  after(timeoutMs + 5_000, () => { try { child.kill('SIGKILL'); } catch {} });
  const read = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const giveUp = new Promise<[string, string]>((resolve) => after(timeoutMs + 10_000, () => resolve(['', ''])));
  const [stdout, stderr] = await Promise.race([read, giveUp]);
  // Pipes at EOF means the child is exiting; wait for the exit code until the
  // SIGKILL above has had its turn. A flat 5s bound here once failed a CI render
  // whose fake had already written its artifact — under a 6-shard load the
  // reaper needed longer than that, and a null code reads as a failed command.
  const code = await Promise.race([child.exited, new Promise<null>((resolve) => after(timeoutMs + 6_000, () => resolve(null)))]);
  for (const t of timers) clearTimeout(t);
  return { code, stdout, stderr, error: timedOut ? `timed out after ${timeoutMs}ms` : undefined };
}


/** Where callers may stage HTML so the loopback server can reach it. */
export function renderTmpDir(): string {
  const dir = path.join(os.tmpdir(), 'bfstack-render');
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  // Ours: a real directory we own. Anything else at the shared name (another
  // user's directory, a planted symlink) is never staged into — fall back to a
  // private mkdtemp so a neighbour on the box cannot swap files under a render.
  const ours = (): boolean => {
    try { const st = fs.lstatSync(dir); return st.isDirectory() && !st.isSymbolicLink() && (uid === undefined || st.uid === uid); } catch { return false; }
  };
  if (ours()) return dir;
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch { /* exists or unwritable — decided below */ }
  return ours() ? dir : fs.mkdtempSync(path.join(os.tmpdir(), 'bfstack-render-'));
}

// ─── Render: browse (bfstack's own headless browser, the fallback) ────────────

/** Roots that may hold browse/dist/browse or the browse/bin/find-browse shim. */
const BROWSE_ROOTS = [
  path.resolve(import.meta.dir, '..'),                    // repo checkout: lib/ → root
  path.resolve(path.dirname(process.execPath), '../..'),  // compiled runtime executable → root
];
/** The daemon only reads/writes under its safe dirs; /tmp is always one of them. */
export const SAFE_TMP_DIR = process.platform === 'win32' ? os.tmpdir() : '/tmp';

/** A regular, executable file — probing .exe/.cmd/.bat on Windows, where X_OK degrades to an existence check. */
function executable(p: string): string | null {
  for (const c of process.platform === 'win32' ? [p, `${p}.exe`, `${p}.cmd`, `${p}.bat`] : [p]) {
    try {
      if (fs.statSync(c).isFile()) { fs.accessSync(c, fs.constants.X_OK); return c; }
    } catch { /* next candidate */ }
  }
  return null;
}

/**
 * Locate bfstack's own browse binary: $BFSTACK_BROWSE_BIN → $BROWSE_BIN →
 * <root>/browse/dist/browse → <root>/browse/bin/find-browse (per root, repo
 * then install) → `browse` on PATH. Null when nothing resolves.
 */
export function resolveBrowseBin(env: NodeJS.ProcessEnv = process.env, roots: string[] = BROWSE_ROOTS): string | null {
  // Packaged rendering must never select an older install from HOME or PATH.
  if (env.BFSTACK_RUNTIME === '1') return env.BFSTACK_ROOT ? executable(path.join(env.BFSTACK_ROOT, 'browse/dist/browse')) : null;
  const PATH = env.PATH ?? env.Path ?? '';
  const override = (env.BFSTACK_BROWSE_BIN ?? env.BROWSE_BIN ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (override) {
    const found = path.isAbsolute(override) ? executable(override) : Bun.which(override, { PATH });
    if (found) return found;
  }
  for (const root of roots) {
    const built = executable(path.join(root, 'browse/dist/browse'));
    if (built) return built;
    const shim = executable(path.join(root, 'browse/bin/find-browse'));
    if (!shim) continue;
    const r = spawnSync(shim, [], { encoding: 'utf8', timeout: 10_000 });
    const found = r.status === 0 ? executable((r.stdout ?? '').trim()) : null;
    if (found) return found;
  }
  return Bun.which('browse', { PATH }) ?? null;
}

/** PdfStepOptions (CDP, inches) → the browse `pdf --from-file` payload (Playwright shapes, string lengths). */
export function browsePdfPayload(o: PdfStepOptions, output: string): Record<string, unknown> {
  const p: Record<string, unknown> = { output };
  let [w, h] = [o.paperWidth, o.paperHeight];
  if (o.landscape) [w, h] = [h ?? 11, w ?? 8.5]; // browse has no landscape flag: swap (Letter when unset)
  if (w !== undefined && h !== undefined) { p.width = `${w}in`; p.height = `${h}in`; }
  for (const k of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const) {
    if (o[k] !== undefined) p[k] = `${o[k]}in`;
  }
  if (o.displayHeaderFooter) {
    p.headerTemplate = o.headerTemplate ?? '<div></div>';
    p.footerTemplate = o.footerTemplate ?? '<div></div>';
  }
  if (o.generateTaggedPDF) p.tagged = true;
  if (o.generateDocumentOutline) p.outline = true;
  if (o.printBackground) p.printBackground = true;
  if (o.preferCSSPageSize) p.preferCSSPageSize = true;
  if (o.waitForPagedJs) p.toc = true;
  return p;
}

type ScreenshotStep = Extract<RenderStep, { kind: 'screenshot' }>;

/** Screenshot step → browse `screenshot` args (the path's extension picks png/jpeg). */
export function browseScreenshotArgs(step: ScreenshotStep, output: string): string[] {
  const args = ['screenshot'];
  if (step.fullPage === false) args.push('--viewport');
  if (step.selector) args.push('--selector', step.selector);
  args.push(output);
  return args;
}

function screenshotName(i: number, step: ScreenshotStep): string {
  const ext = step.type === 'jpeg' ? '.jpg' : step.type === 'png' ? '.png' : (path.extname(step.out) || '.png');
  return `bfstack-render-${i}${ext}`;
}

/**
 * Run a RenderSpec through the browse daemon. Same loopback server as the
 * to the caller's paths. The tab is closed in a finally; the daemon stays up.
 */
export async function renderWithBrowse(spec: RenderSpec, bin: string | null = resolveBrowseBin()): Promise<RenderResult> {
  const outputs: string[] = [];
  const evals: Record<number, string> = {};
  const log: string[] = [];
  const fail = (error: string): RenderResult => ({ ok: false, engine: 'browse', outputs, evals, stdout: log.join('\n'), error });
  if (!bin) return fail(`${NO_BROWSER}: ${NO_BROWSER_HELP}`);
  const file = path.resolve(spec.file);
  if (!fs.existsSync(file)) return fail(`HTML file not found: ${file}`);
  const root = path.resolve(spec.serveRoot ?? path.dirname(file));
  const rel = path.relative(root, file);
  if (rel.startsWith('..')) return fail(`file ${file} is outside serveRoot ${root}`);

  const deadline = Date.now() + (spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const run = async (args: string[]): Promise<string> => {
    const r = await runProc(bin, args, Math.max(1_000, Math.min(120_000, deadline - Date.now())));
    log.push(`$ browse ${args.join(' ').slice(0, 300)}\n${r.stdout}${r.stderr}`.trim());
    if (r.error || r.code !== 0) {
      const first = (r.stderr || r.stdout || r.error || '').trim().split('\n')[0];
      if (/JS execution blocked/.test(`${r.stderr}${r.stdout}`)) {
        throw new Error(`browse ${args[0]} refused page JavaScript: ${first}`);
      }
      throw new Error(`browse ${args[0]} failed: ${first}`);
    }
    return r.stdout;
  };
  const copyOut = (src: string, out: string, i: number) => {
    if (!fs.existsSync(src)) throw new Error(`step ${i} produced no artifact (${src})`);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.copyFileSync(src, out);
    outputs.push(out);
  };

  let work: string | undefined;
  let srv: { url: string; stop: () => void } | undefined;
  let tab: number | undefined;
  try {
    work = fs.mkdtempSync(path.join(SAFE_TMP_DIR, 'bfstack-render-browse-'));
    srv = serveDir(root);
    // The first CLI call auto-starts the daemon; on a cold start it can answer
    // "Unable to connect" once while the server is still coming up. One retry
    // after a short pause turns that into the wait it really is.
    const openTab = async () => (await run(['newtab', '--json'])).match(/\{[^\n]*"tabId"[^\n]*\}/)?.[0];
    let opened: string | undefined;
    try {
      opened = await openTab();
    } catch (e) {
      if (!/Unable to connect/.test((e as Error).message)) throw e;
      log.push('newtab: daemon not up yet — retrying once');
      await Bun.sleep(1_500);
      opened = await openTab();
    }
    tab = opened ? JSON.parse(opened).tabId : undefined;
    if (typeof tab !== 'number') throw new Error('browse newtab --json returned no tabId');
    const T = ['--tab-id', String(tab)];
    const js = async (expr: string, extra: string[] = []) => (await run(['js', expr, ...extra, ...T])).replace(/\n$/, '');
    // Poll until truthy. A throw inside the page (e.g. `window.later.ok` before
    // never a render failure. `run` still throws when the daemon itself refuses.
    const until = async (expr: string, what: string, timeoutMs: number) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        if ((await js(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) === 'true') return;
        await Bun.sleep(150);
      }
      throw new Error(`${what} (waited ${timeoutMs}ms)`);
    };

    await run(['goto', `${srv.url}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`, ...T]);
    // Best-effort console reset: if the daemon blocks page JavaScript,
    // pdf/screenshot/`js --out` steps
    // must still run; a waitFor or eval step that is genuinely blocked fails
    // below with the daemon's own message.
    const bestEffortJs = async (expr: string, what: string) => { try { return await js(expr); } catch (e) { log.push(`${what} unavailable: ${(e as Error).message}`); return null; } };
    // pre-navigation hook, so errors logged during load are not captured here.
    await bestEffortJs(HOOK, 'console hook');
    const wait = spec.waitFor;
    if (wait?.selector) await until(`document.querySelector(${JSON.stringify(wait.selector)})`, `waitFor selector never attached: ${wait.selector}`, wait.timeoutMs ?? DEFAULT_WAIT_MS);
    if (wait?.expression) await until(wait.expression, `waitFor expression never became truthy: ${wait.expression}`, wait.timeoutMs ?? DEFAULT_WAIT_MS);

    for (const [i, step] of spec.steps.entries()) {
      if (step.kind === 'pdf') {
        const tmp = path.join(work, artifactName(i, step.out));
        const payload = path.join(work, `pdf-${i}.json`);
        fs.writeFileSync(payload, JSON.stringify(browsePdfPayload(step.options ?? {}, tmp)));
        await run(['pdf', '--from-file', payload, ...T]);
        copyOut(tmp, step.out, i);
      } else if (step.kind === 'screenshot') {
        const tmp = path.join(work, screenshotName(i, step));
        if (step.width) {
          const vp = [`${step.width}x${step.height ?? Math.round(step.width * DEFAULT_ASPECT)}`];
          // `--scale` recreates the daemon's browser context (and is refused in
          // headed mode), so it is passed only when the caller asked for it; the
          if (step.deviceScaleFactor) vp.push('--scale', String(step.deviceScaleFactor));
          await run(['viewport', ...vp, ...T]);
        }
        await run([...browseScreenshotArgs(step, tmp), ...T]);
        copyOut(tmp, step.out, i);
        // default so a later un-sized screenshot is not taken at this width.
        if (step.width) await run(['viewport', '1280x720', ...T]);
      } else if (step.out) {
        const tmp = path.join(work, artifactName(i, step.out));
        await js(step.expression, ['--out', tmp]); // the daemon decodes data: URLs to bytes itself
        copyOut(tmp, step.out, i);
      } else {
        evals[i] = (await js(step.expression)).slice(0, step.maxInline ?? DEFAULT_MAX_INLINE);
      }
    }
    const errs = await bestEffortJs('JSON.stringify(window.__bfstackErrs || [])', 'PAGE_ERRORS');
    if (errs !== null) log.push(`PAGE_ERRORS=${errs}`);
    return { ok: true, engine: 'browse', outputs, evals, stdout: log.join('\n') };
  } catch (e) {
    return fail((e as Error).message);
  } finally {
    if (tab !== undefined) await runProc(bin, ['closetab', String(tab)], 15_000);
    srv?.stop();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
}

// ─── Engine choice ───────────────────────────────────────────────────────────

export const NO_BROWSER = 'packaged browser unavailable';
export const NO_BROWSER_HELP = 'BLOCKED: select a package containing its own browse executable; do not install or switch browsers inside this workflow.';
export type EngineChoice = { engine: 'browse'; bin: string } | { engine: null; error: string };
export function pickEngine(_fresh = false, deps: { resolveBin?: () => string | null } = {}): EngineChoice {
  const bin = (deps.resolveBin ?? resolveBrowseBin)();
  return bin ? { engine: 'browse', bin } : { engine: null, error: `${NO_BROWSER}: ${NO_BROWSER_HELP}` };
}
export async function render(spec: RenderSpec): Promise<RenderResult> {
  const engine = pickEngine();
  return engine.engine === 'browse' ? renderWithBrowse(spec, engine.bin)
    : { ok: false, outputs: [], evals: {}, stdout: '', error: engine.error };
}
