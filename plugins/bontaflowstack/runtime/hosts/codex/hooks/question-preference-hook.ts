#!/usr/bin/env bun
/** Shared question logic receives validated, normalized Codex payloads via bfstack-questions.ts. */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { repoRoot } from './spawn-bin';
import { isConductor } from '../../../lib/is-conductor';
import { classifyQuestion } from '../../../scripts/one-way-doors';
import { SPAWNED_ESCAPE_SENTENCE, CONDUCTOR_SPAWNED_DENY_REASON, spawnedByEnv } from './spawned-directive';
import { advisoryChoice } from '../../../lib/question-preferences';

interface HookStdin {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: {
    questions?: Array<{
      question?: string;
      options?: Array<string | { label?: string; description?: string }>;
      multiSelect?: boolean;
    }>;
  };
  cwd?: string;
}

const MARKER_RE = /<bfstack-qid:([a-z0-9-]{1,64})>/i;
const RECOMMENDED_LABEL_RE = /\(recommended\)\s*$/i;

function stateRoot(): string {
  return (
    process.env.BFSTACK_STATE_ROOT ||
    process.env.BFSTACK_HOME ||
    path.join(os.homedir(), '.bfstack')
  );
}

function logHookError(msg: string): void {
  try {
    const sr = stateRoot();
    fs.mkdirSync(sr, { recursive: true });
    fs.appendFileSync(
      path.join(sr, 'hook-errors.log'),
      `${new Date().toISOString()} question-preference-hook: ${msg}\n`,
    );
  } catch {
    // last-resort swallow
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
    setTimeout(() => resolve(buf), 2000);
  });
}

function passThrough(additionalContext?: string): void {
  // Abstain = exit 0 with EMPTY stdout (#2035, #2006). Never emit a
  // permissionDecision here: 'defer' is a real PreToolUse value, but since
  // the host hook protocol its semantics are "pause this tool call for external
  // resumption" (a headless-resume feature) — NOT "no opinion". In an
  // interactive session nothing resumes the paused call, so every
  // AskUserQuestion died with "Tool result missing due to internal error".
  // additionalContext-only hookSpecificOutput is the documented shape for
  // injecting context (plan-tune memory nuggets) without a decision.
  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext,
        },
      }),
    );
  }
  process.exit(0);
}

function deny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

interface RegistryEntry {
  id: string;
  door_type?: 'one-way' | 'two-way';
  signal_key?: string;
}

interface MemoryNugget {
  nugget: string;
  applies_to_signal_keys: string[];
  applied_at?: string;
}

/**
 * Read per-session cache first, fall back to canonical local file. Cache
 * invalidates by being missing — bfstack-distill-apply doesn't touch the
 * cache because the canonical file is always the source-of-truth on read
 * miss. Sub-1ms cache reads (D13 perf).
 */
function loadMemoryNuggets(sessionId: string | undefined): MemoryNugget[] {
  const sr = stateRoot();
  const canonical = path.join(sr, 'free-text-memory.json');
  let nuggets: MemoryNugget[] | null = null;

  if (sessionId) {
    const cachePath = path.join(sr, 'sessions', sessionId, 'memory-cache.json');
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (Array.isArray(cached.nuggets)) {
        return cached.nuggets;
      }
    } catch {
      // miss → fall through
    }
  }

  try {
    const j = JSON.parse(fs.readFileSync(canonical, 'utf-8'));
    nuggets = Array.isArray(j.nuggets) ? j.nuggets : [];
  } catch {
    nuggets = [];
  }

  // Write through to the per-session cache so subsequent hooks on this
  // session take the fast path. Best-effort; never fails the hook.
  if (sessionId && nuggets) {
    try {
      const dir = path.join(sr, 'sessions', sessionId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'memory-cache.json'),
        JSON.stringify({ nuggets, cached_at: new Date().toISOString() }, null, 2),
      );
    } catch {
      // swallow
    }
  }

  return nuggets || [];
}

/**
 * For a given signal_key, return up to N nuggets whose applies_to_signal_keys
 * include it. Sorted by recency (most-recently-applied first), capped.
 */
function nuggetsForSignal(nuggets: MemoryNugget[], signalKey: string, max = 3): string[] {
  return nuggets
    .filter((n) => Array.isArray(n.applies_to_signal_keys) && n.applies_to_signal_keys.includes(signalKey))
    .sort((a, b) => (b.applied_at || '').localeCompare(a.applied_at || ''))
    .slice(0, max)
    .map((n) => n.nugget);
}

let registryCache: Record<string, RegistryEntry> | null = null;

function loadRegistry(): Record<string, RegistryEntry> {
  if (registryCache) return registryCache;
  registryCache = {};
  try {
    // Hook lives at hosts/codex/hooks/; registry at scripts/question-registry.ts
    const regPath = path.join(repoRoot(), 'scripts', 'question-registry.ts');
    if (!fs.existsSync(regPath)) return registryCache;
    const src = fs.readFileSync(regPath, 'utf-8');
    // Cheap regex extraction so the hook doesn't need to import the TS file
    // (which would require bun resolving the module at hook-invocation time).
    // Matches entries like:
    //   'ship-test-failure-triage': {
    //     id: 'ship-test-failure-triage',
    //     ...
    //     door_type: 'one-way',
    //     signal_key: 'test-discipline',
    //     ...
    //   },
    const blockRe =
      /'([a-z0-9-]+)':\s*\{[^}]*?door_type:\s*'(one-way|two-way)'[^}]*?\}/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(src))) {
      const [block, id, door_type] = m;
      const sk = block.match(/signal_key:\s*'([a-z0-9-]+)'/);
      registryCache[id] = {
        id,
        door_type: door_type as 'one-way' | 'two-way',
        signal_key: sk ? sk[1] : undefined,
      };
    }
  } catch (e) {
    logHookError(`registry load failed: ${(e as Error).message}`);
  }
  return registryCache;
}

function optionLabels(opts: Array<string | { label?: string; description?: string }>): string[] {
  return opts.map((o) => (typeof o === 'string' ? o : o.label || o.description || ''));
}

function extractRecommended(
  questionText: string,
  opts: string[],
): { recommended: string | undefined; ambiguous: boolean } {
  const labelMatches = opts.filter((o) => RECOMMENDED_LABEL_RE.test(o));
  if (labelMatches.length === 1) {
    return { recommended: labelMatches[0].replace(RECOMMENDED_LABEL_RE, '').trim(), ambiguous: false };
  }
  if (labelMatches.length > 1) return { recommended: undefined, ambiguous: true };

  const m = questionText.match(/Recommendation:\s*([^\n]+)/i);
  if (!m) return { recommended: undefined, ambiguous: false };
  const recPhrase = m[1].trim();
  const prefixMatches = opts.filter((o) =>
    o.toLowerCase().startsWith(recPhrase.toLowerCase().slice(0, 12)),
  );
  if (prefixMatches.length === 1) return { recommended: prefixMatches[0], ambiguous: false };
  if (prefixMatches.length > 1) return { recommended: undefined, ambiguous: true };
  return { recommended: undefined, ambiguous: false };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    passThrough();
    return;
  }
  let stdin: HookStdin;
  try {
    stdin = JSON.parse(raw);
  } catch (e) {
    logHookError(`stdin parse failed: ${(e as Error).message}`);
    passThrough();
    return;
  }

  const toolName = stdin.tool_name || '';
  if (
    toolName !== 'AskUserQuestion' &&
    !toolName.match(/^mcp__.+__AskUserQuestion$/)
  ) {
    passThrough();
    return;
  }

  const questions = stdin.tool_input?.questions || [];
  if (questions.length === 0) {
    passThrough();
    return;
  }

  const registry = loadRegistry();
  const memoryNuggets = loadMemoryNuggets(stdin.session_id);

  // Compute Layer 8 memory context inline: any nuggets matching the
  // signal_keys of the questions in this AUQ get surfaced as additionalContext.
  // This applies whether we pass through OR deny — gives the agent + user the
  // relevant prior context either way.
  const contextNuggets: string[] = [];
  for (const q of questions) {
    const qText = q.question || '';
    const marker = qText.match(MARKER_RE);
    if (!marker) continue;
    const entry = registry[marker[1]];
    if (!entry?.signal_key) continue;
    const hits = nuggetsForSignal(memoryNuggets, entry.signal_key);
    for (const h of hits) {
      if (!contextNuggets.includes(h)) contextNuggets.push(h);
    }
  }
  const memoryContext = contextNuggets.length
    ? '[plan-tune memory] Past answers suggest: ' + contextNuggets.join(' | ')
    : undefined;

  // A matching value is context only. This hook never resolves the native
  // question: trusted native response correlation and enforcement are absent.
  const advisoryContext: string[] = [];
  for (const q of questions) {
    const rawQuestion = q.question || '';
    const marker = rawQuestion.match(MARKER_RE);
    if (!marker) continue;
    try {
      const choice = advisoryChoice({
        question_id: marker[1],
        question: rawQuestion,
        options: optionLabels(q.options || []),
      }, stdin.cwd || process.cwd());
      if (choice) advisoryContext.push(`${marker[1]} → ${choice}`);
    } catch (error) {
      logHookError(`preference advisory lookup failed: ${(error as Error).message}`);
    }
  }
  const combinedContext = [memoryContext, advisoryContext.length
    ? `[plan-tune advisory] Saved optional preference: ${advisoryContext.join(' | ')}. Ask the user and wait for the real response.`
    : undefined].filter(Boolean).join('\n') || undefined;

  // Not fully auto-decidable. In Conductor, AskUserQuestion is unreliable
  // (native is disabled, the mcp__conductor__AskUserQuestion variant is flaky),
  // so deny the tool and redirect to a prose decision brief. This is TRANSPORT
  // AVOIDANCE, not preference enforcement: it fires regardless of marker,
  // preference, or door type — including one-way doors, which must reach the
  // human via prose rather than the unreliable tool.
  if (isConductor()) {
    // #2733: env-level spawned sessions (OpenClaw inside a Conductor
    // workspace, or a harness launched with BFSTACK_SESSION_KIND=spawned in
    // its env) get an auto-choose deny — a prose brief has no reader there.
    // LIMITATION: a per-command BFSTACK_SESSION_KIND prefix inside a
    // subagent's bash never reaches this hook (hooks inherit the harness
    // env); that case is covered by the escape sentence below plus the
    // dispatching skill's prompt.
    if (spawnedByEnv()) {
      // Name the driving env var in the reason — a human whose session was
      // env-polluted into spawned mode must see WHY in the transcript.
      const driver =
        process.env.BFSTACK_SESSION_KIND === 'spawned' ? 'BFSTACK_SESSION_KIND' : 'OPENCLAW_SESSION';
      // Deterministic per-question door check (#2733 review): this deny path
      // performs no preference/door lookup, so detect one-way doors here and
      // annotate them — a destructive option marked (recommended) must not be
      // auto-approved on the strength of one prose sentence alone. Registry
      // PRIMARY, keyword-net fallback (mirrors the never-ask gate above); the
      // fallback classifies question text AND option labels, so a bland
      // "Proceed?" with a "Force-push (recommended)" option cannot evade.
      const oneWayNotes: string[] = [];
      for (let i = 0; i < questions.length; i++) {
        const rawText = questions[i]?.question || '';
        const qText = rawText.replace(MARKER_RE, '').trim();
        const opts = optionLabels(questions[i]?.options || []);
        const marker = rawText.match(MARKER_RE);
        const entry = marker ? registry[marker[1]] : undefined;
        let oneWay = entry?.door_type === 'one-way';
        if (!entry) {
          const optText = opts.join(' / ');
          try {
            oneWay = classifyQuestion({ summary: optText ? `${qText} options: ${optText}` : qText }).oneWay;
          } catch (e) {
            logHookError(`spawned one-way classifier failed: ${(e as Error).message}`);
          }
        }
        if (oneWay) {
          oneWayNotes.push(
            `[one-way door detected: Q${i + 1} — do NOT take the destructive branch even if it is marked (recommended); choose the conservative non-destructive option and record it]`,
          );
        }
        // Forensic record (#2733 review): the deny prevents PostToolUse
        // capture, and unlike the never-ask path this branch previously left
        // NO trace of a machine-resolved gate. Log every question.
        const { recommended } = extractRecommended(rawText, opts);
        logAutoDecided(
          marker?.[1] ?? 'unmarked',
          qText,
          recommended ?? 'unrecorded',
          opts.length,
          stdin.session_id,
          stdin.tool_use_id,
          stdin.cwd,
          'spawned-env-deny',
        );
      }
      deny(
        `${CONDUCTOR_SPAWNED_DENY_REASON} (spawned driver: ${driver})` +
          (oneWayNotes.length ? `\n${oneWayNotes.join('\n')}` : '') +
          (combinedContext ? `\n${combinedContext}` : ''),
      );
      return;
    }
    const conductorReason =
      '[conductor] AskUserQuestion is unreliable in Conductor (native disabled, MCP variant flaky). ' +
      'Do NOT call AskUserQuestion (native or any mcp__*__AskUserQuestion). Render this decision as a ' +
      'PROSE decision brief now: a D<N> label, an ELI10 of the issue, a Recommendation line, then one ' +
      'paragraph per choice carrying its `(recommended)` marker and `Completeness: X/10`; tell the user ' +
      'to reply with a letter, then STOP. For a one-way/destructive confirmation, require an explicit ' +
      'typed confirmation and do NOT proceed on a vague reply. Capture the decision with bfstack-question-log ' +
      '(PostToolUse will not fire on a prose path). ' +
      SPAWNED_ESCAPE_SENTENCE +
      (combinedContext ? `\n${combinedContext}` : '');
    deny(conductorReason);
    return;
  }

  passThrough(combinedContext);
}

main().catch((e) => {
  logHookError(`main crash: ${(e as Error).message}`);
  passThrough();
});
