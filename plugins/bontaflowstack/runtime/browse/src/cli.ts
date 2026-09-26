/**
 * bfstack CLI — thin wrapper that talks to the persistent server
 *
 * Flow:
 *   1. Read .bfstack/browse.json for port + token
 *   2. If missing or stale PID → start server in background
 *   3. Health check + version mismatch detection
 *   4. Send command via HTTP POST
 *   5. Print response to stdout (or stderr for errors)
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn as nodeSpawn } from 'child_process';
import { safeUnlink, safeUnlinkQuiet, safeKill, isProcessAlive } from './error-handling';
import { writeSecureFile, mkdirSecure } from './file-permissions';
import { belongsToStateFile, inspectProcessIdentity, isCurrentOwnedProcess, type ProcessIdentity, type ProcessInspector } from './process-identity';
import { resolveBfstackHome, resolveConfig, ensureStateDir, readVersionHash } from './config';
import { parseProxyConfig, computeConfigHash, ProxyConfigError } from './proxy-config';
import { redactProxyUrl } from './proxy-redact';

const config = resolveConfig();
const IS_WINDOWS = process.platform === 'win32';

/**
 * Startup health-probe budget (ms) for a freshly spawned server. The daemon is
 * detached + unref'd, so it keeps booting regardless of how long the CLI is
 * willing to poll — this constant only bounds how long `startServer` waits
 * before reporting failure.
 *
 * Overridable via `BROWSE_START_TIMEOUT` (ms) for hosts where even the platform
 * ceiling isn't enough — e.g. Windows under heavy load (#1846), where the 15s
 * budget can still elapse before a busy box finishes booting Node+Chromium.
 * Mirrors the `BROWSE_*` tunable convention used throughout server.ts
 * (BROWSE_PORT, BROWSE_IDLE_TIMEOUT, ...). A non-positive or unparseable value
 * falls back to the platform default. Pure + exported for tests.
 */
export function resolveStartTimeout(env: NodeJS.ProcessEnv = process.env): number {
  // Cold Chromium launch measured ~5.7s at load avg 10 on a dev machine running
  // many servers; at load 12+ it exceeds the old 8s budget, so the CLI gave up
  // while the (detached) daemon was still booting → "Server failed to start
  // within 8s". 15s matches the Windows budget and gives real headroom; the poll
  // loop returns the instant the daemon is healthy, so this only costs time in a
  // genuine-failure case.
  const platformDefault = IS_WINDOWS ? 15000 : (env.CI ? 30000 : 15000); // Node+Chromium takes longer on Windows
  const override = parseInt(env.BROWSE_START_TIMEOUT || '', 10);
  return Number.isFinite(override) && override > 0 ? override : platformDefault;
}
const MAX_START_WAIT = resolveStartTimeout();

export function resolveServerScript(
  env: Record<string, string | undefined> = process.env,
  metaDir: string = import.meta.dir,
  execPath: string = process.execPath
): string {
  if (env.BROWSE_SERVER_SCRIPT) {
    return env.BROWSE_SERVER_SCRIPT;
  }

  // Dev mode: cli.ts runs directly from browse/src
  // On macOS/Linux, import.meta.dir starts with /
  // On Windows, it starts with a drive letter (e.g., C:\...)
  if (!metaDir.includes('$bunfs')) {
    const direct = path.resolve(metaDir, 'server.ts');
    if (fs.existsSync(direct)) {
      return direct;
    }
  }

  // Compiled binary: derive the source tree from browse/dist/browse
  if (execPath) {
    const adjacent = path.resolve(path.dirname(execPath), '..', 'src', 'server.ts');
    if (fs.existsSync(adjacent)) {
      return adjacent;
    }
  }

  throw new Error(
    'Cannot find server.ts. Set BROWSE_SERVER_SCRIPT env or run from the browse source tree.'
  );
}

const SERVER_SCRIPT = resolveServerScript();

/**
 * On Windows, resolve the Node.js-compatible server bundle.
 * Falls back to null if not found (server will use Bun instead).
 */
export function resolveNodeServerScript(
  metaDir: string = import.meta.dir,
  execPath: string = process.execPath
): string | null {
  // Dev mode
  if (!metaDir.includes('$bunfs')) {
    const distScript = path.resolve(metaDir, '..', 'dist', 'server-node.mjs');
    if (fs.existsSync(distScript)) return distScript;
  }

  // Compiled binary: browse/dist/browse → browse/dist/server-node.mjs
  if (execPath) {
    const adjacent = path.resolve(path.dirname(execPath), 'server-node.mjs');
    if (fs.existsSync(adjacent)) return adjacent;
  }

  return null;
}

const NODE_SERVER_SCRIPT = IS_WINDOWS ? resolveNodeServerScript() : null;

/** Resolve the Node runtime packaged with the selected bfstack installation.
 * Windows server bundles must not use a system-wide developer Node binary. */
export function resolveBundledNodePath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.BFSTACK_NODE_PATH;
  const runtimeRoot = env.BFSTACK_ROOT;
  const candidate = explicit || (runtimeRoot ? path.join(runtimeRoot, 'tools', 'node', 'node.exe') : '');
  if (!candidate || !fs.existsSync(candidate)) {
    throw new Error('Packaged Node runtime is unavailable. Set BFSTACK_NODE_PATH or provide BFSTACK_ROOT/tools/node/node.exe.');
  }
  if (runtimeRoot) {
    const toolsRoot = path.resolve(runtimeRoot, 'tools', 'node');
    const relative = path.relative(toolsRoot, path.resolve(candidate));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('BFSTACK_NODE_PATH must remain inside the selected bfstack runtime.');
    }
  }
  return candidate;
}

// On Windows, hard-fail if server-node.mjs is missing — the Bun path is known broken.
if (IS_WINDOWS && !NODE_SERVER_SCRIPT) {
  throw new Error(
    'server-node.mjs not found. Run `bun run build` to generate the Windows server bundle.'
  );
}

export interface ManagedDaemonState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  serverPath: string;
  binaryVersion?: string;
  mode?: 'launched' | 'headed';
  /** Hash of (proxyUrl + headed flag), used by D2 daemon-mismatch check. */
  configHash?: string;
  /** Xvfb child PID for cleanup on disconnect. */
  xvfbPid?: number;
  xvfbStartTime?: number;
  xvfbDisplay?: string;
  /** Launched-Chromium identity for post-stop reaping (#2709). */
  chromiumPid?: number;
  chromiumStartTime?: string;
  /** Captured by the daemon at creation; required for direct termination. */
  daemonIdentity?: ProcessIdentity;
  /** Captured by the daemon at Chromium launch; required for Chromium cleanup. */
  chromiumIdentity?: ProcessIdentity;
}

type ServerState = ManagedDaemonState;

// ─── State File ────────────────────────────────────────────────
function readState(): ServerState | null {
  let raw: string;
  try {
    raw = fs.readFileSync(config.stateFile, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw new Error(`[browse] Cannot read daemon state: ${err?.message || String(err)}`);
  }
  let state: unknown;
  try { state = JSON.parse(raw); } catch { throw new Error('[browse] Daemon state is invalid JSON; refusing automatic cleanup.'); }
  if (!state || typeof state !== 'object') throw new Error('[browse] Daemon state has an invalid shape; refusing automatic cleanup.');
  const candidate = state as Partial<ServerState>;
  if (!Number.isSafeInteger(candidate.pid) || candidate.pid <= 0
    || !Number.isSafeInteger(candidate.port) || candidate.port < 1024 || candidate.port > 65535
    || typeof candidate.token !== 'string' || typeof candidate.startedAt !== 'string' || typeof candidate.serverPath !== 'string') {
    throw new Error('[browse] Daemon state has an invalid shape; refusing automatic cleanup.');
  }
  return candidate as ServerState;
}

// isProcessAlive is imported from ./error-handling

/**
 * HTTP health check — definitive proof the server is alive and responsive.
 * Used in all polling loops instead of isProcessAlive() (which is slow on Windows).
 */
export async function isServerHealthy(port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return false;
    const health = await resp.json() as any;
    return health.status === 'healthy';
  } catch {
    return false;
  }
}

/** Best-effort tab count via GET /health (no auth, bounded). Returns null
 * when the daemon doesn't answer in time or predates the `tabs` field —
 * callers degrade to a countless phrasing, never block on this. */
async function fetchDaemonTabCount(port: number, timeoutMs = 2000): Promise<number | null> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const health = await resp.json() as any;
    return typeof health.tabs === 'number' ? health.tabs : null;
  } catch {
    return null;
  }
}

// ─── Process Management ─────────────────────────────────────────
export interface ProcessOperations {
  inspect: ProcessInspector;
  requestStop: (state: ManagedDaemonState) => Promise<boolean>;
  /** Directly terminate one verified daemon PID. Never accepts a process tree. */
  terminate: (identity: ProcessIdentity, stateFile: string) => Promise<boolean>;
  cleanup: (state: ManagedDaemonState) => Promise<void>;
}

export type StopOwnedDaemonResult =
  | { stopped: true; reason: 'api' | 'terminated' }
  | { stopped: false; reason: 'identity-mismatch' };

/**
 * The only direct-termination boundary for a recorded daemon. Old, copied or
 * incomplete state is deliberately non-actionable.
 */
export async function stopOwnedDaemon(
  state: ManagedDaemonState,
  stateFile: string,
  operations: ProcessOperations,
): Promise<StopOwnedDaemonResult> {
  if (!state.daemonIdentity || state.pid !== state.daemonIdentity.pid
    || !isCurrentOwnedProcess(state.daemonIdentity, stateFile, operations.inspect)) {
    return { stopped: false, reason: 'identity-mismatch' };
  }
  if (await operations.requestStop(state)) return { stopped: true, reason: 'api' };
  // The HTTP timeout is an asynchronous gap: re-check immediately before
  // requesting the OS signal so PID reuse cannot turn into a blind retry.
  if (!isCurrentOwnedProcess(state.daemonIdentity, stateFile, operations.inspect)) {
    return { stopped: false, reason: 'identity-mismatch' };
  }
  if (!await operations.terminate(state.daemonIdentity, stateFile)) {
    return { stopped: false, reason: 'identity-mismatch' };
  }
  await operations.cleanup(state);
  return { stopped: true, reason: 'terminated' };
}

async function requestDaemonStop(state: ManagedDaemonState): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ command: 'stop', args: [] }),
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function terminateOneProcess(identity: ProcessIdentity, stateFile: string): Promise<boolean> {
  // A Windows PID can be reused between a CIM check and process.kill(). Until
  // this path uses one retained OS process handle, fail closed after the
  // authenticated API attempt rather than signal a PID by number.
  if (process.platform === 'win32') return false;
  if (!isCurrentOwnedProcess(identity, stateFile) || !isProcessAlive(identity.pid)) return false;
  safeKill(identity.pid, 'SIGTERM');
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && isProcessAlive(identity.pid)) await Bun.sleep(100);
  if (isProcessAlive(identity.pid)) {
    if (!isCurrentOwnedProcess(identity, stateFile)) return false;
    safeKill(identity.pid, 'SIGKILL');
  }
  return true;
}

// ─── Chromium profile lock helpers (#1781) ─────────────────────
/** Profile dir used by headed/connect Chromium sessions. Must resolve exactly
 * as browser-manager does (config.resolveChromiumProfile), or the lock cleanup
 * and orphan kill below target a different profile than the one being launched
 * and evict an unrelated browser. */
/** Remove Chromium SingletonLock/Socket/Cookie so a relaunch can acquire the
 * profile. Safe to call when absent. */
function cleanChromiumProfileLocks(profileDir: string): void {
  for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    safeUnlinkQuiet(path.join(profileDir, lockFile));
  }
}

/**
 * Reap the launched Chromium recorded in the state file (#2709). The headless
 * launch has no userDataDir, so it never writes a profile SingletonLock —
 * `browse stop` reported success while the orphaned GPU process kept spinning
 * (~800% CPU on macOS 26). Identity is
 * verified TWO ways before any signal — start time matches the recorded
 * value AND the executable looks like Chromium — so a recycled PID (even one
 * now running a different, legitimate Chromium) is never killed.
 */
export async function reapRecordedChromium(state: {
  chromiumIdentity?: ProcessIdentity;
}): Promise<void> {
  const identity = state.chromiumIdentity;
  // See terminateOneProcess: never use a separately looked-up Windows PID for
  // a direct fallback signal.
  if (process.platform === 'win32') return;
  if (!identity || !isCurrentOwnedProcess(identity, config.stateFile)) return;
  const pid = identity.pid;
  safeKill(pid, 'SIGTERM');
  // Poll instead of a fixed sleep: the common case (daemon's own close is
  // finishing concurrently) exits in ~100-200ms instead of always paying 1s.
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (isProcessAlive(pid) && isCurrentOwnedProcess(identity, config.stateFile)) {
    safeKill(pid, 'SIGKILL');
  }
}

async function cleanupVerifiedBrowserResources(state: ManagedDaemonState): Promise<void> {
  const profileDir = state.chromiumIdentity?.profileDir;
  const mayCleanLocks = Boolean(profileDir && isCurrentOwnedProcess(state.chromiumIdentity, config.stateFile));
  await reapRecordedChromium(state);
  if (mayCleanLocks && profileDir && !isProcessAlive(state.chromiumIdentity!.pid)) cleanChromiumProfileLocks(profileDir);
}

async function stopRecordedDaemon(state: ManagedDaemonState): Promise<StopOwnedDaemonResult> {
  return stopOwnedDaemon(state, config.stateFile, {
    inspect: inspectProcessIdentity,
    requestStop: requestDaemonStop,
    terminate: terminateOneProcess,
    cleanup: cleanupVerifiedBrowserResources,
  });
}

function isVerifiedDaemonState(state: ManagedDaemonState): boolean {
  return Boolean(state.daemonIdentity && state.pid === state.daemonIdentity.pid
    && isCurrentOwnedProcess(state.daemonIdentity, config.stateFile));
}

async function stopRecordedDaemonAndConfirm(state: ManagedDaemonState): Promise<boolean> {
  const result = await stopRecordedDaemon(state);
  if (!result.stopped) return false;
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && isProcessAlive(state.pid)) await Bun.sleep(100);
  return !isProcessAlive(state.pid);
}

/** Total wall-clock budget for the busy-vs-dead health probe (#2219,
 * decision F10). The old ~1s window (3 × 250ms) was shorter than how long a
 * daemon stays unresponsive while Chromium chews a heavy dev-mode page with a
 * timed-out navigation still in flight — so live daemons got killed and every
 * kill lost the session's cookies/tabs/logins. ~8s covers the observed busy
 * windows; past it we REPORT busy instead of killing (never auto-kill). */
export const HEALTH_PROBE_TOTAL_BUDGET_MS = 8_000;

/** Bounded /health probe. Returns true if the server answers within the
 * total budget — distinguishes a busy-but-alive daemon from a dead one
 * (#1781, #2219) so a slow server isn't killed and restarted into a
 * crash-loop.
 *
 * P4 wall-time honesty: every call site reaches here right after a probe or
 * command already failed, so iterations START with the sleep (an immediate
 * re-probe would just re-fail), and each probe's timeout is clamped to the
 * remaining budget — otherwise the last 2s probe could start 1ms before the
 * deadline and the reported "~8s" budget would really be ~10s. */
async function probeHealthWithBackoff(
  port: number,
  totalBudgetMs = HEALTH_PROBE_TOTAL_BUDGET_MS,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + totalBudgetMs;
  for (;;) {
    if (Date.now() + intervalMs >= deadline) return false;
    await Bun.sleep(intervalMs);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    if (await isServerHealthy(port, Math.min(2000, remainingMs))) return true;
  }
}

export type DaemonRestartAction =
  | 'retry-command'   // healthy again after the bounded probe — retry against the SAME daemon
  | 'report-busy'     // alive but unresponsive — report + nonzero exit, daemon untouched
  | 'force-restart'   // alive but the user explicitly passed --force-restart
  | 'restart-dead';   // process is gone — safe to clean up and restart

/**
 * Decide what to do about a daemon that failed to answer (#2219, decision 9).
 *
 * IRON RULE: an alive pid is NEVER auto-killed. A kill loses the session's
 * tabs, cookies, and logins — strictly worse than a slow command. The ONLY
 * path that kills a live daemon is the user explicitly passing
 * --force-restart. Pure and exported for unit coverage.
 */
export function decideDaemonRestart(opts: {
  pidAlive: boolean;
  healthyAfterProbe: boolean;
  forceRestart: boolean;
}): DaemonRestartAction {
  if (opts.pidAlive && opts.healthyAfterProbe) return 'retry-command';
  if (opts.pidAlive && opts.forceRestart) return 'force-restart';
  if (opts.pidAlive) return 'report-busy';
  return 'restart-dead';
}

/** #2219 IRON RULE refusal for `connect`: a live daemon is never replaced
 * without explicit consent. Single source for the refusal text (M7) — the
 * two call sites (healthy fast-path, busy-but-alive after the bounded probe)
 * previously duplicated it, and the tabs/cookies/logins explainer had
 * already drifted out of one of them. */
function refuseHeadedOverLiveDaemon(state: { pid: number; mode?: string }): never {
  console.error(`[browse] A healthy daemon is already running (PID ${state.pid}, ${state.mode} mode).`);
  console.error('[browse] Connecting headed would kill it and lose its tabs/cookies/logins.');
  console.error("[browse] Run 'browse disconnect' first, or pass --force-restart to replace it.");
  process.exit(1);
}

/** The busy report (F10): what happened, what to do, what a force costs. */
function reportDaemonBusyAndExit(pid: number): never {
  console.error(`[browse] Daemon busy — process ${pid} is alive but did not answer /health within ~${HEALTH_PROBE_TOTAL_BUDGET_MS / 1000}s.`);
  console.error('[browse] Retry shortly (heavy page loads pass), or force a restart — which LOSES tabs, cookies, and logins:');
  console.error('[browse]   browse --force-restart <command>');
  process.exit(1);
}

/**
 * Build the env for an auto-restart after a crash. headed/proxy/configHash are
 * reapplied from THIS invocation OR the persisted server state, so a restart
 * triggered by a plain command (goto/status, no --headed flag) never silently
 * downgrades a headed session to headless (#1781). Pure + exported for tests.
 */
export function buildRestartEnv(
  globalFlags: GlobalFlags | null | undefined,
  oldState: ServerState | null,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (globalFlags?.proxyUrl) env.BROWSE_PROXY_URL = globalFlags.proxyUrl;
  if (globalFlags?.headed || oldState?.mode === 'headed') env.BROWSE_HEADED = '1';
  const configHash = globalFlags?.configHash || oldState?.configHash;
  if (configHash) env.BROWSE_CONFIG_HASH = configHash;
  return env;
}

/** macOS only: pull the headed Chromium window to the user's current Space.
 * "Google Chrome for Testing" frequently opens behind the active window or on
 * another Space — the first thing users read as "I can't see the browser"
 * (#1781). Best-effort, fire-and-forget, never throws. The app name is a fixed
 * literal (no interpolation). */
function raiseHeadedWindowMacOS(): void {
  if (process.platform !== 'darwin') return;
  try {
    nodeSpawn('osascript', ['-e', 'tell application "Google Chrome for Testing" to activate'], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    }).unref();
  } catch {
    // osascript missing or app not present — non-fatal
  }
}

// ─── Server Lifecycle ──────────────────────────────────────────
// The detached daemon's stdout/stderr used to be wired to 'ignore' on every
// platform, so console.error('[browse] FATAL: ...') from a Chromium crash,
// an uncaughtException, or an unhandledRejection (see server.ts's handlers
// and browser-manager.ts's handleChromiumDisconnect) went nowhere — not to
// a file, not to the terminal, discarded at the OS level (#2461). That made
// a crash-and-respawn indistinguishable from any other cause of a dropped
// session: nothing on disk ever recorded WHY. Redirect both streams to
// <stateDir>/browse-daemon.log — append mode, so it accumulates across the
// daemon's full lifetime and every respawn stays visible in one place.
//
// F6 log hygiene: nothing that reaches the daemon's stdout/stderr may carry
// an auth token or unsanitized page-derived strings —
// browse/test/daemon-log-hygiene.test.ts pins this with needle tests.
//
// Single source for the log path (M4): the Unix fd-open path and the Windows
// launcher string both build it, and a drifted spelling would silently split
// the daemon's history across two files.
function daemonLogPath(): string {
  return path.join(config.stateDir, 'browse-daemon.log');
}

/** Append-mode growth bound: the log accumulates across every respawn (a
 * crash-respawn loop would otherwise fill the disk), so on daemon start a
 * log past 10MB is renamed to browse-daemon.log.1, single generation.
 * Best-effort: a failed stat/rename must never block the launch.
 * Path + cap injectable for unit coverage; exported for the same reason. */
export const DAEMON_LOG_MAX_BYTES = 10 * 1024 * 1024;
export function rotateDaemonLogIfOversized(
  p: string = daemonLogPath(),
  maxBytes: number = DAEMON_LOG_MAX_BYTES,
): void {
  try {
    if (fs.statSync(p).size > maxBytes) {
      fs.renameSync(p, `${p}.1`);
    }
  } catch {
    // Missing log (first launch) or unwritable state dir — rotation is
    // best-effort, the launch matters more.
  }
}

function openDaemonLogSink(): number | 'ignore' {
  try {
    return fs.openSync(daemonLogPath(), 'a');
  } catch {
    // stateDir not writable (permissions, disk full) — fall back to the
    // previous behavior rather than fail the whole launch over logging.
    return 'ignore';
  }
}

async function startServer(extraEnv?: Record<string, string>): Promise<ServerState> {
  ensureStateDir(config);

  // Bound the append-mode daemon log before the new daemon starts writing.
  rotateDaemonLogIfOversized();

  // A state record only becomes disposable after its complete owner record
  // says this exact daemon is gone. Never erase an unknown record while
  // preparing a new browser: it could describe somebody else's live session.
  const staleState = readState();
  if (staleState) {
    if (isProcessAlive(staleState.pid)) {
      throw new Error('[browse] Existing daemon state is still live; refusing to replace it without verified ownership.');
    }
    if (!belongsToStateFile(staleState.daemonIdentity, config.stateFile)) {
      throw new Error('[browse] Existing daemon state lacks a verified owner record; refusing automatic cleanup.');
    }
    await cleanupVerifiedBrowserResources(staleState);
    safeUnlink(config.stateFile);
  }
  safeUnlink(path.join(config.stateDir, 'browse-startup-error.log'));

  // Allow the caller to opt out of the parent-process watchdog by setting
  // BROWSE_PARENT_PID=0 in the environment. Useful for CI, non-interactive
  // shells, and short-lived Bash invocations that need the server to outlive
  // the spawning CLI. Defaults to the current process PID (watchdog active).
  // Parse as int so stray whitespace ("0\n") still opts out — matches the
  // server's own parseInt at server.ts:760.
  const parentPid = parseInt(process.env.BROWSE_PARENT_PID || '', 10) === 0 ? '0' : String(process.pid);

  if (IS_WINDOWS && NODE_SERVER_SCRIPT) {
    // Windows: Bun.spawn() + proc.unref() doesn't truly detach on Windows —
    // when the CLI exits, the server dies with it. Use Node's child_process.spawn
    // with { detached: true } instead, which is the gold standard for Windows
    // process independence. Credit: PR #191 by @fqueiro.
    const nodeRuntime = resolveBundledNodePath();
    const extraEnvStr = JSON.stringify({ BROWSE_STATE_FILE: config.stateFile, BROWSE_PARENT_PID: parentPid, ...(extraEnv || {}) });
    // The daemon's real process is spawned inside the launcher's own
    // `node -e` invocation, not in cli.ts's process — so the log file has
    // to be opened from inside the launcher string too; an fd opened here
    // in cli.ts wouldn't cross the spawn boundary. Falls back to 'ignore'
    // the same way openDaemonLogSink() does if the state dir isn't writable.
    const daemonLogPathStr = JSON.stringify(daemonLogPath());
    const launcherCode =
      `const{spawn}=require('child_process');` +
      `const fs=require('fs');` +
      `let logFd;try{logFd=fs.openSync(${daemonLogPathStr},'a');}catch(e){logFd='ignore';}` +
      `spawn(process.execPath,[${JSON.stringify(NODE_SERVER_SCRIPT)}],` +
      `{detached:true,windowsHide:true,stdio:['ignore',logFd,logFd],env:Object.assign({},process.env,` +
      `${extraEnvStr})}).unref()`;
    Bun.spawnSync([nodeRuntime, '-e', launcherCode], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  } else {
    // macOS/Linux: Bun.spawn().unref() only removes the child from Bun's event
    // loop — it does NOT call setsid(), so the spawned server stays in the
    // parent's process session. When the CLI runs inside a session-managed
    // shell (e.g. the host's per-command Bash sandbox, Conductor, CI
    // step runners), the session leader's exit sends SIGHUP to every PID in
    // the session, killing the bun server (and its Chromium grandchildren).
    // Even with BROWSE_PARENT_PID=0 disabling the watchdog, SIGHUP still
    // reaps the server. Use Node's child_process.spawn with detached:true,
    // which calls setsid() so the server becomes its own session leader
    // (PPID=1, STAT=Ss) and survives the spawning shell's exit. Mirrors
    // the Windows path's rationale — same root cause, different OS API.
    const daemonLogFd = openDaemonLogSink();
    nodeSpawn('bun', ['run', SERVER_SCRIPT], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', daemonLogFd, daemonLogFd],
      env: { ...process.env, BROWSE_STATE_FILE: config.stateFile, BROWSE_PARENT_PID: parentPid, ...extraEnv },
    }).unref();
  }

  // Wait for server to become healthy.
  // Use HTTP health check (not isProcessAlive) — it's fast (~instant ECONNREFUSED)
  // and works reliably on all platforms including Windows.
  const start = Date.now();
  while (Date.now() - start < MAX_START_WAIT) {
    const state = readState();
    if (state && await isServerHealthy(state.port)) {
      return state;
    }
    await Bun.sleep(100);
  }

  // One last check before declaring failure. The daemon is detached + unref'd,
  // so on a loaded machine it can become healthy in the gap between the poll
  // loop's final tick and now — the probe timed out, the launch did not
  // (#1846). Re-checking here turns that false negative into a success, and
  // mirrors the post-loop recovery already done in ensureServer(). A genuinely
  // failed server is still unhealthy, so this falls through to the error report.
  const lateState = readState();
  if (lateState && await isServerHealthy(lateState.port)) {
    return lateState;
  }

  // Server didn't start in time — check the on-disk startup error log.
  // Both platforms now spawn with stdio: 'ignore', so the server writes
  // errors to disk for the CLI to read (see server.ts start().catch).
  const errorLogPath = path.join(config.stateDir, 'browse-startup-error.log');
  try {
    const errorLog = fs.readFileSync(errorLogPath, 'utf-8').trim();
    if (errorLog) {
      throw new Error(`Server failed to start:\n${errorLog}`);
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
  throw new Error(`Server failed to start within ${MAX_START_WAIT / 1000}s`);
}

export class ServerLockError extends Error {
  code: string;
  constructor(code: string, lockPath: string, cause: string) {
    super(`E_SERVER_LOCK (${code}): cannot acquire ${lockPath} — ${cause}`);
    this.name = 'ServerLockError';
    this.code = code;
  }
}

/**
 * Acquire an exclusive lockfile to prevent concurrent ensureServer() races (TOCTOU).
 * Returns a cleanup function that releases the lock, or null when another
 * LIVE process genuinely holds the lock (real contention).
 *
 * Error honesty (#1084): only EEXIST is contention. ENOENT (state dir
 * missing) self-heals with one mkdir retry; every other errno (EACCES,
 * ENOSPC, ...) throws ServerLockError with the real errno instead of
 * reporting phantom "another process holds the lock" contention forever.
 */
export function acquireServerLock(
  lockPath: string = `${config.stateFile}.lock`,
  depth = 0,
): (() => void) | null {
  try {
    // 'wx' — create exclusively, fails if file already exists (atomic check-and-create)
    // Using string flag instead of numeric constants for Bun Windows compatibility
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    return () => { safeUnlink(lockPath); };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      // Lock dir missing — create it and retry once.
      if (depth >= 1) throw new ServerLockError('ENOENT', lockPath, 'lock directory could not be created');
      mkdirSecure(path.dirname(lockPath));
      return acquireServerLock(lockPath, depth + 1);
    }
    if (err?.code !== 'EEXIST') {
      throw new ServerLockError(err?.code || 'UNKNOWN', lockPath, err?.message || String(err));
    }
    // EEXIST — real contention. Check if the holder is still alive.
    // Depth cap 5 bounds the stale-lock unlink/retry livelock.
    try {
      const holderPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
      if (holderPid && isProcessAlive(holderPid)) {
        return null; // Another live process holds the lock
      }
      // Stale lock — remove and retry
      fs.unlinkSync(lockPath);
      if (depth >= 5) return null;
      return acquireServerLock(lockPath, depth + 1);
    } catch (readErr: any) {
      if (readErr?.code === 'ENOENT') {
        // Lock vanished between open and read (holder released) — retry.
        if (depth >= 5) return null;
        return acquireServerLock(lockPath, depth + 1);
      }
      throw new ServerLockError(readErr?.code || 'UNKNOWN', lockPath, readErr?.message || String(readErr));
    }
  }
}

async function ensureServer(flags?: GlobalFlags): Promise<ServerState> {
  const state = readState();
  const desiredHash = flags?.configHash;
  const extraEnv: Record<string, string> = {};
  if (flags?.proxyUrl) extraEnv.BROWSE_PROXY_URL = flags.proxyUrl;
  if (flags?.headed) extraEnv.BROWSE_HEADED = '1';
  if (desiredHash) extraEnv.BROWSE_CONFIG_HASH = desiredHash;

  // Health-check-first: HTTP is definitive proof the server is alive and responsive.
  // This replaces the PID-gated approach which breaks on Windows (Bun's process.kill
  // always throws ESRCH for Windows PIDs in compiled binaries).
  //
  // #2219: when the single 2s probe fails but the PID is alive, extend to the
  // bounded ~8s probe before concluding anything — a daemon chewing a heavy
  // page is busy, not dead, and killing it loses the session.
  const daemonPidAlive = Boolean(state?.pid && isProcessAlive(state.pid));
  if (state && (await isServerHealthy(state.port) || (daemonPidAlive && await probeHealthWithBackoff(state.port)))) {
    // D2 daemon-mismatch check: existing daemon's configHash must match the
    // CLI's resolved hash. If --proxy or --headed are passed and the existing
    // daemon was started with different config, refuse with a `disconnect`
    // hint. No silent restart — that would drop tab state, cookies, and
    // logged-in sessions without warning.
    if (desiredHash && state.configHash && state.configHash !== desiredHash) {
      console.error(`[browse] existing daemon has different config (proxy/headed mismatch).`);
      console.error(`[browse] run 'browse disconnect' first to apply --proxy/--headed.`);
      process.exit(1);
    }
    // Same path: existing daemon is plain (no flags) but caller passes
    // --proxy/--headed. Refuse for the same reason — apply explicitly via
    // disconnect+reconnect.
    if (desiredHash && !state.configHash && (flags?.proxyUrl || flags?.headed)) {
      console.error(`[browse] existing daemon was started without --proxy/--headed.`);
      console.error(`[browse] run 'browse disconnect' first to apply new flags.`);
      process.exit(1);
    }

    // Check for binary version mismatch (auto-restart on update)
    const currentVersion = readVersionHash();
    if (currentVersion && state.binaryVersion && currentVersion !== state.binaryVersion) {
      if (!await stopRecordedDaemonAndConfirm(state)) {
        throw new Error('[browse] Binary changed but the recorded daemon cannot be verified and stopped safely.');
      }
      console.error('[browse] Binary updated, restarting verified server...');
      return startServer(extraEnv);
    }
    return state;
  }

  // BROWSE_NO_AUTOSTART: agent-spawned children (e.g. the terminal-agent PTY
  // agent) set this so a child never spawns an invisible headless browser. If the headed server is down,
  // fail fast with a clear error instead of silently starting a new one.
  if (process.env.BROWSE_NO_AUTOSTART === '1') {
    console.error('[browse] Server not available and BROWSE_NO_AUTOSTART is set.');
    console.error('[browse] The headed browser may have been closed. Run /open-bfstack-browser to restart.');
    process.exit(1);
  }

  // Guard: never silently replace a headed server with a headless one.
  // Headed mode means a user-visible Chrome window is (or was) controlled.
  // Silently replacing it would be confusing — tell the user to reconnect.
  if (state && state.mode === 'headed' && isProcessAlive(state.pid)) {
    console.error(`[browse] Headed server running (PID ${state.pid}) but not responding.`);
    console.error(`[browse] Run '/open-bfstack-browser' to restart.`);
    process.exit(1);
  }

  // #2219 IRON RULE: never auto-kill an alive pid. The daemon didn't answer
  // /health within the bounded ~8s budget but its process is alive — that's
  // busy, not dead. Report + nonzero exit; only an explicit --force-restart
  // proceeds to the kill-and-restart below.
  if (state && daemonPidAlive) {
    if (flags?.forceRestart) {
      console.error('[browse] --force-restart: replacing live-but-unresponsive daemon (tabs/cookies/logins will be lost)...');
    } else {
      reportDaemonBusyAndExit(state.pid);
    }
  }

  // Ensure state directory exists before lock acquisition (lock file lives there)
  ensureStateDir(config);

  // Acquire lock to prevent concurrent restart races (TOCTOU)
  const releaseLock = acquireServerLock();
  if (!releaseLock) {
    // Another process is starting the server — wait for it
    console.error('[browse] Another instance is starting the server, waiting...');
    const start = Date.now();
    while (Date.now() - start < MAX_START_WAIT) {
      const freshState = readState();
      if (freshState && await isServerHealthy(freshState.port)) return freshState;
      await Bun.sleep(200);
    }
    throw new Error('Timed out waiting for another instance to start the server');
  }

  try {
    // Re-read state under lock in case another process just started the server
    const freshState = readState();
    if (freshState && await isServerHealthy(freshState.port)) {
      return freshState;
    }

    // Kill the old server to avoid orphaned chromium processes
    if (state && state.pid && !await stopRecordedDaemonAndConfirm(state)) {
      throw new Error('[browse] Existing daemon cannot be verified and stopped safely.');
    }
    if (flags?.redactedProxyUrl && flags.redactedProxyUrl !== '<no proxy>') {
      console.error(`[browse] Starting server with proxy ${flags.redactedProxyUrl}${flags.headed ? ' (headed)' : ''}...`);
    } else if (flags?.headed) {
      console.error('[browse] Starting server in headed mode...');
    } else {
      console.error('[browse] Starting server...');
    }
    return await startServer(extraEnv);
  } finally {
    releaseLock();
  }
}

/**
 * Extract `--tab-id <N>` from args and return { tabId, args } with the flag stripped.
 * Used by make-pdf's tab-scoped flow: every browse command (newtab, load-html, js,
 * pdf, closetab) can take `--tab-id <N>` to target a specific tab. Without this,
 * parallel `$P generate` calls would race on the active tab.
 */
export function extractTabId(args: string[]): { tabId: number | undefined; args: string[] } {
  const stripped: string[] = [];
  let tabId: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tab-id') {
      const next = args[++i];
      if (next === undefined) continue;
      const parsed = parseInt(next, 10);
      if (!isNaN(parsed)) tabId = parsed;
    } else {
      stripped.push(args[i]);
    }
  }
  return { tabId, args: stripped };
}

// ─── Command Dispatch ──────────────────────────────────────────
async function sendCommand(state: ServerState, command: string, args: string[], retries = 0): Promise<void> {
  // Precedence: CLI --tab-id flag > BROWSE_TAB env var.
  // make-pdf always passes --tab-id; human users typically rely on BROWSE_TAB
  // or the active tab.
  const extracted = extractTabId(args);
  args = extracted.args;
  const envTab = process.env.BROWSE_TAB;
  const tabId = extracted.tabId ?? (envTab ? parseInt(envTab, 10) : undefined);
  const body = JSON.stringify({ command, args, ...(tabId !== undefined && !isNaN(tabId) ? { tabId } : {}) });

  try {
    const resp = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });

    if (resp.status === 401) {
      // Token mismatch — server may have restarted
      console.error('[browse] Auth failed — server may have restarted. Retrying...');
      const newState = readState();
      if (newState && newState.token !== state.token) {
        return sendCommand(newState, command, args);
      }
      throw new Error('Authentication failed');
    }

    const text = await resp.text();

    if (resp.ok) {
      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
    } else {
      // Try to parse as JSON error
      try {
        const err = JSON.parse(text);
        console.error(err.error || text);
        if (err.hint) console.error(err.hint);
      } catch {
        console.error(text);
      }
      process.exit(1);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // #1781: a 30s timeout on a heavy page usually means busy, not dead.
      // Don't kill a live server (that's what triggered the crash-loop) — report
      // and exit so the user can retry rather than losing their (headed) window.
      const ts = readState();
      const alive = ts?.pid ? isProcessAlive(ts.pid) : false;
      console.error(alive
        ? '[browse] Command timed out after 30s (server still alive — busy, not restarting). Retry, or raise load.'
        : '[browse] Command timed out after 30s');
      process.exit(1);
    }
    // Connection error — server may have crashed, OR may just be busy.
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.message?.includes('fetch failed')) {
      const oldState = readState();
      // #1781/#2219 busy-vs-dead: a single-threaded daemon under beacon/
      // extension load (or with a timed-out navigation still churning) can
      // stop answering HTTP for seconds while fully alive. Give /health a
      // bounded ~8s to recover, then decide via the pure rule: retry against
      // the same daemon, report busy (NEVER kill an alive pid), or restart a
      // genuinely dead one. Only --force-restart may kill a live daemon.
      const pidAlive = Boolean(oldState?.pid && isProcessAlive(oldState.pid));
      const healthyAfterProbe = pidAlive ? await probeHealthWithBackoff(oldState!.port) : false;
      const action = decideDaemonRestart({
        pidAlive,
        healthyAfterProbe,
        forceRestart: Boolean(_globalFlags?.forceRestart),
      });
      if (action === 'retry-command') {
        if (retries >= 1) throw new Error('[browse] Server unresponsive after retry — aborting');
        console.error('[browse] Server was briefly unresponsive (busy); retrying command...');
        return sendCommand(oldState!, command, args, retries + 1);
      }
      if (action === 'report-busy') {
        reportDaemonBusyAndExit(oldState!.pid);
      }
      // #2254: `stop` against a daemon that died mid-flight is SUCCESS — the
      // desired end state (no daemon) already holds. Restarting a daemon just
      // to stop it again was the crash-restart loop the issue reports.
      if (action === 'restart-dead' && command === 'stop') {
        if (!oldState || !belongsToStateFile(oldState.daemonIdentity, config.stateFile)) {
          throw new Error('[browse] Stale daemon state lacks a verified owner record; refusing automatic cleanup.');
        }
        await cleanupVerifiedBrowserResources(oldState);
        safeUnlinkQuiet(config.stateFile);
        console.log('Daemon already stopped (cleaned stale state).');
        process.exit(0);
      }
      // 'restart-dead' or explicit 'force-restart' → restart.
      if (retries >= 1) throw new Error('[browse] Server crashed twice in a row — aborting');
      if (action === 'force-restart') {
        console.error('[browse] --force-restart: killing live daemon and restarting (tabs/cookies/logins will be lost)...');
      } else {
        console.error('[browse] Server connection lost. Restarting...');
      }
      if (oldState && oldState.pid && isProcessAlive(oldState.pid) && !await stopRecordedDaemonAndConfirm(oldState)) {
        throw new Error('[browse] Existing daemon cannot be verified and stopped safely.');
      }
      // startServer() now clears the Chromium SingletonLock + reaps the orphan,
      // so the relaunch isn't blocked by the dead Chromium's profile lock (#1781).
      //
      // Reapply --proxy / --headed when restarting. headed comes from THIS
      // invocation OR the persisted server mode, so a restart triggered by a
      // plain command (goto/status, no --headed) never silently downgrades a
      // headed session to headless (#1781). Same for proxy/configHash.
      const restartEnv = buildRestartEnv(_globalFlags, oldState);
      const newState = await startServer(Object.keys(restartEnv).length ? restartEnv : undefined);
      return sendCommand(newState, command, args, retries + 1);
    }
    throw err;
  }
}

// Module-level reference to the resolved global flags from main(). Used by
// sendCommand's crash-retry path so a daemon restart after ECONNRESET doesn't
// silently drop --proxy / --headed.
let _globalFlags: GlobalFlags | null = null;

export interface GlobalFlags {
  /** Cleaned argv with --proxy/--headed stripped out. */
  args: string[];
  /** Resolved BROWSE_PROXY_URL (with creds embedded) or null. */
  proxyUrl: string | null;
  /** Whether --headed was passed. */
  headed: boolean;
  /** Hash of (proxy + headed) for daemon-mismatch check. */
  configHash: string;
  /** Redacted form of proxyUrl, safe for logs. */
  redactedProxyUrl: string;
  /** Whether --force-restart was passed (#2219): the ONLY thing that may
   * kill a live-but-unresponsive daemon. */
  forceRestart: boolean;
}

/**
 * Strip the global --proxy and --headed flags from args, validate cred policy,
 * and return the resolved config. Exits 1 with a clear hint on policy
 * violations (D9 cred mixing, malformed URL, unsupported scheme).
 *
 * Exported for unit tests.
 */
export function extractGlobalFlags(rawArgs: string[], env: NodeJS.ProcessEnv): GlobalFlags {
  const out: string[] = [];
  let proxyUrl: string | null = null;
  let headed = false;
  let forceRestart = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--force-restart') { forceRestart = true; continue; }
    if (arg === '--proxy') {
      const value = rawArgs[i + 1];
      if (!value) {
        throw new ProxyConfigError(
          'usage: --proxy <scheme://[user:pass@]host:port>',
          '--proxy requires a URL value',
        );
      }
      proxyUrl = value;
      i++;
      continue;
    }
    if (arg.startsWith('--proxy=')) {
      proxyUrl = arg.slice('--proxy='.length);
      continue;
    }
    if (arg === '--headed') { headed = true; continue; }
    out.push(arg);
  }

  // Compose the canonical proxyUrl with creds resolved from argv+env.
  let canonicalProxyUrl: string | null = null;
  if (proxyUrl) {
    const parsed = parseProxyConfig({
      proxyUrl,
      envUser: env.BROWSE_PROXY_USER,
      envPass: env.BROWSE_PROXY_PASS,
    });
    // Re-encode with resolved creds embedded (server reads BROWSE_PROXY_URL
    // from env — env passes to child process safely without ps-aux exposure).
    const rebuilt = new URL(proxyUrl);
    rebuilt.username = parsed.userId ? encodeURIComponent(parsed.userId) : '';
    rebuilt.password = parsed.password ? encodeURIComponent(parsed.password) : '';
    canonicalProxyUrl = rebuilt.toString();
  }

  return {
    args: out,
    proxyUrl: canonicalProxyUrl,
    headed,
    configHash: computeConfigHash({ proxyUrl: canonicalProxyUrl, headed }),
    redactedProxyUrl: redactProxyUrl(canonicalProxyUrl),
    forceRestart,
  };
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const rawArgs = process.argv.slice(2);

  // ─── Global flags (--proxy, --headed) ───────────────────────
  // Extract before command dispatch so they apply to any command. Throws
  // ProxyConfigError on invalid URL or D9 cred-mixing violations.
  let globalFlags: GlobalFlags;
  try {
    globalFlags = extractGlobalFlags(rawArgs, process.env);
  } catch (err) {
    if (err instanceof ProxyConfigError) {
      console.error(`[browse] error: ${err.message}`);
      console.error(`[browse] hint: ${err.hint}`);
      process.exit(1);
    }
    throw err;
  }
  _globalFlags = globalFlags;
  const args = globalFlags.args;

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`bfstack browse — Fast headless browser for AI coding agents

Usage: browse <command> [args...]

Navigation:     goto <url> | back | forward | reload | url
Content:        text | html [sel] | links | forms | accessibility
Interaction:    click <sel> | fill <sel> <val> | select <sel> <val>
                hover <sel> | type <text> | press <key>
                scroll [sel] | wait <sel|--networkidle|--load> | viewport <WxH>
                upload <sel> <file1> [file2...]
Inspection:     js <expr> | eval <file> | css <sel> <prop> | attrs <sel>
                console [--clear|--errors] | network [--clear] | dialog [--clear]
                cookies | storage [set <k> <v>] | perf
                is <prop> <sel> (visible|hidden|enabled|disabled|checked|editable|focused)
Visual:         screenshot [--viewport] [--clip x,y,w,h] [@ref|sel] [path]
                pdf [path] | responsive [prefix]
Snapshot:       snapshot [-i] [-c] [-d N] [-s sel] [-D] [-a] [-o path] [-C]
                -D/--diff: diff against previous snapshot
                -a/--annotate: annotated screenshot with ref labels
                -C/--cursor-interactive: find non-ARIA clickable elements
Compare:        diff <url1> <url2>
Multi-step:     chain (reads JSON from stdin)
Tabs:           tabs | tab <id> | newtab [url] | closetab [id]
Server:         status | cookie <n>=<v> | header <n>:<v>
                useragent <str> | stop | restart
                --force-restart: replace a live-but-busy daemon (any command;
                LOSES tabs/cookies/logins — never done automatically)
Dialogs:        dialog-accept [text] | dialog-dismiss

Refs:           After 'snapshot', use @e1, @e2... as selectors:
                click @e3 | fill @e4 "value" | hover @e1
                @c refs from -C: click @c1`);
    process.exit(0);
  }

  // One-time cleanup of legacy /tmp state files
  const command = args[0];
  const commandArgs = args.slice(1);

  // ─── Headed Connect (pre-server command) ────────────────────
  // connect must be handled BEFORE ensureServer() because it needs
  // to restart the server in headed mode with the Chrome extension.
  if (command === 'connect') {
    // Check if already in headed mode and healthy
    const existingState = readState();
    if (existingState && existingState.mode === 'headed' && isProcessAlive(existingState.pid)) {
      try {
        const resp = await fetch(`http://127.0.0.1:${existingState.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) {
          console.log('Already connected in headed mode.');
          process.exit(0);
        }
      } catch {
        // Headed server alive but not responding — handled below (#2219:
        // busy semantics; only --force-restart may kill it).
      }
    }

    // #2219 IRON RULE: a HEALTHY daemon survives connect. The old behavior
    // ("kill ANY existing server") silently destroyed a working headless
    // session — tabs, cookies, logins — whenever someone opened the headed
    // browser. A live daemon is only replaced with explicit consent.
    if (existingState && isProcessAlive(existingState.pid) && !globalFlags.forceRestart) {
      if (await isServerHealthy(existingState.port)) {
        refuseHeadedOverLiveDaemon(existingState);
      }
      // Alive but unhealthy after the bounded probe → busy, not dead.
      if (await probeHealthWithBackoff(existingState.port)) {
        refuseHeadedOverLiveDaemon(existingState);
      }
      reportDaemonBusyAndExit(existingState.pid);
    }

    // Explicit force restart may only replace the daemon captured in this
    // state file. A PID alone never authorizes a stop.
    if (existingState && isProcessAlive(existingState.pid)) {
      console.error('[browse] --force-restart: replacing live daemon (tabs/cookies/logins will be lost)...');
      if (!await stopRecordedDaemonAndConfirm(existingState)) {
        throw new Error('[browse] Existing daemon cannot be verified and stopped safely.');
      }
    }
    if (existingState && !isProcessAlive(existingState.pid)) {
      if (!belongsToStateFile(existingState.daemonIdentity, config.stateFile)) {
        throw new Error('[browse] Existing daemon state lacks a verified owner record; refusing automatic cleanup.');
      }
      await cleanupVerifiedBrowserResources(existingState);
      safeUnlinkQuiet(config.stateFile);
    }

    console.log('Launching headed Chromium with extension...');
    try {
      // Start server in headed mode with extension auto-loaded
      // Use a well-known port so the Chrome extension auto-connects
      const requestedPort = process.env.BROWSE_PORT || '34567';
      if (!/^\d+$/.test(requestedPort) || Number(requestedPort) < 1024 || Number(requestedPort) > 65535) {
        throw new Error('[browse] BROWSE_PORT must be an integer between 1024 and 65535.');
      }
      const serverEnv: Record<string, string> = {
        BROWSE_HEADED: '1',
        BROWSE_PORT: requestedPort,
        // Disable parent-process watchdog: the user controls the headed browser
        // window lifecycle. The CLI exits immediately after connect, so watching
        // it would kill the server ~15s later. Cleanup happens via browser
        // disconnect event or $B disconnect.
        BROWSE_PARENT_PID: '0',
        // Apply --proxy from this invocation if present. Without this,
        // `browse --proxy <url> connect` would launch headed Chromium
        // bypassing the SOCKS bridge entirely.
        ...(globalFlags.proxyUrl ? { BROWSE_PROXY_URL: globalFlags.proxyUrl } : {}),
        ...(globalFlags.configHash ? { BROWSE_CONFIG_HASH: globalFlags.configHash } : {}),
      };
      const newState = await startServer(serverEnv);

      // Print connected status
      const resp = await fetch(`http://127.0.0.1:${newState.port}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${newState.token}`,
        },
        body: JSON.stringify({ command: 'status', args: [] }),
        signal: AbortSignal.timeout(5000),
      });
      const status = await resp.text();
      console.log(`Connected to real Chrome\n${status}`);
      // #1781: surface the window — it often opens behind/on another Space.
      raiseHeadedWindowMacOS();
      if (process.platform === 'darwin') {
        console.log('(If you still don\'t see it, check Mission Control / other Spaces.)');
      }

    } catch (err: any) {
      console.error(`[browse] Connect failed: ${err.message}`);
      process.exit(1);
    }

    // ─── Outer Supervisor (v1.44+, opt-in) ──────────────────────────
    //
    // Default: fire-and-forget (CLI exits, server runs detached). This is
    // the contract every existing call site relies on, including the agent
    // Code's Bash tool which expects `$B connect` to return promptly.
    //
    // Opt-in via `--supervise` flag or BROWSE_SUPERVISE=1 env: the CLI
    // stays attached, polls the spawned server's PID every 30s, and
    // respawns it through the same headed-mode startServer path on
    // unexpected exit. Crash-loop guard: 5 respawns inside 5 min →
    // give up and exit 1 with a clear error. SIGINT / SIGTERM cleanly
    // tear down the supervised server before exit.
    //
    // Out of scope for v1.44 minimum: routing the Chromium-disconnect
    // exit-code-1 path back through this supervisor. The terminal-agent
    // watchdog (T5) already covers the highest-frequency restart case;
    // Chromium-crash-respawn is documented as a follow-up so the
    // supervisor stays a tight, testable primitive.
    const superviseRequested = commandArgs.includes('--supervise')
      || process.env.BROWSE_SUPERVISE === '1';
    if (!superviseRequested) {
      process.exit(0);
    }
    console.log('[browse] Supervisor mode: monitoring server. Ctrl-C to stop.');
    let supervisorExiting = false;
    const teardownAndExit = async (signal: string) => {
      if (supervisorExiting) return;
      supervisorExiting = true;
      console.log(`\n[browse] ${signal} received — stopping server.`);
      const state = readState();
      if (state?.pid && isProcessAlive(state.pid)) {
        if (!await stopRecordedDaemonAndConfirm(state)) {
          console.error('[browse] Supervisor left an unverified daemon untouched.');
        }
      }
      process.exit(0);
    };
    process.on('SIGINT', () => { void teardownAndExit('SIGINT'); });
    process.on('SIGTERM', () => { void teardownAndExit('SIGTERM'); });

    const SUPERVISOR_TICK_MS = parseInt(
      process.env.BFSTACK_SUPERVISOR_TICK_MS || '30000',
      10,
    );
    const SUPERVISOR_GUARD_WINDOW_MS = 5 * 60_000;
    const SUPERVISOR_GUARD_MAX = 5;
    const SUPERVISOR_BACKOFF_MS = (process.env.BFSTACK_SUPERVISOR_BACKOFF || '1000,2000,4000,8000,30000')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
    const respawns: number[] = [];

    while (!supervisorExiting) {
      await new Promise(resolve => setTimeout(resolve, SUPERVISOR_TICK_MS));
      if (supervisorExiting) break;
      const state = readState();
      if (state?.pid && isProcessAlive(state.pid)) continue;
      // Server died. Prune rolling window and check guard.
      const now = Date.now();
      while (respawns.length && now - respawns[0] > SUPERVISOR_GUARD_WINDOW_MS) {
        respawns.shift();
      }
      if (respawns.length >= SUPERVISOR_GUARD_MAX) {
        console.error(
          `[browse] Supervisor: ${SUPERVISOR_GUARD_MAX} crashes in ${SUPERVISOR_GUARD_WINDOW_MS / 1000}s — giving up.`,
        );
        process.exit(1);
      }
      const attempt = respawns.length;
      respawns.push(now);
      const backoff = SUPERVISOR_BACKOFF_MS[Math.min(attempt, SUPERVISOR_BACKOFF_MS.length - 1)] ?? 30_000;
      console.warn(`[browse] Supervisor: server PID gone — respawning in ${backoff}ms (attempt ${attempt + 1}/${SUPERVISOR_GUARD_MAX})...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      if (supervisorExiting) break;
      try {
        const respawned = await startServer(serverEnv);
        console.log(`[browse] Supervisor: server respawned (PID ${respawned.pid}, port ${respawned.port}).`);
      } catch (err: any) {
        console.error(`[browse] Supervisor: server respawn failed: ${err?.message || err}`);
        // Let the next tick try again — the crash-loop guard already
        // bounded the retries via the rolling window.
      }
    }
    process.exit(0);
  }

  // ─── Headed Disconnect (pre-server command) ─────────────────
  // disconnect must be handled BEFORE ensureServer() because the headed
  // guard blocks all commands when the server is unresponsive.
  if (command === 'disconnect') {
    const existingState = readState();
    // disconnect applies when there's a non-default daemon — headed mode OR
    // any custom config (--proxy/--headed) recorded as configHash. Plain
    // headless daemons should use 'stop' instead.
    const hasCustomConfig = existingState && (existingState.mode === 'headed' || existingState.configHash);
    if (!existingState || !hasCustomConfig) {
      console.log('Not in headed/custom-config mode — nothing to disconnect.');
      process.exit(0);
    }
    if (!isVerifiedDaemonState(existingState)) {
      throw new Error('[browse] Daemon cannot be verified before disconnect; leaving it untouched.');
    }
    // For headed-mode daemons: try graceful shutdown via the server's
    // /command endpoint. For proxy-only / custom-config daemons (no headed
    // mode), the server's `disconnect` handler currently only tears down
    // headed state — it returns 200 "Not in headed mode" without cleaning
    // up the bridge or Xvfb. So we skip the graceful path for those and
    // jump straight to force-cleanup, which kills the daemon process and
    // lets process.on('exit') in server.ts close the bridge + Xvfb.
    if (existingState.mode === 'headed') {
      try {
        const resp = await fetch(`http://127.0.0.1:${existingState.port}/command`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${existingState.token}`,
          },
          body: JSON.stringify({ command: 'disconnect', args: [] }),
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          console.log('Disconnected from real browser.');
          process.exit(0);
        }
      } catch {
        // Server not responding — fall through to force cleanup
      }
    }
    if (!await stopRecordedDaemonAndConfirm(existingState)) {
      throw new Error('[browse] Daemon cannot be verified and disconnected safely.');
    }
    // Xvfb orphan cleanup: if the recorded PID still matches our Xvfb (by
    // cmdline AND start-time), kill it. PID-only would risk killing a
    // recycled PID belonging to an unrelated process.
    if (existingState.xvfbPid && existingState.xvfbStartTime) {
      try {
        const { cleanupXvfb } = await import('./xvfb');
        cleanupXvfb({
          pid: existingState.xvfbPid,
          startTime: existingState.xvfbStartTime,
          display: existingState.xvfbDisplay || ':99',
        });
      } catch {
        // Best effort — Linux-only module on a non-Linux disconnect may
        // not load; cleanup is best-effort anyway.
      }
    }
    safeUnlinkQuiet(config.stateFile);
    console.log('Disconnected (server was unresponsive — force cleaned).');
    process.exit(0);
  }

  // ─── Stop (pre-server short-circuit, #2254) ──────────────────
  // stop must be handled BEFORE ensureServer(): stopping a daemon that is
  // not running must not START one just to stop it. The old flow booted a
  // fresh daemon + Chromium (multi-second, resource churn) and then told it
  // to shut down — or crashed trying. No state, or dead pid + dead port →
  // report "nothing to stop" and exit 0.
  if (command === 'stop') {
    const stopState = readState();
    if (!stopState) {
      console.log('No daemon running — nothing to stop.');
      process.exit(0);
    }
    if (!isProcessAlive(stopState.pid) && !(await isServerHealthy(stopState.port))) {
      // The daemon died abruptly (SIGKILL, crash) — the likeliest orphan case.
      // Reap the recorded headless Chromium BEFORE destroying the state file,
      // which is the only carrier of its identity (#2709).
      if (!belongsToStateFile(stopState.daemonIdentity, config.stateFile)) {
        throw new Error('[browse] Stale daemon state lacks a verified owner record; refusing automatic cleanup.');
      }
      await cleanupVerifiedBrowserResources(stopState);
      safeUnlinkQuiet(config.stateFile);
      console.log('No daemon running (cleaned stale state) — nothing to stop.');
      process.exit(0);
    }
    // stop --force-restart on a LIVE daemon (healthy or busy): kill it and
    // clean up right here. Falling through would hand ensureServer() the
    // force-restart flag, which kills the daemon and then BOOTS A FRESH ONE
    // (daemon + Chromium, multi-second churn) just so sendCommand('stop')
    // can shut it down again. The desired end state is "no daemon"; get there
    // directly.
    if (isProcessAlive(stopState.pid) && globalFlags.forceRestart) {
      if (!await stopRecordedDaemonAndConfirm(stopState)) {
        throw new Error('[browse] Daemon cannot be verified and stopped safely.');
      }
      safeUnlinkQuiet(config.stateFile);
      console.log('Daemon stopped (forced — tabs/cookies/logins discarded).');
      process.exit(0);
    }
    // Live daemon without --force-restart → fall through to the normal
    // sendCommand('stop') path (graceful shutdown; busy semantics apply).
  }

  // Special case: chain reads from stdin
  if (command === 'chain' && commandArgs.length === 0) {
    const stdin = await Bun.stdin.text();
    commandArgs.push(stdin.trim());
  }

  let state = await ensureServer(globalFlags);

  // A normal stop is an authenticated request to the live daemon. Process
  // identity is still required for every direct OS termination above.
  await sendCommand(state, command, commandArgs);

  // #2709: after a graceful stop, the daemon has closed Chromium via
  // Playwright — but on macOS 26 the GPU process can survive that close and
  // spin at ~800% CPU forever. The state snapshot read above still carries
  // the launched child's identity; reap a verified survivor.
  if (command === 'stop') {
    await reapRecordedChromium(state);
  }

  // #1781: `focus` means "show me the window". The server-side focus activates
  // the page via CDP, but on macOS the app can still sit on another Space — pull
  // it to the user's current Space too.
  if (command === 'focus') raiseHeadedWindowMacOS();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[browse] ${err.message}`);
    process.exit(1);
  });
}
