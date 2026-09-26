#!/usr/bin/env bun
/**
 * Stop hook: close dangling "started" timeline entries (#2553).
 *
 * The preamble writes {"skill":X,"event":"started",...} at every skill start;
 * the completion write lives in prose at the END of the skill workflow and is
 * unenforceable — an interrupted session, a context blowout, or an agent that
 * simply stops leaves started > completed forever, and the leak is
 * unrepairable after the fact. This hook runs on the host's Stop event and
 * appends event:"completed" (outcome "unknown", source "stop-hook") for each
 * started entry belonging to the Stop event's actual Codex session.
 *
 * FAIL-OPEN CONTRACT (F5) — timeline repair must never block a session:
 *   - ALWAYS exits 0, whatever happens (corrupt timeline, missing file, bad
 *     stdin, unreadable slug). Errors go to ~/.bfstack/hook-errors.log,
 *     best-effort.
 *   - Internal time budget (~2s): work is bounded up front — the timeline is
 *     skipped entirely over a size cap, only the last TAIL_WINDOW_BYTES are
 *     read and parsed (P3: this hook runs on EVERY Stop event machine-wide,
 *     and a full read+parse scaled to the cap at ~100-300ms/turn), and the
 *     deadline is re-checked before the write. the host's own hook
 *     timeout is the outer belt.
 *   - Append-only: never rewrites timeline.jsonl.
 *   - Tail-window semantics: a dangling "started" older than the last 256KB
 *     of appends belongs to a session long gone — beyond repair interest.
 *     A "completed" is always appended AFTER its "started", so any started
 *     inside the window has its completion inside the window too: the window
 *     can never fabricate a dangling entry, and idempotency holds.
 *
 * Session correlation is mandatory. A missing or malformed native session id
 * is not a repairable Stop event, so this fail-open hook writes nothing.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBin } from './spawn-bin';

const DEADLINE_MS = 2000;
const MAX_TIMELINE_BYTES = 10 * 1024 * 1024;
const TAIL_WINDOW_BYTES = 256 * 1024;
const startedAt = Date.now();

/**
 * Read only the last TAIL_WINDOW_BYTES of the timeline (P3). When the window
 * starts mid-file, the first (partial) line is discarded — its entry is
 * outside the window by definition. Throws on I/O errors; the caller owns
 * the fail-open handling.
 */
function readTimelineTail(timelinePath: string, size: number): string {
  const fd = fs.openSync(timelinePath, 'r');
  try {
    const offset = Math.max(0, size - TAIL_WINDOW_BYTES);
    const length = size - offset;
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, offset);
    let text = buf.subarray(0, bytesRead).toString('utf8');
    if (offset > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function stateRoot(): string {
  return process.env.BFSTACK_HOME || path.join(os.homedir(), '.bfstack');
}

function logHookError(msg: string): void {
  try {
    const root = stateRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(
      path.join(root, 'hook-errors.log'),
      `${new Date().toISOString()} timeline-stop-hook: ${msg}\n`,
    );
  } catch {
    // best-effort; never block the session because logging failed
  }
}

interface TimelineEntry {
  skill?: string;
  event?: string;
  sessionId?: string;
  projectSlug?: string;
  branch?: string;
  timestamp?: string;
}

function main(): void {
  let cwd = process.cwd();
  let stopSessionId = '';
  try {
    const stdin = fs.readFileSync(0, 'utf8');
    if (stdin.trim()) {
      const payload = JSON.parse(stdin) as { cwd?: string; session_id?: string };
      if (payload.cwd && fs.existsSync(payload.cwd)) cwd = payload.cwd;
      if (typeof payload.session_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.session_id)) {
        stopSessionId = payload.session_id;
      }
    }
  } catch {
    // A malformed event cannot be correlated safely.
  }
  if (!stopSessionId) { logHookError('missing or invalid Stop session id — nothing repaired'); return; }

  // Resolve the project slug the same way the preamble did (BFSTACK_PROJECT_SLUG
  // override, project-root walk, remote-derived slug).
  let slug = '';
  try {
    const r = runBin('bfstack-slug', [], { cwd, encoding: 'utf8', timeout: DEADLINE_MS });
    const m = (r.stdout ?? '').toString().match(/^SLUG=([A-Za-z0-9._-]+)$/m);
    if (m) slug = m[1];
  } catch {
    // fall through
  }
  if (!slug) {
    logHookError('could not resolve project slug — nothing repaired');
    return;
  }

  const timelinePath = path.join(stateRoot(), 'projects', slug, 'timeline.jsonl');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(timelinePath);
  } catch {
    return; // no timeline — nothing to repair
  }
  if (stat.size === 0) return;
  if (stat.size > MAX_TIMELINE_BYTES) {
    logHookError(`timeline over size cap (${stat.size} bytes) — skipped (fail-open)`);
    return;
  }

  let raw: string;
  try {
    raw = readTimelineTail(timelinePath, stat.size);
  } catch (err) {
    logHookError(`could not read timeline: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Corrupt lines are skipped individually. A missing run identifier means
  // concurrent starts for one skill/session cannot be disambiguated: never
  // close either of them. A waiting user is also an intentional pause, not a
  // workflow completion; only a later resumed event makes it eligible again.
  const openCount = new Map<string, number>();
  const peakOpenCount = new Map<string, number>();
  const firstStarted = new Map<string, TimelineEntry>();
  const state = new Map<string, 'active' | 'waiting_user'>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: TimelineEntry;
    try {
      entry = JSON.parse(line) as TimelineEntry;
    } catch {
      continue;
    }
    if (!entry || typeof entry.skill !== 'string') continue;
    if (entry.sessionId !== stopSessionId || entry.projectSlug !== slug) continue;
    const key = `${entry.skill}\u0000${entry.sessionId}`;
    if (entry.event === 'started') {
      const open = (openCount.get(key) ?? 0) + 1;
      openCount.set(key, open);
      peakOpenCount.set(key, Math.max(peakOpenCount.get(key) ?? 0, open));
      if (!firstStarted.has(key)) firstStarted.set(key, entry);
      state.set(key, 'active');
    }
    if (entry.event === 'completed') {
      openCount.set(key, Math.max(0, (openCount.get(key) ?? 0) - 1));
      state.delete(key);
    }
    if (entry.event === 'waiting_user' && (openCount.get(key) ?? 0) === 1) {
      state.set(key, 'waiting_user');
    }
    if (entry.event === 'resumed' && (openCount.get(key) ?? 0) === 1) {
      state.set(key, 'active');
    }
  }

  const dangling: Array<[string, TimelineEntry]> = [];
  for (const [key, open] of openCount) {
    const entry = firstStarted.get(key);
    if (!entry || open !== 1 || peakOpenCount.get(key) !== 1 || state.get(key) !== 'active') continue;
    dangling.push([key, entry]);
  }
  if (dangling.length === 0) return;

  if (Date.now() - startedAt > DEADLINE_MS) {
    logHookError('internal 2s budget exhausted before write — skipped (fail-open)');
    return;
  }

  const now = new Date().toISOString();
  const lines = dangling
    .map(([, entry]) =>
      JSON.stringify({
        skill: entry.skill,
        event: 'completed',
        ...(entry.branch ? { branch: entry.branch } : {}),
        outcome: 'unknown',
        source: 'stop-hook',
        sessionId: entry.sessionId,
        projectSlug: entry.projectSlug,
        timestamp: now,
      }),
    )
    .join('\n');
  try {
    fs.appendFileSync(timelinePath, lines + '\n');
  } catch (err) {
    logHookError(`could not append completions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

try {
  main();
} catch (err) {
  logHookError(`unexpected: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
}
process.exit(0);
