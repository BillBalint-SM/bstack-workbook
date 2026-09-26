/**
 * bfstack browse server — persistent Chromium daemon
 *
 * Architecture:
 *   Bun.serve HTTP on localhost → routes commands to Playwright
 *   Console/network/dialog buffers: CircularBuffer in-memory + async disk flush
 *   Chromium crash → server EXITS with clear error (CLI auto-restarts)
 *   Auto-shutdown after BROWSE_IDLE_TIMEOUT (default 30 min)
 *
 * State:
 *   State file: <project-root>/.bfstack/browse.json (set via BROWSE_STATE_FILE env)
 *   Log files:  <project-root>/.bfstack/browse-{console,network,dialog}.log
 *   Port:       random 10000-60000 (or BROWSE_PORT env for debug override)
 */

import { BrowserManager, InspectorTargetError, markDaemonProcess } from './browser-manager';
import { handleReadCommand, hasOutArg } from './read-commands';
import { handleWriteCommand } from './write-commands';
import { handleMetaCommand } from './meta-commands';
import { COMMAND_DESCRIPTIONS, PAGE_CONTENT_COMMANDS, DOM_CONTENT_COMMANDS, wrapUntrustedContent, canonicalizeCommand, buildUnknownCommandError, ALL_COMMANDS } from './commands';
import {
  wrapUntrustedPageContent, datamarkContent,
  runContentFilters, type ContentFilterResult,
  markHiddenElements, getCleanTextWithStripping, cleanupHiddenMarkers,
} from './content-security';
import { writeSecureFile, mkdirSecure, appendSecureFile } from './file-permissions';
import { handleSnapshot, SNAPSHOT_FLAGS } from './snapshot';
import {
  initRegistry, validateToken as validateScopedToken, checkScope, checkDomain,
  checkRate, createToken, revokeToken,
  listTokens, recordCommand,
  isRootToken, type TokenInfo,
  InvalidScopeError, ReservedClientIdError,
} from './token-registry';
import { validateTempPath } from './path-security';
import { resolveBfstackHome, resolveConfig, ensureStateDir, readVersionHash, resolveChromiumProfile, cleanSingletonLocks } from './config';
import {
  isSessionPersistEnabled, persistSessionState, restoreSessionState,
  sessionPersistIntervalMs, SESSION_STATE_FILE,
} from './session-persist';
import { emitActivity, subscribe, getActivityAfter, getActivityHistory, getSubscriberCount } from './activity';
import { createSseEndpoint } from './sse-helpers';
import { initAuditLog, writeAuditEntry } from './audit';
import { inspectTargetElement, modifyStyle, resetModifications, getModificationHistory, detachSession, type InspectorResult } from './cdp-inspector';
import { captureProcessIdentity } from './process-identity';
// Bun.spawn used instead of child_process.spawn (compiled bun binaries
// fail posix_spawn on all executables including /bin/bash)
import { safeUnlink, safeUnlinkQuiet, safeKill } from './error-handling';
import {
  findAvailablePort, formatExplicitPortUnavailableError, formatRandomPortUnavailableError,
} from './port-allocator';
import { isProcessAlive } from './error-handling';
import { sanitizeBody, stripLoneSurrogateEscapes, stripLoneSurrogates, sanitizeReplacer } from './sanitize';
import { startSocksBridge, testUpstream, type BridgeHandle } from './socks-bridge';
import { parseProxyConfig, toUpstreamConfig, ProxyConfigError } from './proxy-config';
import { redactProxyUrl } from './proxy-redact';
import { shouldSpawnXvfb, pickFreeDisplay, spawnXvfb, xvfbInstallHint, type XvfbHandle } from './xvfb';
import {
  mintSseSessionToken, validateSseSessionToken, extractSseCookie,
  buildSseSetCookie, SSE_COOKIE_NAME,
} from './sse-session-cookie';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Unicode Sanitization ───────────────────────────────────────
// Unpaired UTF-16 surrogate halves (\uD800–\uDFFF) in page DOM text, OCR
// output, and other CDP-sourced strings are rejected by JSON consumers
// downstream (Anthropic API in particular: "no low surrogate in string").
// The sanitizers live in sanitize.ts (single source of truth, shared with
// sse-helpers.ts and the read/snapshot pipeline): `stripLoneSurrogates`
// replaces lone halves with U+FFFD (valid pairs like emoji survive), and
// `sanitizeReplacer` runs it on every string value inside JSON.stringify.
//
// INVARIANT: every server egress path that ships page-content strings MUST
// route through the sanitizer. handleCommandInternal wraps the final
// cr.result string (text/plain bodies carry lone surrogates verbatim;
// JSON.stringify already escapes them). The SSE producers stringify with
// `sanitizeReplacer` so payload string fields get cleaned BEFORE escaping.
// Plain post-stringify regex is a no-op there because JSON.stringify
// converts \uD800 → "\\ud800" — the regex can't see the surrogate after
// that point.

// ─── Config ─────────────────────────────────────────────────────
const config = resolveConfig();
ensureStateDir(config);
initAuditLog(config.auditLog);

// ─── Auth ───────────────────────────────────────────────────────
// activeShutdown points to the factory-scoped shutdown function once
// buildFetchHandler has been called. Module-level timers (idle check, parent
// watchdog) and signal handlers route through activeShutdown so they close
// the cfg-provided browserManager rather than a stale module-level reference.
// Null before the first buildFetchHandler call, which is correct: nothing to
// shut down yet.
let activeShutdown: ((code?: number) => Promise<void>) | null = null;

// AUTH_TOKEN is injectable via process.env.AUTH_TOKEN so embedders
// (gbrowser's gbd daemon spawn) can pre-allocate the token and hand it to
// the Bun child via env.
//
// Validation: require >= 16 chars after stripping ALL unicode whitespace
// (not just ASCII — .trim() misses U+200B / U+FEFF / U+00A0 / etc., which
// would otherwise let a misconfigured embedder ship a one-character BOM as
// the bearer secret). Reject tokens that are too short or contain only
// whitespace; fall back to randomUUID so the security boundary is never
// silently weakened by misconfiguration.
function sanitizeAuthToken(raw: string | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/[\s ​-‍﻿]/g, '');
  if (stripped.length < 16) return null;
  return stripped;
}
// AUTH_TOKEN const + module-level initRegistry call deleted in v1.35.0.0.
// buildFetchHandler now owns auth state end-to-end: cfg.authToken is the
// single source of truth, factory body calls initRegistry(cfg.authToken),
// and factory-scoped validateAuth closes over the same value. start() reads
// env once via resolveConfigFromEnv() and threads the result through.
const BROWSE_PORT = parseInt(process.env.BROWSE_PORT || '0', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.BROWSE_IDLE_TIMEOUT || '1800000', 10); // 30 min

/**
 * Port the local listener bound to. Set once the daemon picks a port.
 * Used by `$B skill run` to point spawned skill scripts at the daemon over
 * loopback. Module-level so handleCommandInternal can read it without threading
 * the port through every dispatch.
 */
let LOCAL_LISTEN_PORT: number = 0;
// Sidebar chat is always enabled in headed mode (ungated in v0.12.0)

/** Which HTTP listener accepted this request. */
export type Surface = 'local';

/**
 * Factory contract for embedders (gbrowser phoenix overlay).
 *
 * Today the CLI calls `start()` which reads env vars and binds Bun.serve
 * itself. Embedders building on this server as a submodule (gbrowser's
 * fd-passing gbd architecture) need to inject auth + ports + a
 * BrowserManager they pre-launched, and own the listener themselves.
 *
 * Status: v1 surfaces this type as documentation. AUTH_TOKEN env-injection
 * is already live (see ~L70). `start()` is exported and the kickoff /
 * signal-handler registration is gated on `import.meta.main`, so phoenix
 * can `import { start } from '.../server'` without auto-starting. Full
 * `buildFetchHandler` extraction lands in a follow-up; see plan
 * `C:/Example/plans/server-fetch-handler-extraction.md`
 * Part 1.
 */
export interface ServerConfig {
  /** Bearer token clients must present. Today injected via AUTH_TOKEN env. */
  authToken: string;
  /** Local listener port. Used in /welcome URL + state-file. */
  browsePort: number;
  /** Result of resolveConfig() — stateDir, auditLog, stateFile. */
  config: ReturnType<typeof resolveConfig>;
  /** Pre-launched BrowserManager. Caller owns lifecycle. */
  browserManager: BrowserManager;
  // NOTE: per-factory idleTimeoutMs and chromiumProfile were deleted — they
  // were documented but never read (the idle timer, activity state, and
  // shutdown target are module-global, so per-factory wiring would lie for
  // any embedder running >1 handler). Real support belongs to the deferred
  // server.ts singleton/route-table refactor. Until then: BROWSE_IDLE_TIMEOUT
  // and CHROMIUM_PROFILE env are the honest knobs.
  /** Caller-owned. shutdown() does NOT call xvfb.stop(); caller is responsible. */
  xvfb?: XvfbHandle | null;
  /** Caller-owned. shutdown() does NOT call proxyBridge.close(); caller is responsible. */
  proxyBridge?: BridgeHandle | null;
  startTime: number;
  /**
   * Overlay hook. Runs AFTER bfstack resolves auth and BEFORE route dispatch.
   * Invalid tokens are auto-rejected at the bfstack layer (401 returned
   * before hook fires), so the hook only ever sees valid TokenInfo or null
   * (no token presented). Returning a Response short-circuits bfstack
   * dispatch; returning null falls through.
   */
  beforeRoute?: (req: Request, surface: Surface, auth: TokenInfo | null) => Promise<Response | null>;
}

/**
 * Return shape of buildFetchHandler() — fetch handlers + lifecycle helpers
 * embedders need to drive their own Bun.serve binding. See ServerConfig.
 */
export interface ServerHandle {
  fetchLocal: (req: Request, server: any) => Promise<Response>;
  /**
   * Drains buffers, kills terminal-agent, closes browser, clears intervals,
   * removes state files. Does NOT stop bound Bun.Server listeners — call
   * stopListeners() for that. CLI relies on process.exit() to drop sockets.
   */
  shutdown: (exitCode?: number) => Promise<void>;
  /**
   * Graceful listener stop for embedders. Calls server.stop(true) on each
   * passed Bun.Server. CLI doesn't need this (process.exit handles it).
   */
  stopListeners: (local: any) => Promise<void>;
}

/**
 * Build a ServerConfig-shaped object from process.env. Used by bfstack's
 * own CLI when running `bun run dev` or the compiled binary directly.
 * Embedders construct their own ServerConfig explicitly.
 *
 * Reads env, calls resolveConfig(). Does NOT bind a listener or call
 * initAuditLog/initRegistry — those happen inside the buildFetchHandler
 * lifecycle.
 */
export function resolveConfigFromEnv(): Omit<ServerConfig, 'browserManager' | 'startTime'> & {
  config: ReturnType<typeof resolveConfig>;
} {
  return {
    // Same sanitizer as the module-level AUTH_TOKEN: strips ALL unicode
    // whitespace and rejects tokens shorter than 16 chars so a misconfigured
    // embedder can't ship a BOM/zero-width as the bearer secret.
    authToken: sanitizeAuthToken(process.env.AUTH_TOKEN) || crypto.randomUUID(),
    browsePort: parseInt(process.env.BROWSE_PORT || '0', 10),
    config: resolveConfig(),
  };
}

/**
 * The bfstack sidebar extension's pinned Chrome extension ID. Derived from
 * the "key" field in extension/manifest.json (first 16 bytes of SHA-256 of
 * the DER public key, hex nibbles mapped 0-9a-f → a-p). Reproduce with:
 *   bun browse/scripts/extension-id.ts
 * POST /extension-token releases AUTH_TOKEN only to an Origin of exactly
 * `chrome-extension://<this id>`. If the manifest keypair is ever rotated,
 * this constant must be updated in the same commit.
 */
export const BFSTACK_EXTENSION_ID = 'dgbkdbjebeiblbajiilljmhjdpmiglep';

// Module-level validateAuth deleted in v1.35.0.0. Factory-scoped equivalent
// in buildFetchHandler closes over cfg.authToken so every internal auth check
// sees the same token the routes receive.

/** Extract bearer token from request. Returns the token string or null. */
function extractToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/** Validate token and return TokenInfo. Returns null if invalid/expired. */
function getTokenInfo(req: Request): TokenInfo | null {
  const token = extractToken(req);
  if (!token) return null;
  return validateScopedToken(token);
}

/** Check if request is from root token (local use). */
function isRootRequest(req: Request): boolean {
  const token = extractToken(req);
  return token !== null && isRootToken(token);
}

// ─── Help text (auto-generated from COMMAND_DESCRIPTIONS) ────────
function generateHelpText(): string {
  // Group commands by category
  const groups = new Map<string, string[]>();
  for (const [cmd, meta] of Object.entries(COMMAND_DESCRIPTIONS)) {
    const display = meta.usage || cmd;
    const list = groups.get(meta.category) || [];
    list.push(display);
    groups.set(meta.category, list);
  }

  const categoryOrder = [
    'Navigation', 'Reading', 'Interaction', 'Inspection',
    'Visual', 'Snapshot', 'Meta', 'Tabs', 'Server',
  ];

  const lines = ['bfstack browse — headless browser for AI agents', '', 'Commands:'];
  for (const cat of categoryOrder) {
    const cmds = groups.get(cat);
    if (!cmds) continue;
    lines.push(`  ${(cat + ':').padEnd(15)}${cmds.join(', ')}`);
  }

  // Snapshot flags from source of truth
  lines.push('');
  lines.push('Snapshot flags:');
  const flagPairs: string[] = [];
  for (const flag of SNAPSHOT_FLAGS) {
    const label = flag.valueHint ? `${flag.short} ${flag.valueHint}` : flag.short;
    flagPairs.push(`${label}  ${flag.long}`);
  }
  // Print two flags per line for compact display
  for (let i = 0; i < flagPairs.length; i += 2) {
    const left = flagPairs[i].padEnd(28);
    const right = flagPairs[i + 1] || '';
    lines.push(`  ${left}${right}`);
  }

  return lines.join('\n');
}

// ─── Buffer (from buffers.ts) ────────────────────────────────────
import { consoleBuffer, networkBuffer, dialogBuffer, addConsoleEntry, addNetworkEntry, addDialogEntry, type LogEntry, type NetworkEntry, type DialogEntry } from './buffers';
export { consoleBuffer, networkBuffer, dialogBuffer, addConsoleEntry, addNetworkEntry, addDialogEntry, type LogEntry, type NetworkEntry, type DialogEntry };

const CONSOLE_LOG_PATH = config.consoleLog;
const NETWORK_LOG_PATH = config.networkLog;
const DIALOG_LOG_PATH = config.dialogLog;

/**
 * Per-process state-file temp path. The state-file write pattern is
 * `writeFileSync(tmp, ...) → renameSync(tmp, stateFile)` for atomicity,
 * but a shared `${stateFile}.tmp` filename means two concurrent writers
 * (cold-start race when N CLIs hit a fresh repo simultaneously, parallel
 * concurrent state writers) collide on the rename: the
 * first writer's renameSync moves the shared temp file out of the way,
 * the second writer's writeFileSync re-creates it, the second rename
 * then races with the first writer's already-renamed state. Worst case
 * the second renameSync throws ENOENT mid-air, killing one of the
 * spawning daemons during startup.
 *
 * Per-process suffix (pid + 4 random bytes) makes each writer's temp
 * path unique. The atomic rename still gives last-writer-wins semantics
 * for the final state.json content; the only behavior change is that
 * concurrent writers no longer kill each other on the rename.
 */
function tmpStatePath(): string {
  return `${config.stateFile}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
}


// ─── Sidebar agent / chat state ripped ──────────────────────────────
let lastConsoleFlushed = 0;
let lastNetworkFlushed = 0;
let lastDialogFlushed = 0;
let flushInProgress = false;

async function flushBuffers() {
  if (flushInProgress) return; // Guard against concurrent flush
  flushInProgress = true;

  try {
    // Console buffer
    const newConsoleCount = consoleBuffer.totalAdded - lastConsoleFlushed;
    if (newConsoleCount > 0) {
      const entries = consoleBuffer.last(Math.min(newConsoleCount, consoleBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.level}] ${e.text}`
      ).join('\n') + '\n';
      appendSecureFile(CONSOLE_LOG_PATH, lines);
      lastConsoleFlushed = consoleBuffer.totalAdded;
    }

    // Network buffer
    const newNetworkCount = networkBuffer.totalAdded - lastNetworkFlushed;
    if (newNetworkCount > 0) {
      const entries = networkBuffer.last(Math.min(newNetworkCount, networkBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] ${e.method} ${e.url} → ${e.status || 'pending'} (${e.duration || '?'}ms, ${e.size || '?'}B)`
      ).join('\n') + '\n';
      appendSecureFile(NETWORK_LOG_PATH, lines);
      lastNetworkFlushed = networkBuffer.totalAdded;
    }

    // Dialog buffer
    const newDialogCount = dialogBuffer.totalAdded - lastDialogFlushed;
    if (newDialogCount > 0) {
      const entries = dialogBuffer.last(Math.min(newDialogCount, dialogBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.type}] "${e.message}" → ${e.action}${e.response ? ` "${e.response}"` : ''}`
      ).join('\n') + '\n';
      appendSecureFile(DIALOG_LOG_PATH, lines);
      lastDialogFlushed = dialogBuffer.totalAdded;
    }
  } catch (err: any) {
    console.error('[browse] Buffer flush failed:', err.message);
  } finally {
    flushInProgress = false;
  }
}

// Flush every 1 second
const flushInterval = setInterval(flushBuffers, 1000);

// ─── Idle Timer ────────────────────────────────────────────────
let lastActivity = Date.now();

function resetIdleTimer() {
  lastActivity = Date.now();
}

// Named for behavioral testing via __testInternals__. The factory tests in
// server-factory.test.ts call this directly so the idle-shutdown path can be
// exercised without waiting 60s for the interval to fire.
function idleCheckTick() {
  // Headed mode: the user is looking at the browser. Never auto-die.
  // Only shut down when the user explicitly disconnects or closes the window.
  // Reads via the activeBrowserManager indirection so embedders that pass
  // their own BrowserManager into buildFetchHandler hit the right instance.
  if (activeBrowserManager.getConnectionMode() === 'headed') return;
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    console.log(`[browse] Idle for ${IDLE_TIMEOUT_MS / 1000}s, shutting down`);
    activeShutdown?.();
  }
}
const idleCheckInterval = setInterval(idleCheckTick, 60_000);

// Test-only surface for server-factory.test.ts. Lets the dual-instance
// idle-timer behavior be exercised deterministically without mutating
// Date.now (which would interact with the leaked module-level setInterval).
// Production code must never import this — see `idle timer + onDisconnect
// dual-instance fix` describe block for usage.
export const __testInternals__ = {
  idleCheckTick,
  // Watchdog seams (watchdog.test.ts): drive the 15s poll against an
  // arbitrary (dead) PID, trigger the handoff-promotion suppression exactly
  // as onHeadedPromotion does, and reset the latches between tests.
  parentWatchdogTick,
  suppressHeadedParentShutdown,
  resetParentWatchdogState: () => { headedParentShutdownSuppressed = false; parentGone = false; },
  setLastActivity: (t: number) => { lastActivity = t; },
  formatExplicitPortUnavailableError,
  formatRandomPortUnavailableError,
  // Reset the module-level shutdown latch so tests that drive shutdown to
  // completion (process.exit-stubbed) can be followed by tests that also
  // need shutdown to fire. Without this, the second test's shutdown
  // returns early at the `if (isShuttingDown) return;` guard.
  resetShutdownState: () => { isShuttingDown = false; },
};

// ─── Parent-Process Watchdog ────────────────────────────────────────
// When the spawning CLI process (e.g. a the host session) exits, this
// server can become an orphan — keeping chrome-headless-shell alive and
// causing console-window flicker on Windows. Poll the parent PID every 15s
// and self-terminate if it is gone.
//
// Headed mode (BROWSE_HEADED=1 or BROWSE_PARENT_PID=0): The user controls
// the browser window lifecycle. The CLI exits immediately after connect,
// so the watchdog would kill the server prematurely. Disabled in both cases
// as defense-in-depth — the CLI sets PID=0 for headed mode, and the server
// also checks BROWSE_HEADED in case a future launcher forgets.
// Cleanup happens via browser disconnect event or $B disconnect.
const BROWSE_PARENT_PID = parseInt(process.env.BROWSE_PARENT_PID || '0', 10);
// Outer gate: if the spawner explicitly marks this as headed (env var set at
// launch time), skip registering the watchdog entirely. Cheaper than entering
// the closure every 15s. The CLI's connect path sets BROWSE_HEADED=1 + PID=0,
// so this branch is the normal path for /open-bfstack-browser.
const IS_HEADED_WATCHDOG = process.env.BROWSE_HEADED === '1';
// A runtime handoff gives the user control of the headed window lifecycle.
let headedParentShutdownSuppressed = false;
// Latch for the one-time "parent exited, staying alive" log line.
let parentGone = false;
// Named + parameterized (default: the boot-time env PID) so watchdog.test.ts
// can drive the tick deterministically via __testInternals__, mirroring
// idleCheckTick above. setInterval invokes it with no args in production.
function parentWatchdogTick(parentPid: number = BROWSE_PARENT_PID): void {
  try {
    process.kill(parentPid, 0); // signal 0 = existence check only, no signal sent
  } catch {
    // Parent exited. Resolution order:
    // 1. Headed (unless suppressed by a runtime promotion) mode?
    //    Shutdown. The idle timeout doesn't apply in these modes (see
    //    idleCheckInterval above — both early-return), so ignoring parent
    //    death here would leak orphan headed daemons.
    // 2. Normal (headless) mode, or headed-by-promotion? Stay alive. the agent
    //    Code's Bash tool kills the parent shell between invocations, and a
    //    promoted daemon's user owns the window lifecycle. The idle timeout
    //    (30 min) handles eventual cleanup.
    const headed = activeBrowserManager.getConnectionMode() === 'headed'
      && !headedParentShutdownSuppressed;
    if (headed) {
      console.log(`[browse] Parent process ${parentPid} exited in headed mode, shutting down`);
      activeShutdown?.();
    } else if (!parentGone) {
      parentGone = true;
      console.log(`[browse] Parent process ${parentPid} exited (server stays alive, idle timeout will clean up)`);
    }
  }
}
// Poll cadence. Env-overridable as a test seam: watchdog.test.ts shrinks it
// (250ms) so a free-tier test can observe a real tick deciding on a dead
// parent instead of sleeping through the 15s production cadence. Production
// launchers never set this; unparsable or non-positive values fall back to 15s.
const rawWatchdogIntervalMs = parseInt(process.env.BROWSE_PARENT_WATCHDOG_INTERVAL_MS || '', 10);
const PARENT_WATCHDOG_INTERVAL_MS =
  Number.isFinite(rawWatchdogIntervalMs) && rawWatchdogIntervalMs > 0
    ? rawWatchdogIntervalMs
    : 15_000;
if (BROWSE_PARENT_PID > 0 && !IS_HEADED_WATCHDOG) {
  setInterval(parentWatchdogTick, PARENT_WATCHDOG_INTERVAL_MS);
} else if (IS_HEADED_WATCHDOG) {
  console.log('[browse] Parent-process watchdog disabled (headed mode)');
} else if (BROWSE_PARENT_PID === 0) {
  console.log('[browse] Parent-process watchdog disabled (BROWSE_PARENT_PID=0)');
}

/**
 * Suppress the headed-mode parent-death shutdown after a runtime promotion.
 *
 * The watchdog's contract is "headless daemons outlive their parent, headed ones
 * do not" — reasonable at boot, when mode is fixed by env. `handoff` breaks that
 * assumption: it swaps in a headed context on a RUNNING daemon
 * (browser-manager.ts, connectionMode = 'headed') without a restart, so a daemon
 * that legitimately registered a watchdog is suddenly on the fatal side of the
 * branch. The parent is typically a short-lived shell — the host's Bash tool
 * kills one after every invocation — so the next 15s poll shuts the daemon down,
 * discarding whatever the user was handed off to do, such as a login.
 *
 * Once promoted, the user owns the window lifecycle exactly as if the daemon had
 * been started headed, which is the case the env guards already exempt.
 *
 */
function suppressHeadedParentShutdown(): void {
  if (headedParentShutdownSuppressed) return;
  headedParentShutdownSuppressed = true;
  console.log('[browse] Parent-death headed shutdown suppressed (promoted to headed at runtime); user controls the headed window');
}

// ─── Command Sets (from commands.ts — single source of truth) ───
import { READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS } from './commands';
export { READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS };

/**
 * Whether an invocation should be treated as a WRITE for capability gating
 * (scope, watch-mode block, tab ownership). A command is a write if it
 * mutates state (`WRITE_COMMANDS`) OR it carries an `--out` flag — `js`/`eval
 * --out` writes the evaluate result to local disk, so the capability is
 * per-invocation, not per-command-name. This deliberately does NOT change
 * dispatch routing: `js`/`eval` still route to `handleReadCommand`; only the
 * security gates consult this.
 */
function isWriteInvocation(command: string, args: string[]): boolean {
  return WRITE_COMMANDS.has(command) || hasOutArg(args);
}

// ─── Inspector State (in-memory) ──────────────────────────────
let inspectorData: InspectorResult | null = null;
let inspectorTimestamp: number = 0;

// Inspector SSE subscribers
type InspectorSubscriber = (event: any) => void;
const inspectorSubscribers = new Set<InspectorSubscriber>();

/** Diagnostic accessor used by the $B memory snapshot. */
export function getInspectorSubscriberCount(): number {
  return inspectorSubscribers.size;
}

function emitInspectorEvent(event: any): void {
  for (const notify of inspectorSubscribers) {
    queueMicrotask(() => {
      try { notify(event); } catch (err: any) {
        console.error('[browse] Inspector event subscriber threw:', err.message);
      }
    });
  }
}

function inspectorTargetKey(target: { serverTabId: number; generation: number; frameUrl?: string; frameDocumentToken?: string }): string {
  return `${target.serverTabId}:${target.generation}:${target.frameUrl ?? '$main'}:${target.frameDocumentToken ?? '$main'}`;
}

function hasCanonicalInspectorTarget(target: any): boolean {
  return Boolean(
    target
    && Number.isInteger(target.serverTabId)
    && Number.isInteger(target.generation)
    && typeof target.documentUrl === 'string'
    && typeof target.documentToken === 'string'
    && (!target.frameUrl || typeof target.frameDocumentToken === 'string'),
  );
}

// ─── Server ────────────────────────────────────────────────────
const browserManager = new BrowserManager();
// Declared here rather than beside suppressHeadedParentShutdown: that function
// sits with the watchdog it gates, which is above this line, and binding it up
// there would touch `browserManager` in its temporal dead zone — aborting
// module evaluation and leaving every later const uninitialized.
browserManager.onHeadedPromotion = suppressHeadedParentShutdown;
// Indirection for embedders. Module-level handlers (idleCheckTick, parent
// watchdog, SIGTERM) read activeBrowserManager so that buildFetchHandler can
// retarget them at a caller-supplied BrowserManager. Symmetric with the
// existing `let activeShutdown` pattern at module scope (line ~113).
// Without this, embedders like gbrowser hit the dead module-level instance
// whose connectionMode never leaves 'launched' — and headed mode never
// short-circuits idle-shutdown.
let activeBrowserManager: BrowserManager = browserManager;
// When the user closes the headed browser window, run full cleanup
// (kill terminal agent, save session, remove profile locks, delete state file)
// before exiting. Exit code 0 means user-initiated clean quit (Cmd+Q on
// macOS) so process supervisors like gbrowser's gbd skip the restart loop;
// 2 means a real crash that should respawn. The fallback `?? 2` preserves
// legacy crash semantics for any caller that invokes onDisconnect without
// an explicit code. This is the safety-net default for the CLI flow before
// any buildFetchHandler call rebinds onDisconnect onto the cfg instance.
browserManager.onDisconnect = (code) => activeShutdown?.(code ?? 2);
let isShuttingDown = false;
// Session-persist ticker handle. Registered in start() (module scope so the
// factory's shutdown() can reach it), cleared by shutdown() BEFORE the final
// snapshot — a tick landing during browser teardown would otherwise overwrite
// the good final snapshot with a degraded one (zero tabs).
let sessionPersistInterval: ReturnType<typeof setInterval> | null = null;

// Port allocation lives in port-allocator.ts (#2314, decision 8) so the
// terminal-agent shares the SAME fixed 10000-60000 scan range instead of
// binding port:0 into the OS ephemeral range. The imports at the top of
// this file re-expose the pieces __testInternals__ pins.

// Find port: explicit BROWSE_PORT, or random in 10000-60000
function findPort(): Promise<number> {
  return findAvailablePort(BROWSE_PORT);
}

/**
 * Translate Playwright errors into actionable messages for AI agents.
 */
function wrapError(err: any): string {
  const msg = err.message || String(err);
  // Timeout errors
  if (err.name === 'TimeoutError' || msg.includes('Timeout') || msg.includes('timeout')) {
    if (msg.includes('locator.click') || msg.includes('locator.fill') || msg.includes('locator.hover')) {
      return `Element not found or not interactable within timeout. Check your selector or run 'snapshot' for fresh refs.`;
    }
    if (msg.includes('page.goto') || msg.includes('Navigation')) {
      return `Page navigation timed out. The URL may be unreachable or the page may be loading slowly.`;
    }
    return `Operation timed out: ${msg.split('\n')[0]}`;
  }
  // Multiple elements matched
  if (msg.includes('resolved to') && msg.includes('elements')) {
    return `Selector matched multiple elements. Be more specific or use @refs from 'snapshot'.`;
  }
  // Pass through other errors
  return msg;
}

/** Internal command result — used by handleCommand and chain subcommand routing */
interface CommandResult {
  status: number;
  result: string;
  headers?: Record<string, string>;
  json?: boolean; // true if result is JSON (errors), false for text/plain
}

/**
 * Core command execution logic. Returns a structured result instead of HTTP Response.
 * Used by both the HTTP handler (handleCommand) and chain subcommand routing.
 *
 * Options:
 *   skipRateCheck: true when called from chain (chain counts as 1 request)
 *   skipActivity: true when called from chain (chain emits 1 event for all subcommands)
 *   chainDepth: recursion guard — reject nested chains (depth > 0 means inside a chain)
 */
async function handleCommandInternalImpl(
  body: { command: string; args?: string[]; tabId?: number },
  tokenInfo?: TokenInfo | null,
  opts?: { skipRateCheck?: boolean; skipActivity?: boolean; chainDepth?: number },
): Promise<CommandResult> {
  const { args = [], tabId } = body;
  const rawCommand = body.command;

  if (!rawCommand) {
    return { status: 400, result: JSON.stringify({ error: 'Missing "command" field' }), json: true };
  }

  // ─── Alias canonicalization (before scope, watch, tab-ownership, dispatch) ─
  // Agent-friendly names like 'setcontent' route to canonical 'load-html'. Must
  // happen BEFORE scope check so a read-scoped token calling 'setcontent' is still
  // rejected (load-html lives in SCOPE_WRITE). Audit logging preserves rawCommand
  // so the trail records what the agent actually typed.
  const command = canonicalizeCommand(rawCommand);
  const isAliased = command !== rawCommand;

  // ─── Recursion guard: reject nested chains ──────────────────
  if (command === 'chain' && (opts?.chainDepth ?? 0) > 0) {
    return { status: 400, result: JSON.stringify({ error: 'Nested chain commands are not allowed' }), json: true };
  }

  // ─── Scope check (for scoped tokens) ──────────────────────────
  if (tokenInfo && tokenInfo.clientId !== 'root') {
    if (!checkScope(tokenInfo, command)) {
      return {
        status: 403, json: true,
        result: JSON.stringify({
          error: `Command "${command}" not allowed by your token scope`,
          hint: `Your scopes: ${tokenInfo.scopes.join(', ')}. Ask the user to re-pair without --restrict for full page access, or with --control for browser control commands.`,
        }),
      };
    }

    // `--out` writes the evaluate result to local disk, which is a WRITE
    // capability distinct from the JS-exec (admin) capability js/eval need.
    // Require write scope so an admin-but-not-write token can't write files.
    if (hasOutArg(args) && !tokenInfo.scopes.includes('write')) {
      return {
        status: 403, json: true,
        result: JSON.stringify({
          error: `"--out" writes to disk and requires the "write" scope`,
          hint: `Your scopes: ${tokenInfo.scopes.join(', ')}. Re-pair with write access to use --out.`,
        }),
      };
    }

    // Domain check for navigation commands
    if ((command === 'goto' || command === 'newtab') && args[0]) {
      if (!checkDomain(tokenInfo, args[0])) {
        return {
          status: 403, json: true,
          result: JSON.stringify({
            error: `Domain not allowed by your token scope`,
            hint: `Allowed domains: ${tokenInfo.domains?.join(', ') || 'none configured'}`,
          }),
        };
      }
    }

    // Rate check (skipped for chain subcommands — chain counts as 1 request)
    if (!opts?.skipRateCheck) {
      const rateResult = checkRate(tokenInfo);
      if (!rateResult.allowed) {
        return {
          status: 429, json: true,
          result: JSON.stringify({
            error: 'Rate limit exceeded',
            hint: `Max ${tokenInfo.rateLimit} requests/second. Retry after ${rateResult.retryAfterMs}ms.`,
          }),
          headers: { 'Retry-After': String(Math.ceil((rateResult.retryAfterMs || 1000) / 1000)) },
        };
      }
    }

    // Record command execution for idempotent key exchange tracking
    if (!opts?.skipRateCheck && tokenInfo.token) recordCommand(tokenInfo.token);
  }

  // Pin to a specific tab if requested (set by BROWSE_TAB env var, e.g. per-tab agent contexts).
  // This prevents parallel agents from interfering with each other's tab context.
  // Safe because Bun's event loop is single-threaded — no concurrent handleCommand.
  let savedTabId: number | null = null;
  if (tabId !== undefined && tabId !== null) {
    savedTabId = browserManager.getActiveTabId();
    // bringToFront: false — internal tab pinning must NOT steal window focus
    try { browserManager.switchTab(tabId, { bringToFront: false }); } catch (err: any) {
      return {
        status: 404,
        json: true,
        result: JSON.stringify({ error: `Requested tab ${tabId} is unavailable: ${err.message}` }),
      };
    }
  }

  // ─── Tab ownership check (own-only local tokens) ──
  //
  // Only `own-only` tokens are bound to their own
  // tabs. `shared` tokens — the default for skill spawns and local scoped
  // clients — can drive any tab; the capability gate (scope checks above)
  // and rate limits already constrain what they can do.
  //
  // Skip for `newtab` — it creates a tab rather than accessing one.
  if (command !== 'newtab' && tokenInfo && tokenInfo.clientId !== 'root' && tokenInfo.tabPolicy === 'own-only') {
    const targetTab = tabId ?? browserManager.getActiveTabId();
    if (!browserManager.checkTabAccess(targetTab, tokenInfo.clientId, { isWrite: isWriteInvocation(command, args), ownOnly: true })) {
      return {
        status: 403, json: true,
        result: JSON.stringify({
          error: 'Tab not owned by your agent. Use newtab to create your own tab.',
          hint: `Tab ${targetTab} is owned by ${browserManager.getTabOwner(targetTab) || 'root'}. Your agent: ${tokenInfo.clientId}.`,
        }),
      };
    }
  }

  // ─── newtab with ownership for scoped tokens ──────────────
  if (command === 'newtab' && tokenInfo && tokenInfo.clientId !== 'root') {
    const newId = await browserManager.newTab(args[0] || undefined, tokenInfo.clientId);
    return {
      status: 200, json: true,
      result: JSON.stringify({
        tabId: newId,
        owner: tokenInfo.clientId,
        hint: 'Include "tabId": ' + newId + ' in subsequent commands to target this tab.',
      }),
    };
  }

  // Block mutation commands while watching (read-only observation mode).
  // `--out` invocations count as mutations (they write the result to disk).
  if (browserManager.isWatching() && isWriteInvocation(command, args)) {
    return {
      status: 400, json: true,
      result: JSON.stringify({ error: 'Cannot run mutation commands while watching. Run `$B watch stop` first.' }),
    };
  }

  // Activity: emit command_start (skipped for chain subcommands)
  const startTime = Date.now();
  if (!opts?.skipActivity) {
    emitActivity({
      type: 'command_start',
      command,
      args,
      url: browserManager.getCurrentUrl(),
      tabs: browserManager.getTabCount(),
      mode: browserManager.getConnectionMode(),
      clientId: tokenInfo?.clientId,
    });
  }

  try {
    let result: string;

    const session = browserManager.getActiveSession();

    // Per-request warnings collected during hidden-element detection,
    // surfaced into the envelope the LLM sees. Carries across the read
    // phase into the centralized wrap block below.
    let hiddenContentWarnings: string[] = [];

    if (READ_COMMANDS.has(command)) {
      const isScoped = tokenInfo && tokenInfo.clientId !== 'root';
      // Hidden-element / ARIA-injection detection for every scoped
      // DOM-reading channel (text, html, links, forms, accessibility,
      // attrs, data, media, ux-audit). Previously only `text` received
      // stripping; other channels let hidden injection payloads reach
      // the LLM despite the envelope wrap. Detections become CONTENT
      // WARNINGS on the outgoing envelope so the model can see what it
      // would have otherwise trusted silently.
      if (isScoped && DOM_CONTENT_COMMANDS.has(command)) {
        const page = session.getPage();
        try {
          const strippedDescs = await markHiddenElements(page);
          if (strippedDescs.length > 0) {
            console.warn(`[browse] Content security: ${strippedDescs.length} hidden elements flagged on ${command} for ${tokenInfo.clientId}`);
            hiddenContentWarnings = strippedDescs.slice(0, 8).map(d =>
              `hidden content: ${d.slice(0, 120)}`,
            );
            if (strippedDescs.length > 8) {
              hiddenContentWarnings.push(`hidden content: +${strippedDescs.length - 8} more flagged elements`);
            }
          }
          if (command === 'text') {
            const target = session.getActiveFrameOrPage();
            result = await getCleanTextWithStripping(target);
          } else {
            result = await handleReadCommand(command, args, session, browserManager);
          }
        } finally {
          await cleanupHiddenMarkers(page);
        }
      } else {
        result = await handleReadCommand(command, args, session, browserManager);
      }
    } else if (WRITE_COMMANDS.has(command)) {
      result = await handleWriteCommand(command, args, session, browserManager);
    } else if (META_COMMANDS.has(command)) {
      // Pass chain depth + executeCommand callback so chain routes subcommands
      // through the full security pipeline (scope, domain, tab, wrapping).
      const chainDepth = (opts?.chainDepth ?? 0);
      // shutdown is factory-scoped (deleted from module scope in v1.35.0.0);
      // route the call through activeShutdown which buildFetchHandler assigns.
      const shutdownFn = () => activeShutdown ? activeShutdown() : Promise.resolve();
      result = await handleMetaCommand(command, args, browserManager, shutdownFn, tokenInfo, {
        chainDepth,
        daemonPort: LOCAL_LISTEN_PORT,
        executeCommand: (body, ti) => handleCommandInternal(body, ti, {
          skipRateCheck: true,    // chain counts as 1 request
          skipActivity: true,     // chain emits 1 event for all subcommands
          chainDepth: chainDepth + 1,  // recursion guard
        }),
      });
      // Start periodic snapshot interval when watch mode begins
      if (command === 'watch' && args[0] !== 'stop' && browserManager.isWatching()) {
        const watchInterval = setInterval(async () => {
          if (!browserManager.isWatching()) {
            clearInterval(watchInterval);
            return;
          }
          try {
            const snapshot = await handleSnapshot(['-i'], browserManager.getActiveSession());
            browserManager.addWatchSnapshot(snapshot);
          } catch {
            // Page may be navigating — skip this snapshot
          }
        }, 5000);
        browserManager.watchInterval = watchInterval;
      }
    } else if (command === 'help') {
      const helpText = generateHelpText();
      return { status: 200, result: helpText };
    } else {
      // Use the rich unknown-command helper: names the input, suggests the closest
      // match via Levenshtein (≤ 2 distance, ≥ 4 chars input), and appends an upgrade
      // hint if the command is listed in NEW_IN_VERSION.
      return {
        status: 400, json: true,
        result: JSON.stringify({
          error: buildUnknownCommandError(rawCommand, ALL_COMMANDS),
          hint: `Available commands: ${[...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS].sort().join(', ')}`,
        }),
      };
    }

    // ─── Centralized content wrapping (single location for all commands) ───
    // Scoped tokens: content filter + enhanced envelope + datamarking
    // Root tokens: basic untrusted content wrapper (backward compat)
    // Chain exempt from top-level wrapping (each subcommand wrapped individually)
    if (PAGE_CONTENT_COMMANDS.has(command) && command !== 'chain') {
      const isScoped = tokenInfo && tokenInfo.clientId !== 'root';
      if (isScoped) {
        // Run content filters
        const filterResult: ContentFilterResult = runContentFilters(
          result, browserManager.getCurrentUrl(), command,
        );
        if (filterResult.blocked) {
          return { status: 403, json: true, result: JSON.stringify({ error: filterResult.message }) };
        }
        // Datamark text command output only (not html, forms, or structured data)
        if (command === 'text') {
          result = datamarkContent(result);
        }
        // Enhanced envelope wrapping for scoped tokens.
        // Merge per-request hidden-element warnings with content-filter
        // warnings so both reach the LLM through the same CONTENT
        // WARNINGS header.
        const combinedWarnings = [...filterResult.warnings, ...hiddenContentWarnings];
        result = wrapUntrustedPageContent(
          result, command,
          combinedWarnings.length > 0 ? combinedWarnings : undefined,
        );
      } else {
        // Root token: basic wrapping (backward compat, Decision 2)
        result = wrapUntrustedContent(result, browserManager.getCurrentUrl());
      }
    }

    // Activity: emit command_end (skipped for chain subcommands)
    const successDuration = Date.now() - startTime;
    if (!opts?.skipActivity) {
      emitActivity({
        type: 'command_end',
        command,
        args,
        url: browserManager.getCurrentUrl(),
        duration: successDuration,
        status: 'ok',
        result: result,
        tabs: browserManager.getTabCount(),
        mode: browserManager.getConnectionMode(),
        clientId: tokenInfo?.clientId,
      });
    }

    writeAuditEntry({
      ts: new Date().toISOString(),
      cmd: command,
      aliasOf: isAliased ? rawCommand : undefined,
      args: args.join(' '),
      origin: browserManager.getCurrentUrl(),
      durationMs: successDuration,
      status: 'ok',
      mode: browserManager.getConnectionMode(),
    });

    browserManager.resetFailures();
    // Restore original active tab if we pinned to a specific one
    if (savedTabId !== null) {
      try { browserManager.switchTab(savedTabId, { bringToFront: false }); } catch (restoreErr: any) {
        console.warn('[browse] Failed to restore tab after command:', restoreErr.message);
      }
    }
    return { status: 200, result };
  } catch (err: any) {
    // Restore original active tab even on error
    if (savedTabId !== null) {
      try { browserManager.switchTab(savedTabId, { bringToFront: false }); } catch (restoreErr: any) {
        console.warn('[browse] Failed to restore tab after error:', restoreErr.message);
      }
    }

    // Activity: emit command_end (error) — skipped for chain subcommands
    const errorDuration = Date.now() - startTime;
    if (!opts?.skipActivity) {
      emitActivity({
        type: 'command_end',
        command,
        args,
        url: browserManager.getCurrentUrl(),
        duration: errorDuration,
        status: 'error',
        error: err.message,
        tabs: browserManager.getTabCount(),
        mode: browserManager.getConnectionMode(),
        clientId: tokenInfo?.clientId,
      });
    }

    writeAuditEntry({
      ts: new Date().toISOString(),
      cmd: command,
      aliasOf: isAliased ? rawCommand : undefined,
      args: args.join(' '),
      origin: browserManager.getCurrentUrl(),
      durationMs: errorDuration,
      status: 'error',
      error: err.message,
      mode: browserManager.getConnectionMode(),
    });

    browserManager.incrementFailures();
    let errorMsg = wrapError(err);
    const hint = browserManager.getFailureHint();
    if (hint) errorMsg += '\n' + hint;
    return { status: 500, result: JSON.stringify({ error: errorMsg }), json: true };
  }
}

/**
 * Sanitizing wrapper around handleCommandInternalImpl. ALL callers (single-command
 * HTTP, batch loop, scoped-token dispatch) go through this so the lone-surrogate
 * sanitization happens once at the architectural choke point, not per-leaf.
 * Do not bypass this by calling handleCommandInternalImpl directly.
 */
async function handleCommandInternal(
  body: { command: string; args?: string[]; tabId?: number },
  tokenInfo?: TokenInfo | null,
  opts?: { skipRateCheck?: boolean; skipActivity?: boolean; chainDepth?: number },
): Promise<CommandResult> {
  const cr = await handleCommandInternalImpl(body, tokenInfo, opts);
  return { ...cr, result: stripLoneSurrogates(cr.result) };
}

/**
 * Build the HTTP response from a CommandResult. Pure function so it can be
 * unit-tested without spinning up the server (#1440). Defense in depth on top
 * of handleCommandInternal's choke-point sanitization: this catches any
 * \uXXXX JSON-escape surrogate forms that the raw-codepoint regex above
 * misses when the body has already been JSON-stringified.
 */
export function buildCommandResponse(cr: CommandResult): Response {
  const contentType = cr.json ? 'application/json' : 'text/plain';
  const safeBody = typeof cr.result === 'string' ? sanitizeBody(cr.result, !!cr.json) : cr.result;
  return new Response(safeBody, {
    status: cr.status,
    headers: { 'Content-Type': contentType, ...cr.headers },
  });
}

/** HTTP wrapper — converts CommandResult to Response. Used by the /command
 * route dispatcher (line ~2158). The wrapper layer exists so
 * `buildCommandResponse` is independently unit-testable (v1.38.1.0).
 */
async function handleCommand(body: any, tokenInfo?: TokenInfo | null): Promise<Response> {
  const cr = await handleCommandInternal(body, tokenInfo);
  return buildCommandResponse(cr);
}

// Module-level shutdown function deleted in v1.39.0.0; it now lives inside
// the buildFetchHandler closure so it closes the cfg-provided browserManager.
// Signal handlers below call activeShutdown which buildFetchHandler assigns.

// Handle signals
//
// Node passes the signal name (e.g. 'SIGTERM') as the first arg to listeners.
// Wrap calls so activeShutdown receives no args — otherwise the string gets
// passed as exitCode and process.exit() coerces it to NaN, exiting with code 1
// instead of 0. (Caught in v0.18.1.0 #1025.)
//
// Gated on `import.meta.main` so embedders (gbrowser phoenix) that import
// server.ts as a submodule can register their own signal handlers without
// fighting with bfstack's. CLI path is unchanged.
if (import.meta.main) {
  // Standalone daemon: a Chromium crash must exit THIS process (its
  // supervisor/user notices); embedders and in-process test launches must
  // never be exited by browser-manager's disconnect handler.
  markDaemonProcess();
  // SIGINT (Ctrl+C): user intentionally stopping → shutdown.
  process.on('SIGINT', () => activeShutdown?.());
  // SIGHUP (terminal hangup): with handleSIGHUP:false at the three launch
  // sites (#2220), Playwright no longer closes Chromium when this process
  // gets hung up on — this handler is now the ONLY Chromium cleanup on
  // SIGHUP (ENG-OV4). Route to the same shutdown path as SIGINT:
  // activeShutdown closes the browser, releases ports, and removes the
  // state file. Without it, a hangup would leak a live Chromium.
  process.on('SIGHUP', () => activeShutdown?.());
  // SIGTERM behavior depends on mode:
  // - Normal (headless) mode: the host's Bash sandbox fires SIGTERM when the
  //   parent shell exits between tool invocations. Ignoring it keeps the server
  //   alive across $B calls. Idle timeout (30 min) handles eventual cleanup.
  // - Headed mode: idle timeout doesn't apply in this mode. Respect
  //   SIGTERM so external tooling (systemd, supervisord, CI) can shut cleanly
  //   without waiting forever. Ctrl+C and /stop still work either way.
  process.on('SIGTERM', () => {
    const headed = activeBrowserManager.getConnectionMode() === 'headed';
    if (headed) {
      console.log('[browse] Received SIGTERM in headed mode, shutting down');
      activeShutdown?.();
    } else {
      console.log('[browse] Received SIGTERM (ignoring — use /stop or Ctrl+C for intentional shutdown)');
    }
  });
  // Windows: taskkill /F bypasses SIGTERM, but 'exit' fires for some shutdown paths.
  // Defense-in-depth — primary cleanup is the CLI's stale-state detection via health check.
  if (process.platform === 'win32') {
    process.on('exit', () => {
      safeUnlinkQuiet(config.stateFile);
    });
  }
}

// Emergency cleanup for crashes (OOM, uncaught exceptions, browser disconnect)
function emergencyCleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  // Xvfb cleanup MUST happen before state-file deletion. spawnXvfb detaches
  // the child, so without this, an uncaught exception leaves the Xvfb
  // running with no PID record — orphan accumulates and eventually
  // exhausts the :99-:120 display range. Read the state file FIRST,
  // call cleanupXvfb (validates cmdline + start-time before kill), THEN
  // delete the state file.
  try {
    if (fs.existsSync(config.stateFile)) {
      const raw = fs.readFileSync(config.stateFile, 'utf-8');
      const state = JSON.parse(raw);
      if (state.xvfbPid && state.xvfbStartTime) {
        // Lazy import — emergencyCleanup may run on platforms where
        // ./xvfb's Linux-specific helpers fail to load. Best effort.
        try {
          const { cleanupXvfb } = require('./xvfb');
          cleanupXvfb({
            pid: state.xvfbPid,
            startTime: state.xvfbStartTime,
            display: state.xvfbDisplay || ':99',
          });
        } catch { /* best effort */ }
      }
    }
  } catch { /* state file unparseable — fall through to lock + state cleanup */ }

  // Clean Chromium profile locks via the shared helper (defensive guard
  // refuses to operate on unrecognized profile dirs).
  cleanSingletonLocks(resolveChromiumProfile());
  safeUnlinkQuiet(config.stateFile);
}
// Same import.meta.main gate as SIGINT/SIGTERM — embedders register their
// own crash handlers.
if (import.meta.main) {
  process.on('uncaughtException', (err) => {
    console.error('[browse] FATAL uncaught exception:', err.message);
    emergencyCleanup();
    process.exit(1);
  });
  process.on('unhandledRejection', (err: any) => {
    console.error('[browse] FATAL unhandled rejection:', err?.message || err);
    emergencyCleanup();
    process.exit(1);
  });
}

// ─── Start ─────────────────────────────────────────────────────
/**
 * Entry point for `bun run dev` and the compiled binary.
 *
 * Exported so embedders (gbrowser phoenix overlay) can call it
 * directly with env vars set, bypassing the module-level `import.meta.main`
 * gate. Phoenix's eventual fd-passing path will use `buildFetchHandler`
 * directly; until that lands, calling `start()` from a non-main entry is
 * supported via env (AUTH_TOKEN, BROWSE_PORT, BROWSE_OWN_SIGNALS).
 */
/**
 * Build a request handler set for the browse daemon. Embedders (gbrowser
 * phoenix overlay) call this directly with their own cfg to compose overlay
 * routes via cfg.beforeRoute, pass a pre-launched cfg.browserManager, and
 * opt out of terminal-agent teardown via cfg.ownsTerminalAgent (default
 * true, set to false when the embedder runs its own PTY server). The CLI
 * path calls this through start() with env-derived defaults and explicit
 * cfg.ownsTerminalAgent: true — externally-observable behavior is identical.
 *
 * Auth state lives ENTIRELY inside the factory closure: cfg.authToken is the
 * single source of truth for the bearer secret, factory-scoped validateAuth
 * closes over it, and factory-scoped shutdown closes the cfg-provided
 * browserManager. Module-level lifecycle singletons (LOCAL_LISTEN_PORT,
 * inspector state) intentionally STAY at module scope; see
 * the v1.35.0.0 CHANGELOG entry for the architectural rationale.
 *
 * The returned ServerHandle is callable directly. Bun.serve is the caller's
 * responsibility — embedders may fd-pass; CLI uses Bun.serve normally.
 */
export function buildFetchHandler(cfg: ServerConfig): ServerHandle {
  if (!cfg.authToken || cfg.authToken.length < 16) {
    throw new Error('buildFetchHandler: cfg.authToken must be a non-empty string >= 16 chars');
  }
  if (!cfg.browserManager) {
    throw new Error('buildFetchHandler: cfg.browserManager is required');
  }

  // Re-run init with cfg-provided values. ensureStateDir is idempotent
  // (mkdir -p); initAuditLog is idempotent (sets a module string);
  // initRegistry is idempotent for same-token, throws for different-token.
  // Owning init here (instead of at module load) means cfg.authToken is the
  // single source of truth for the registry root token.
  ensureStateDir(cfg.config);
  initAuditLog(cfg.config.auditLog);
  initRegistry(cfg.authToken);

  const { authToken, browserManager: cfgBrowserManager, startTime, beforeRoute, browsePort } = cfg;
  // Factory-scoped validateAuth. Closes over cfg.authToken so every internal
  // auth check sees the same token the routes receive. Module-level
  // validateAuth was deleted in v1.35.0.0.
  function validateAuth(req: Request): boolean {
    const header = req.headers.get('authorization');
    if (header === null) return false;
    // Constant-time compare so a byte-by-byte early-exit can't leak the token
    // prefix via response timing. timingSafeEqual requires equal-length inputs,
    // so the length check gates it (the length itself is not secret).
    const got = Buffer.from(header);
    const want = Buffer.from(`Bearer ${authToken}`);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  // Factory-scoped shutdown. Closes the cfg-provided browserManager so
  // embedders that pass their own BrowserManager get correct teardown.
  // Module-level shutdown was deleted in v1.35.0.0.
  async function shutdown(exitCode: number = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('[browse] Shutting down...');
    try { detachSession(); } catch (err: any) {
      console.warn('[browse] Failed to detach CDP session:', err.message);
    }
    inspectorSubscribers.clear();
    if (cfgBrowserManager.isWatching()) cfgBrowserManager.stopWatch();
    clearInterval(flushInterval);
    clearInterval(idleCheckInterval);
    // Stop the session-persist ticker BEFORE the final snapshot below —
    // paired with the isShuttingDown gate inside the tick, this guarantees
    // no interval snapshot can race the final one during teardown.
    if (sessionPersistInterval) {
      clearInterval(sessionPersistInterval);
      sessionPersistInterval = null;
    }
    await flushBuffers();

    // Final session snapshot before the browser goes away (#778). Best
    // effort with a hard 2s deadline: shutdown must never hang on a wedged
    // page.evaluate — after the deadline we proceed to browser close and let
    // the previous interval snapshot stand (atomic writes guarantee it's
    // intact). The .catch is attached to the persist promise itself so a
    // late rejection after losing the race can't become an unhandled
    // rejection.
    if (isSessionPersistEnabled()) {
      const finalSnapshot = persistSessionState(cfgBrowserManager, path.join(config.stateDir, SESSION_STATE_FILE))
        .catch((err: any) => {
          console.warn(`[browse] SESSION_PERSIST_FAILED at shutdown: ${err?.message ?? err}`);
        });
      await Promise.race([
        finalSnapshot,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }

    await cfgBrowserManager.close();

    cleanSingletonLocks(resolveChromiumProfile());
    safeUnlinkQuiet(config.stateFile);
    process.exit(exitCode);
  }

  // Named lifecycle helper. Logs failures so
  // future debugging isn't blind to a stuck listener.
  async function stopListeners(local: any) {
    try { if (local?.stop) local.stop(true); }
    catch (err: any) { console.warn('[browse] local listener stop failed:', err?.message || err); }
  }

  // Register this handle's shutdown as the active one. Module-level
  // handlers (idleCheckInterval, parent watchdog, onDisconnect, signal
  // handlers) call activeShutdown so they reach THIS shutdown, not a stale
  // module reference. Critical for embedders whose cfg.browserManager
  // differs from the module-level instance.
  activeShutdown = shutdown;

  // Retarget the BrowserManager indirection at the cfg-instance so the
  // module-level idleCheckTick + parent watchdog + SIGTERM handler all read
  // the right connectionMode. Without this, headed embedders auto-shutdown
  // after 30 min of HTTP idle because the dead module-level instance still
  // reports connectionMode === 'launched'.
  activeBrowserManager = cfgBrowserManager;
  // Same reason as above: the watchdog reads activeBrowserManager, so the
  // instance that can promote itself to headed must be the one that can
  // suppress the headed parent-death branch. An embedder-supplied manager
  // otherwise promotes silently and the watchdog keeps shutting down on a
  // promotion it can no longer see.
  cfgBrowserManager.onHeadedPromotion = suppressHeadedParentShutdown;

  // Wire the cfg-instance's onDisconnect to run shutdown when the user
  // closes the headed browser window. CHAIN any caller-provided handler
  // instead of overwriting it: gbrowser may have set its own onDisconnect
  // before calling buildFetchHandler (e.g. for snapshot/log work that needs
  // to run before the process exits). Caller errors are logged but never
  // block bfstack shutdown — defensive symmetry with the safeUnlinkQuiet /
  // safeKill philosophy in error-handling.ts.
  const callerOnDisconnect = cfgBrowserManager.onDisconnect;
  cfgBrowserManager.onDisconnect = async (code) => {
    if (callerOnDisconnect) {
      try { await callerOnDisconnect(code); }
      catch (err: any) {
        console.warn('[browse] caller onDisconnect threw:', err?.message ?? err);
      }
    }
    await activeShutdown?.(code ?? 2);
  };

  // Substitute cfgBrowserManager for module-level browserManager in the
  // dispatcher body so all browser-state reads/writes go through the cfg
  // instance. Other module-level references (handleCommand, getTokenInfo,
  // isRootRequest, etc.) take the token as a parameter and are passed
  // `authToken` (the cfg-derived value) explicitly.
  const browserManager = cfgBrowserManager;


  const makeFetchHandler = (surface: Surface) => async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // beforeRoute overlay hook runs before per-route dispatch and resolves bearer auth once
    // so the hook receives TokenInfo | null. Note: getTokenInfo returns null
    // for both missing AND invalid bearer — see the ServerConfig.beforeRoute
    // JSDoc for the security implications.
    if (beforeRoute) {
      const auth = getTokenInfo(req);
      const overlayResp = await beforeRoute(req, surface, auth);
      if (overlayResp) return overlayResp;
    }

      // Welcome page — served when bfstack Browser launches in headed mode
      if (url.pathname === '/welcome') {
        const packageRoot = process.env.BFSTACK_ROOT;
        const welcomePath = packageRoot ? path.join(packageRoot, 'browse', 'src', 'welcome.html') : null;
        if (welcomePath) {
          try {
            const html = require('fs').readFileSync(welcomePath, 'utf-8');
            return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          } catch (err: any) {
            console.error('[browse] Failed to read welcome page:', welcomePath, err.message);
          }
        }
        // No welcome page found — serve a simple fallback (avoid ERR_UNSAFE_REDIRECT on Windows)
        return new Response(
          `<!DOCTYPE html><html><head><title>bfstack Browser</title>
          <style>body{background:#111;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
          .msg{text-align:center;opacity:.7;}.gold{color:#f5a623;font-size:2em;margin-bottom:12px;}</style></head>
          <body><div class="msg"><div class="gold">◈</div><p>bfstack Browser ready.</p><p style="font-size:.85em">Continue in your Codex task.</p></div></body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }

      // ─── POST /extension-token — pinned-origin token bootstrap ──────
      //
      // The ONLY endpoint that hands out AUTH_TOKEN. GET /health used to
      // carry the token (headed mode + any chrome-extension:// Origin),
      // which meant ANY extension — or any localhost caller in headed
      // mode — could read the root token. Now the token is released only
      // to the one extension identity we ship: the Origin header must be
      // exactly `chrome-extension://<BFSTACK_EXTENSION_ID>`, where the ID
      // is pinned by the "key" field in extension/manifest.json (derive
      // it with `bun browse/scripts/extension-id.ts`). Chrome sets Origin
      // on cross-origin POSTs from extension contexts and web pages
      // cannot forge a chrome-extension:// Origin.
      //
      // Local listener only; the extension still needs the exact Origin below.
      if (url.pathname === '/extension-token' && req.method === 'POST') {
        // Defense-in-depth alongside the 127.0.0.1 bind: a DNS-rebinding
        // page can't present a localhost Host header. Host arrives as
        // '127.0.0.1:34567', so parse out the hostname — never compare
        // the raw header (which carries the port) against a literal.
        let hostname: string | null = null;
        try {
          hostname = new URL(`http://${req.headers.get('host') ?? ''}`).hostname;
        } catch (err) {
          if (!(err instanceof TypeError)) throw err;  // TypeError = malformed Host
        }
        const originOk =
          req.headers.get('origin') === `chrome-extension://${BFSTACK_EXTENSION_ID}`;
        const hostOk = hostname === '127.0.0.1' || hostname === 'localhost';
        if (!originOk || !hostOk) {
          // No detail in the body — don't teach a probing caller which
          // check failed.
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ token: authToken }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Health check — no auth required, does NOT reset idle timer.
      // NEVER carries a token in any mode: token bootstrap is
      // POST /extension-token (pinned extension Origin) and shell auth
      // uses the existing root token. Liveness/status only.
      if (url.pathname === '/health') {
        const healthy = await browserManager.isHealthy();
        return new Response(JSON.stringify({
          status: healthy ? 'healthy' : 'unhealthy',
          mode: browserManager.getConnectionMode(),
          uptime: Math.floor((Date.now() - startTime) / 1000),
          tabs: browserManager.getTabCount(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ─── /token — mint scoped tokens (root-only) ──────────────────
      if (url.pathname === '/token' && req.method === 'POST') {
        if (!isRootRequest(req)) {
          return new Response(JSON.stringify({
            error: 'Only the root token can mint sub-tokens',
          }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        try {
          const tokenBody = await req.json() as any;
          if (!tokenBody.clientId) {
            return new Response(JSON.stringify({ error: 'Missing clientId' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            });
          }
          const session = createToken({
            clientId: tokenBody.clientId,
            scopes: tokenBody.scopes,
            domains: tokenBody.domains,
            tabPolicy: tokenBody.tabPolicy,
            rateLimit: tokenBody.rateLimit,
            expiresSeconds: tokenBody.expiresSeconds,
          });
          return new Response(JSON.stringify({
            token: session.token,
            expires: session.expiresAt,
            scopes: session.scopes,
            agent: session.clientId,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (err) {
          // Name the caller's typo (bad scope, negative rateLimit, reserved
          // clientId) instead of hiding it behind the generic body error.
          if (err instanceof InvalidScopeError || err instanceof ReservedClientIdError) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ error: 'Invalid request body' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // ─── /token/:clientId — revoke a scoped token (root-only) ─────
      if (url.pathname.startsWith('/token/') && req.method === 'DELETE') {
        if (!isRootRequest(req)) {
          return new Response(JSON.stringify({ error: 'Root token required' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
          });
        }
        // decodeURIComponent so CLI-encoded names (spaces, UTF-8) round-trip.
        let clientId: string;
        try {
          clientId = decodeURIComponent(url.pathname.slice('/token/'.length));
        } catch {
          return new Response(JSON.stringify({ error: 'Malformed client ID encoding' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        const revoked = revokeToken(clientId);
        // Release tabs UNCONDITIONALLY: ownership outlives the token (it clears
        // only on tab close), so a client whose token already expired can still
        // own tabs. Gating release on a revoke hit would orphan that ownership
        // and let a same-name token renewal inherit an authenticated tab.
        const tabsReleased = browserManager.releaseClientTabs(clientId).length;
        if (!revoked && tabsReleased === 0) {
          return new Response(JSON.stringify({ error: `Agent "${clientId}" not found` }), {
            status: 404, headers: { 'Content-Type': 'application/json' },
          });
        }
        console.log(`[browse] Revoked ${revoked} token(s), released ${tabsReleased} tab(s) for: ${clientId}`);
        return new Response(JSON.stringify({ revoked: clientId, tokens_deleted: revoked, tabs_released: tabsReleased }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // ─── /agents — list connected agents (root-only) ──────────────
      if (url.pathname === '/agents' && req.method === 'GET') {
        if (!isRootRequest(req)) {
          return new Response(JSON.stringify({ error: 'Root token required' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
          });
        }
        const agents = listTokens().map(t => ({
          clientId: t.clientId,
          scopes: t.scopes,
          domains: t.domains,
          expiresAt: t.expiresAt,
          commandCount: t.commandCount,
          createdAt: t.createdAt,
        }));
        return new Response(JSON.stringify({ agents }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // ─── SSE session cookie mint (auth required) ──────────────────
      //
      // Issues a short-lived view-only token in an HttpOnly SameSite=Strict
      // cookie so EventSource calls can authenticate without putting the
      // root token in a URL. The returned cookie is valid ONLY on the SSE
      // endpoints (/activity/stream, /inspector/events); it is not a
      // scoped token and cannot be used against /command.
      //
      // The extension calls this once at bootstrap with the root Bearer
      // header, then opens EventSource with `withCredentials: true` which
      // sends the cookie back automatically.
      if (url.pathname === '/sse-session' && req.method === 'POST') {
        if (!validateAuth(req)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const minted = mintSseSessionToken();
        return new Response(JSON.stringify({
          expiresAt: minted.expiresAt,
          cookie: SSE_COOKIE_NAME,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': buildSseSetCookie(minted.token),
          },
        });
      }

      // Refs endpoint — auth required, does NOT reset idle timer
      if (url.pathname === '/refs') {
        if (!validateAuth(req)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const refs = browserManager.getRefMap();
        return new Response(JSON.stringify({
          refs,
          url: browserManager.getCurrentUrl(),
          mode: browserManager.getConnectionMode(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Activity stream — SSE, auth required, does NOT reset idle timer
      if (url.pathname === '/activity/stream') {
        // Auth: Bearer header OR view-only SSE session cookie (EventSource
        // can't send Authorization headers, so the extension fetches a cookie
        // via POST /sse-session first, then opens EventSource with
        // withCredentials: true). The ?token= query param is NO LONGER
        // accepted — URLs leak to logs/referer/history. See N1 in the
        // v1.6.0.0 security wave plan.
        const cookieToken = extractSseCookie(req);
        if (!validateAuth(req) && !validateSseSessionToken(cookieToken)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const afterId = parseInt(url.searchParams.get('after') || '0', 10);
        // Cleanup contract (abort + enqueue-fail + heartbeat-fail, all
        // idempotent) lives in createSseEndpoint; sanitizeReplacer is
        // applied to every JSON.stringify inside the helper, so
        // page-content-derived fields (URLs, command args, errors)
        // stay surrogate-safe per AGENTS.md egress invariant.
        return createSseEndpoint(req, {
          initialReplay: (send) => {
            const { entries, gap, gapFrom, availableFrom } = getActivityAfter(afterId);
            if (gap) send('gap', { gapFrom, availableFrom });
            for (const entry of entries) send('activity', entry);
          },
          subscribe,
          liveEventName: 'activity',
        });
      }

      // Activity history — REST, auth required, does NOT reset idle timer
      if (url.pathname === '/activity/history') {
        if (!validateAuth(req)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const { entries, totalAdded } = getActivityHistory(limit);
        return new Response(JSON.stringify({ entries, totalAdded, subscribers: getSubscriberCount() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }


      // ─── Batch endpoint — N commands, 1 HTTP round-trip ─────────────
      // Accepts both root AND scoped tokens (same as /command).
      // Executes commands sequentially through the full security pipeline.
      // Batches commands to avoid repeated local HTTP requests.
      if (url.pathname === '/batch' && req.method === 'POST') {
        const tokenInfo = getTokenInfo(req);
        if (!tokenInfo) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        resetIdleTimer();
        const body = await req.json();
        const { commands } = body;

        if (!Array.isArray(commands) || commands.length === 0) {
          return new Response(JSON.stringify({ error: '"commands" must be a non-empty array' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (commands.length > 50) {
          return new Response(JSON.stringify({ error: 'Max 50 commands per batch' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const startTime = Date.now();
        emitActivity({
          type: 'command_start',
          command: 'batch',
          args: [`${commands.length} commands`],
          url: browserManager.getCurrentUrl(),
          tabs: browserManager.getTabCount(),
          mode: browserManager.getConnectionMode(),
          clientId: tokenInfo?.clientId,
        });

        const results: Array<{ index: number; status: number; result: string; command: string; tabId?: number }> = [];
        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i];
          if (!cmd || typeof cmd.command !== 'string') {
            results.push({ index: i, status: 400, result: JSON.stringify({ error: 'Missing "command" field' }), command: '' });
            continue;
          }
          // Reject nested batches
          if (cmd.command === 'batch') {
            results.push({ index: i, status: 400, result: JSON.stringify({ error: 'Nested batch commands are not allowed' }), command: 'batch' });
            continue;
          }
          const cr = await handleCommandInternal(
            { command: cmd.command, args: cmd.args, tabId: cmd.tabId },
            tokenInfo,
            { skipRateCheck: true, skipActivity: true },
          );
          // Sanitize lone surrogates per-result (#1440 — /batch bypasses the
          // handleCommand chokepoint, so it needs its own sanitization).
          const safeResult = typeof cr.result === 'string' ? sanitizeBody(cr.result, !!cr.json) : cr.result;
          results.push({
            index: i,
            status: cr.status,
            result: safeResult,
            command: cmd.command,
            tabId: cmd.tabId,
          });
        }

        const duration = Date.now() - startTime;
        emitActivity({
          type: 'command_end',
          command: 'batch',
          args: [`${commands.length} commands`],
          url: browserManager.getCurrentUrl(),
          duration,
          status: 'ok',
          result: `${results.filter(r => r.status === 200).length}/${commands.length} succeeded`,
          tabs: browserManager.getTabCount(),
          mode: browserManager.getConnectionMode(),
          clientId: tokenInfo?.clientId,
        });

        // Sanitize the JSON envelope a second time (defense in depth) — catches
        // any \uXXXX escape sequences for lone surrogates that survived the
        // per-result pass.
        const batchBody = stripLoneSurrogateEscapes(JSON.stringify({
          results,
          duration,
          total: commands.length,
          succeeded: results.filter(r => r.status === 200).length,
          failed: results.filter(r => r.status !== 200).length,
        }));
        return new Response(batchBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ─── File serving endpoint (authenticated local retrieval) ────
      if (url.pathname === '/file' && req.method === 'GET') {
        const tokenInfo = getTokenInfo(req);
        if (!tokenInfo) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' },
          });
        }
        const filePath = url.searchParams.get('path');
        if (!filePath) {
          return new Response(JSON.stringify({ error: 'Missing "path" query parameter' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          validateTempPath(filePath);
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (!fs.existsSync(filePath)) {
          return new Response(JSON.stringify({ error: 'File not found' }), {
            status: 404, headers: { 'Content-Type': 'application/json' },
          });
        }
        const stat = fs.statSync(filePath);
        if (stat.size > 200 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'File too large (max 200MB)' }), {
            status: 413, headers: { 'Content-Type': 'application/json' },
          });
        }
        const ext = path.extname(filePath).toLowerCase();
        const MIME_MAP: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.avif': 'image/avif',
          '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
          '.pdf': 'application/pdf', '.json': 'application/json',
          '.html': 'text/html', '.txt': 'text/plain', '.mhtml': 'message/rfc822',
        };
        const contentType = MIME_MAP[ext] || 'application/octet-stream';
        resetIdleTimer();
        return new Response(Bun.file(filePath), {
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(stat.size),
            'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
            'Cache-Control': 'no-cache',
          },
        });
      }

      // ─── Command endpoint (accepts both root AND scoped tokens) ────
      // Must be checked BEFORE the blanket root-only auth gate below,
      // because locally scoped tokens are valid for /command.
      if (url.pathname === '/command' && req.method === 'POST') {
        const tokenInfo = getTokenInfo(req);
        if (!tokenInfo) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        resetIdleTimer();
        const body = await req.json() as any;
        return handleCommand(body, tokenInfo);
      }

      // ─── Auth-required endpoints (root token only) ─────────────────

      if (!validateAuth(req)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ─── Inspector endpoints ──────────────────────────────────────

      // POST /inspector/pick — receive element pick from extension, run CDP inspection
      if (url.pathname === '/inspector/pick' && req.method === 'POST') {
        const body = await req.json();
        const { selector, target } = body;
        if (!selector || !target) {
          return new Response(JSON.stringify({ error: 'Missing selector or Inspector target' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const resolved = await browserManager.resolveInspectorTarget(target);
          const result = { ...(await inspectTargetElement(resolved.page, resolved.frame, selector)), target: resolved.target };
          // A navigation between resolution and inspection invalidates the result.
          await browserManager.resolveInspectorTarget(resolved.target);
          inspectorData = result;
          inspectorTimestamp = Date.now();
          // Also store on browserManager for CLI access
          (browserManager as any)._inspectorData = result;
          (browserManager as any)._inspectorTimestamp = inspectorTimestamp;
          emitInspectorEvent({ type: 'pick', selector, target: resolved.target, timestamp: inspectorTimestamp });
          return new Response(JSON.stringify(result), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err instanceof InspectorTargetError ? err.status : 500, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // GET /inspector — return latest inspector data
      if (url.pathname === '/inspector' && req.method === 'GET') {
        if (!inspectorData) {
          return new Response(JSON.stringify({ data: null }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        const stale = inspectorTimestamp > 0 && (Date.now() - inspectorTimestamp > 60000);
        return new Response(JSON.stringify({ data: inspectorData, timestamp: inspectorTimestamp, stale }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // POST /inspector/apply — apply a CSS modification
      if (url.pathname === '/inspector/apply' && req.method === 'POST') {
        const body = await req.json();
        const { selector, property, value, target } = body;
        if (!selector || !property || value === undefined || !target) {
          return new Response(JSON.stringify({ error: 'Missing selector, property, value, or Inspector target' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (!hasCanonicalInspectorTarget(target)) {
          return new Response(JSON.stringify({ error: 'Inspector modification requires the target returned by a successful pick.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const resolved = await browserManager.resolveInspectorTarget(target);
          const mod = await modifyStyle(resolved.frame, selector, property, value, inspectorTargetKey(resolved.target), resolved.target.frameDocumentToken ?? resolved.target.documentToken);
          emitInspectorEvent({ type: 'apply', modification: mod, timestamp: Date.now() });
          return new Response(JSON.stringify(mod), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err instanceof InspectorTargetError ? err.status : err?.message === 'Inspector target changed. Pick the element again.' ? 409 : 500, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // POST /inspector/reset — clear all modifications
      if (url.pathname === '/inspector/reset' && req.method === 'POST') {
        const body = await req.json();
        if (!body.target) {
          return new Response(JSON.stringify({ error: 'Missing Inspector target' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (!hasCanonicalInspectorTarget(body.target)) {
          return new Response(JSON.stringify({ error: 'Inspector reset requires the target returned by a successful pick.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const resolved = await browserManager.resolveInspectorTarget(body.target);
          await resetModifications(resolved.frame, inspectorTargetKey(resolved.target), resolved.target.frameDocumentToken ?? resolved.target.documentToken);
          emitInspectorEvent({ type: 'reset', timestamp: Date.now() });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err instanceof InspectorTargetError ? err.status : err?.message === 'Inspector target changed. Pick the element again.' ? 409 : 500, headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // GET /inspector/history — return modification list
      if (url.pathname === '/inspector/history' && req.method === 'GET') {
        return new Response(JSON.stringify({ history: getModificationHistory() }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /memory — diagnostic snapshot (auth required, does NOT reset idle).
      // Same auth model as /activity/stream and /inspector/events: Bearer header
      // OR view-only SSE-session cookie. Does NOT extend /health (which is
      // unauthenticated liveness-only — token bootstrap moved to the pinned
      // POST /extension-token); a separate endpoint with the standard SSE auth
      // keeps /health free of anything worth stealing.
      if (url.pathname === '/memory' && req.method === 'GET') {
        const cookieToken = extractSseCookie(req);
        if (!validateAuth(req) && !validateSseSessionToken(cookieToken)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' },
          });
        }
        const { buildMemorySnapshotJson } = await import('./memory-command');
        const snapshot = await buildMemorySnapshotJson(cfgBrowserManager);
        // sanitizeReplacer is required at every SSE/JSON egress that ships
        // page-content-derived strings — tab.url and tab.title come from
        // page content, so lone-surrogate bytes from broken emoji or
        // mid-emoji splits could otherwise reach the sidebar / model API.
        return new Response(JSON.stringify(snapshot, sanitizeReplacer), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /inspector/events — SSE for inspector state changes (auth required)
      if (url.pathname === '/inspector/events' && req.method === 'GET') {
        // Same auth model as /activity/stream: Bearer OR view-only cookie.
        // ?token= query param dropped (see N1 in the v1.6.0.0 security plan).
        const cookieToken = extractSseCookie(req);
        if (!validateAuth(req) && !validateSseSessionToken(cookieToken)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' },
          });
        }
        // Cleanup contract (abort + enqueue-fail + heartbeat-fail,
        // idempotent) lives in createSseEndpoint; sanitizeReplacer is
        // applied to every JSON.stringify inside the helper. The
        // inspector subscriber set stays here because it's also written
        // to by emitInspectorEvent above.
        return createSseEndpoint(req, {
          initialReplay: inspectorData
            ? (send) => send('state', { data: inspectorData, timestamp: inspectorTimestamp })
            : undefined,
          subscribe: (notify) => {
            inspectorSubscribers.add(notify);
            return () => inspectorSubscribers.delete(notify);
          },
          liveEventName: 'inspector',
        });
      }

      return new Response('Not found', { status: 404 });
  };

  return {
    fetchLocal: makeFetchHandler('local'),
    shutdown,
    stopListeners,
  };
}

export async function start() {
  // Clear old log files
  safeUnlink(CONSOLE_LOG_PATH);
  safeUnlink(NETWORK_LOG_PATH);
  safeUnlink(DIALOG_LOG_PATH);

  const port = await findPort();
  LOCAL_LISTEN_PORT = port;

  // ─── Proxy config (D8 + codex F5) ──────────────────────────────
  // BROWSE_PROXY_URL is set by the CLI when --proxy was passed. For SOCKS5
  // with auth, we run a local 127.0.0.1 bridge that relays to the
  // authenticated upstream (Chromium can't do SOCKS5 auth itself). For
  // HTTP/HTTPS or unauthenticated SOCKS5, we pass the URL directly to
  // Chromium's proxy.server option.
  let proxyBridge: BridgeHandle | null = null;
  const proxyUrl = process.env.BROWSE_PROXY_URL;
  if (proxyUrl) {
    let parsed;
    try {
      parsed = parseProxyConfig({
        proxyUrl,
        envUser: process.env.BROWSE_PROXY_USER,
        envPass: process.env.BROWSE_PROXY_PASS,
      });
    } catch (err) {
      if (err instanceof ProxyConfigError) {
        console.error(`[browse] error: ${err.message} (${err.hint})`);
        process.exit(1);
      }
      throw err;
    }

    if (parsed.scheme === 'socks5' && parsed.hasAuth) {
      // Pre-flight: verify upstream accepts our creds before launching
      // Chromium. 5s budget, 3 retries with 500ms backoff (D4: handles VPN
      // warm-up race). On failure, exit with redacted error.
      console.log(`[browse] Testing SOCKS5 upstream ${redactProxyUrl(proxyUrl)}...`);
      try {
        const test = await testUpstream({
          upstream: toUpstreamConfig(parsed),
          budgetMs: 5000,
          retries: 3,
          backoffMs: 500,
        });
        console.log(`[browse] [proxy] upstream test ok in ${test.ms}ms (${test.attempts} attempt${test.attempts === 1 ? '' : 's'})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[browse] [proxy] FAIL upstream ${redactProxyUrl(proxyUrl)}: ${msg}`);
        process.exit(1);
      }

      proxyBridge = await startSocksBridge({ upstream: toUpstreamConfig(parsed) });
      console.log(`[browse] [proxy] bridge listening on 127.0.0.1:${proxyBridge.port}`);
      browserManager.setProxyConfig({ server: `socks5://127.0.0.1:${proxyBridge.port}` });
    } else {
      // HTTP/HTTPS or unauth SOCKS5 — pass through to Chromium directly.
      browserManager.setProxyConfig({
        server: `${parsed.scheme}://${parsed.host}:${parsed.port}`,
        ...(parsed.userId ? { username: parsed.userId } : {}),
        ...(parsed.password ? { password: parsed.password } : {}),
      });
      console.log(`[browse] [proxy] using ${redactProxyUrl(proxyUrl)} (pass-through to Chromium)`);
    }

    // Tear down bridge on shutdown.
    process.on('exit', () => {
      if (proxyBridge) {
        proxyBridge.close().catch(() => { /* shutting down anyway */ });
      }
    });
  }

  // ─── Xvfb auto-spawn (Linux + headed + no DISPLAY) ─────────────
  // codex F2: walk display range to pick a free one (never hardcode :99);
  // record start-time alongside PID so cleanup can validate ownership and
  // not kill a recycled PID.
  let xvfb: XvfbHandle | null = null;
  const xvfbDecision = shouldSpawnXvfb(process.env, process.platform);
  if (xvfbDecision.spawn) {
    const displayNum = pickFreeDisplay();
    if (displayNum == null) {
      console.error('[browse] no free X display in range :99-:120 — refusing to clobber existing X servers');
      process.exit(1);
    }
    try {
      xvfb = await spawnXvfb(displayNum);
      process.env.DISPLAY = xvfb.display;
      console.log(`[browse] [xvfb] spawned on ${xvfb.display} (pid ${xvfb.pid})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[browse] [xvfb] FAILED: ${msg}`);
      console.error(`[browse] [xvfb] hint: ${xvfbInstallHint()}`);
      process.exit(1);
    }
    process.on('exit', () => { try { xvfb?.close(); } catch { /* shutting down */ } });
  } else if (process.env.BROWSE_HEADED === '1') {
    console.log(`[browse] [xvfb] skipped: ${xvfbDecision.reason}`);
  }

  // Read env once — single source of truth for authToken (and other env).
  // Threaded through launchHeaded, buildFetchHandler, and the state file
  // write so all consumers see the same value. v1.34.x's module-level
  // AUTH_TOKEN const was deleted in v1.35.0.0.
  const envCfg = resolveConfigFromEnv();

  // Launch browser (headless or headed with extension)
  // BROWSE_HEADLESS_SKIP=1 skips browser launch entirely (for HTTP-only testing)
  const skipBrowser = process.env.BROWSE_HEADLESS_SKIP === '1';
  if (!skipBrowser) {
    const headed = process.env.BROWSE_HEADED === '1';
    if (headed) {
      await browserManager.launchHeaded(envCfg.authToken);
      console.log(`[browse] Launched headed Chromium with extension`);
    } else {
      await browserManager.launch();
    }
  }

  const startTime = Date.now();

  // ─── Build the request handlers via buildFetchHandler factory ───
  // CLI path passes env-derived values; no beforeRoute hook. Phoenix uses
  // the same factory with its own cfg + overlay hook.
  const handle = buildFetchHandler({
    ...envCfg,
    browsePort: port,        // actual bound port (resolveConfigFromEnv default is 0)
    browserManager,          // module-level instance, same as today
    xvfb,
    proxyBridge,
    startTime,
  });

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch: handle.fetchLocal,
  });

  // Write state file (atomic: write .tmp then rename)
  const state: Record<string, unknown> = {
    pid: process.pid,
    port,
    token: envCfg.authToken,
    startedAt: new Date().toISOString(),
    serverPath: path.resolve(import.meta.dir, 'server.ts'),
    binaryVersion: readVersionHash() || undefined,
    mode: browserManager.getConnectionMode(),
    daemonIdentity: captureProcessIdentity({ pid: process.pid, stateFile: config.stateFile }) || undefined,
    // D2 daemon-mismatch detection: CLI computes the same hash from its
    // resolved flags and refuses if it differs from this stored value.
    ...(process.env.BROWSE_CONFIG_HASH ? { configHash: process.env.BROWSE_CONFIG_HASH } : {}),
    // Xvfb child PID + start-time + display so disconnect (or a future
    // daemon launch on this state file) can validate-then-cleanup orphans
    // without clobbering a recycled PID.
    ...(xvfb ? { xvfbPid: xvfb.pid, xvfbStartTime: xvfb.startTime, xvfbDisplay: xvfb.display } : {}),
    // #2709: launched-Chromium identity (pid + start time) so `browse stop`
    // can reap a survivor — the headless launch has no SingletonLock for
    // killOrphanChromium to walk, and on macOS 26 the orphaned GPU process
    // kept spinning at ~800% CPU after the daemon exited.
    ...(() => {
      const info = browserManager.getChromiumProcInfo();
      const chromiumIdentity = info
        ? captureProcessIdentity({
          pid: info.pid,
          stateFile: config.stateFile,
          ...(browserManager.getConnectionMode() === 'headed' ? { profileDir: resolveChromiumProfile() } : {}),
        })
        : null;
      return info ? { chromiumPid: info.pid, chromiumStartTime: info.startTime, chromiumIdentity: chromiumIdentity || undefined } : {};
    })(),
  };
  const tmpFile = tmpStatePath();
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, config.stateFile);

  browserManager.serverPort = port;

  // ─── Opt-in session persistence (#778 class) ─────────────────
  // BROWSE_PERSIST_STATE=1: restore cookies/storage/tabs from the last
  // snapshot, then keep snapshotting on an interval. Launched mode only —
  // the headed persistent profile owns its own state. The final snapshot at
  // clean shutdown lives in buildFetchHandler's shutdown().
  //
  // Runs AFTER Bun.serve() + the state-file write, in the BACKGROUND:
  // restore re-creates tabs sequentially with up-to-15s goto timeouts while
  // the CLI's readiness probe gives up at 8s — one slow/unreachable saved
  // URL must never make every `$B` command report "Server failed to start".
  // Fire-and-forget: a restore failure is logged and never affects the
  // daemon.
  if (!skipBrowser && isSessionPersistEnabled() && browserManager.getConnectionMode() === 'launched') {
    const sessionStatePath = path.join(config.stateDir, SESSION_STATE_FILE);
    restoreSessionState(browserManager, sessionStatePath)
      .then((restored) => {
        if (restored) {
          // Counts come from the deserialized snapshot itself — no extra
          // saveState() round-trip against pages that may still be loading.
          console.log(`[browse] Session state restored: ${restored.cookies.length} cookies / ${restored.pages.length} tabs (BROWSE_PERSIST_STATE=1)`);
        } else {
          console.log('[browse] Session persistence on; no prior state — fresh session (BROWSE_PERSIST_STATE=1)');
        }
      })
      .catch((err: any) => {
        console.warn(`[browse] SESSION_RESTORE_FAILED: ${err?.message ?? err}`);
      });
    let persistWarned = false;
    // In-flight guard: never start a new snapshot while the previous one is
    // still pending (a slow page.evaluate would otherwise pile up ticks).
    let persistInFlight = false;
    sessionPersistInterval = setInterval(() => {
      // Shutdown gate (belt; shutdown()'s clearInterval is the suspenders):
      // a tick that fires during browser teardown snapshots a degraded state
      // (zero tabs) over the good final snapshot.
      if (isShuttingDown) return;
      if (persistInFlight) return; // skip the tick
      persistInFlight = true;
      persistSessionState(browserManager, sessionStatePath)
        .catch((err: any) => {
          // Warn once — a full disk must not spam the log every 30s, and a
          // snapshot failure must never kill the daemon (R3).
          if (!persistWarned) {
            persistWarned = true;
            console.warn(`[browse] SESSION_PERSIST_FAILED: ${err?.message ?? err} (further failures suppressed)`);
          }
        })
        .finally(() => { persistInFlight = false; });
    }, sessionPersistIntervalMs());
    (sessionPersistInterval as any)?.unref?.();
  }

  // Navigate to welcome page if in headed mode and still on about:blank
  if (browserManager.getConnectionMode() === 'headed') {
    try {
      const currentUrl = browserManager.getCurrentUrl();
      if (currentUrl === 'about:blank' || currentUrl === '') {
        const page = browserManager.getPage();
        page.goto(`http://127.0.0.1:${port}/welcome`, { timeout: 3000 }).catch((err: any) => {
          console.warn('[browse] Failed to navigate to welcome page:', err.message);
        });
      }
    } catch (err: any) {
      console.warn('[browse] Welcome page navigation setup failed:', err.message);
    }
  }

  // Clean up stale state files (older than 7 days)
  try {
    const stateDir = path.join(config.stateDir, 'browse-states');
    if (fs.existsSync(stateDir)) {
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      for (const file of fs.readdirSync(stateDir)) {
        const filePath = path.join(stateDir, file);
        const stat = fs.statSync(filePath);
        if (Date.now() - stat.mtimeMs > SEVEN_DAYS) {
          fs.unlinkSync(filePath);
          console.log(`[browse] Deleted stale state file: ${file}`);
        }
      }
    }
  } catch (err: any) {
    console.warn('[browse] Failed to clean stale state files:', err.message);
  }

  console.log(`[browse] Server running on http://127.0.0.1:${port} (PID: ${process.pid})`);
  console.log(`[browse] State file: ${config.stateFile}`);
  console.log(`[browse] Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`);


}

/**
 * Test-only. Resets the module-level shutdown latch so a second test case
 * can exercise shutdown() in the same process. Mirrors __resetRegistry in
 * token-registry.ts. shutdown() short-circuits when isShuttingDown is true
 * (see line near the start of shutdown), so without this, tests that call
 * shutdown() more than once silently no-op after the first call.
 *
 * DO NOT call from production code. Defeats the shutdown re-entry guard,
 * which can race process.exit with cfgBrowserManager.close() and the pkill /
 * safeUnlinkQuiet side effects. The `__` prefix is the convention; nothing
 * enforces it. If you find yourself reaching for this outside a test file,
 * the right fix is to make isShuttingDown factory-scoped instead.
 */
export function __resetShuttingDown(): void {
  isShuttingDown = false;
}

// Auto-kickoff only when this module is the entry point. Embedders
// (gbrowser phoenix overlay) import { start, buildFetchHandler, ... }
// without triggering the listener-binding side effects.
if (import.meta.main) {
  start().catch((err) => {
    console.error(`[browse] Failed to start: ${err.message}`);
    // Write error to disk for the CLI to read — on Windows, the CLI can't capture
    // stderr because the server is launched with detached: true, stdio: 'ignore'.
    try {
      const errorLogPath = path.join(config.stateDir, 'browse-startup-error.log');
      mkdirSecure(config.stateDir);
      writeSecureFile(errorLogPath, `${new Date().toISOString()} ${err.message}\n${err.stack || ''}\n`);
    } catch {
      // stateDir may not exist — nothing more we can do
    }
    process.exit(1);
  });
}
