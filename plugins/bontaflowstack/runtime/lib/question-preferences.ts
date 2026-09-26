import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicWriteSync } from './fs-atomic';
import { isOptionalPreferenceEligible } from '../scripts/question-registry';

type Scope = 'user' | 'project' | 'task';
type OriginType = 'synthetic-fixture' | 'user-declared';

interface PreferenceRecord {
  question_id: string;
  choice: string;
  scope: Scope;
  project_root: string;
  task_id?: string;
  origin: { type: OriginType; native_event_id?: string };
  context: { fingerprint: string };
  created_at: string;
}

interface PreferenceStore {
  version: 2;
  records: PreferenceRecord[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TASK_RE = /^[A-Za-z0-9_-]{1,128}$/;

function fail(message: string): never {
  throw new Error(`bfstack-question-preference: ${message}`);
}

function normalize(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`invalid ${field}`);
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) fail(`invalid ${field}`);
  return normalized;
}

function fingerprint(question: string, options: string[]): string {
  return crypto.createHash('sha256').update(JSON.stringify({ question, options: [...options].sort() })).digest('hex');
}

function questionText(value: unknown): string {
  return normalize(value, 'question').replace(/\s*<bfstack-qid:[a-z0-9-]{1,64}>\s*/gi, ' ').trim();
}

function projectRoot(cwd: string): string {
  const real = fs.realpathSync(cwd);
  try {
    const gitRoot = execFileSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return fs.realpathSync(gitRoot);
  } catch {
    return real;
  }
}

function storePath(): string {
  const root = process.env.BFSTACK_STATE_ROOT || process.env.BFSTACK_HOME;
  if (!root) fail('missing Windows-profile state root');
  return path.join(root, 'question-preferences.v2.json');
}

function isRecord(value: unknown): value is PreferenceRecord {
  const record = value as Partial<PreferenceRecord> | null;
  return Boolean(record && typeof record === 'object' && ID_RE.test(record.question_id ?? '') &&
    typeof record.choice === 'string' && ['user', 'project', 'task'].includes(record.scope ?? '') &&
    typeof record.project_root === 'string' && typeof record.created_at === 'string' &&
    typeof record.context?.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(record.context.fingerprint) &&
    (record.origin?.type === 'synthetic-fixture' || record.origin?.type === 'user-declared') &&
    (record.scope !== 'task' || (typeof record.task_id === 'string' && TASK_RE.test(record.task_id))));
}

function readStore(file: string): PreferenceStore {
  if (!fs.existsSync(file)) return { version: 2, records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.version !== 2 || !Array.isArray(parsed.records) || !parsed.records.every(isRecord)) fail('invalid versioned preference store');
    return parsed as PreferenceStore;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('bfstack-question-preference:')) throw error;
    fail('invalid versioned preference store');
  }
}

function currentTask(scope: Scope): string | undefined {
  if (scope !== 'task') return undefined;
  const task = process.env.CODEX_THREAD_ID;
  if (!task || !TASK_RE.test(task)) fail('task scope requires a host-supplied Codex task id');
  return task;
}

function originFor(input: Record<string, unknown>): PreferenceRecord['origin'] {
  const source = input.source;
  if (source === 'native-user') fail('native-user origin is unavailable without a trusted host correlation');
  if (source === 'synthetic-fixture') {
    const nativeEventId = normalize(input.native_event_id, 'native_event_id');
    return { type: 'synthetic-fixture', native_event_id: nativeEventId };
  }
  if (source === 'plan-tune' || source === 'inline-user') return { type: 'user-declared' };
  fail('invalid source');
}

function identity(record: Pick<PreferenceRecord, 'question_id' | 'scope' | 'project_root' | 'task_id'>): string {
  if (record.scope === 'user') return `${record.question_id}\u0000user`;
  if (record.scope === 'project') return `${record.question_id}\u0000project\u0000${record.project_root}`;
  return `${record.question_id}\u0000task\u0000${record.project_root}\u0000${record.task_id}`;
}

function write(input: Record<string, unknown>): void {
  const questionId = normalize(input.question_id, 'question_id');
  if (!ID_RE.test(questionId)) fail('invalid question_id');
  if (!isOptionalPreferenceEligible(questionId)) fail('question is not eligible for an optional preference');
  const scope = input.scope;
  if (scope !== 'user' && scope !== 'project' && scope !== 'task') fail('invalid scope');
  const question = questionText(input.question);
  if (!Array.isArray(input.options) || input.options.length < 2) fail('invalid options');
  const options = input.options.map((option) => normalize(option, 'option'));
  if (new Set(options).size !== options.length) fail('ambiguous options');
  const choice = normalize(input.choice, 'choice');
  if (!options.includes(choice)) fail('choice is not an exact option');

  const taskId = currentTask(scope);
  const record: PreferenceRecord = {
    question_id: questionId,
    choice,
    scope,
    project_root: projectRoot(process.cwd()),
    ...(taskId ? { task_id: taskId } : {}),
    origin: originFor(input),
    context: { fingerprint: fingerprint(question, options) },
    created_at: new Date().toISOString(),
  };
  const file = storePath();
  const store = readStore(file);
  store.records = store.records.filter((existing) => identity(existing) !== identity(record));
  store.records.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteSync(file, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify(record) + '\n');
}

function visible(record: PreferenceRecord, root: string, task: string | undefined): boolean {
  if (record.scope === 'user') return true;
  if (record.project_root !== root) return false;
  return record.scope === 'project' || (Boolean(task) && record.task_id === task);
}

export function advisoryChoice(input: { question_id: unknown; question: unknown; options: unknown }, cwd = process.cwd()): string | undefined {
  const questionId = normalize(input.question_id, 'question_id');
  if (!ID_RE.test(questionId)) fail('invalid question_id');
  if (!isOptionalPreferenceEligible(questionId)) return undefined;
  const question = questionText(input.question);
  if (!Array.isArray(input.options) || input.options.length < 2) fail('invalid options');
  const options = input.options.map((option) => normalize(option, 'option'));
  if (new Set(options).size !== options.length) fail('ambiguous options');
  const task = process.env.CODEX_THREAD_ID && TASK_RE.test(process.env.CODEX_THREAD_ID) ? process.env.CODEX_THREAD_ID : undefined;
  const root = projectRoot(cwd);
  const matches = readStore(storePath()).records.filter((record) =>
    record.question_id === questionId && record.origin.type === 'user-declared' &&
    record.context.fingerprint === fingerprint(question, options) && visible(record, root, task),
  );
  matches.sort((a, b) => ({ user: 1, project: 2, task: 3 }[b.scope] - { user: 1, project: 2, task: 3 }[a.scope]));
  return matches[0]?.choice;
}

function clear(questionId: string, scope: Scope | undefined): void {
  if (!ID_RE.test(questionId)) fail('invalid question_id');
  const file = storePath();
  const store = readStore(file);
  const root = projectRoot(process.cwd());
  const task = process.env.CODEX_THREAD_ID && TASK_RE.test(process.env.CODEX_THREAD_ID) ? process.env.CODEX_THREAD_ID : undefined;
  if (scope === 'task' && !task) fail('task scope requires a host-supplied Codex task id');
  const candidates = store.records.filter((record) => record.question_id === questionId && visible(record, root, task) && (!scope || record.scope === scope));
  if (candidates.length !== 1) fail(candidates.length > 1 ? 'ambiguous reset; specify scope' : 'no matching preference');
  const target = candidates[0];
  store.records = store.records.filter((record) => identity(record) !== identity(target));
  atomicWriteSync(file, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify(target) + '\n');
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--write') {
    if (args.length !== 1) fail('--write requires one JSON payload');
    let input: unknown;
    try { input = JSON.parse(args[0]); } catch { fail('invalid JSON payload'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid JSON payload');
    write(input as Record<string, unknown>);
    return;
  }
  if (command === '--read') {
    const task = process.env.CODEX_THREAD_ID && TASK_RE.test(process.env.CODEX_THREAD_ID) ? process.env.CODEX_THREAD_ID : undefined;
    const root = projectRoot(process.cwd());
    const store = readStore(storePath());
    process.stdout.write(JSON.stringify({ version: 2, records: store.records.filter((record) => visible(record, root, task)) }, null, 2) + '\n');
    return;
  }
  if (command === '--check') {
    if (args.length === 0) { process.stdout.write('ASK_NORMALLY\n'); return; }
    if (args.length !== 2 || args[0] !== '--context') fail('--check accepts only --context JSON');
    let input: unknown;
    try { input = JSON.parse(args[1]); } catch { fail('invalid JSON payload'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid JSON payload');
    const choice = advisoryChoice(input as { question_id: unknown; question: unknown; options: unknown });
    process.stdout.write(JSON.stringify({ decision: 'ASK_NORMALLY', ...(choice ? { advisory_choice: choice } : {}) }) + '\n');
    return;
  }
  if (command === '--clear') {
    const questionId = args[0];
    if (!questionId) fail('--clear requires question_id');
    let scope: Scope | undefined;
    if (args.length === 3 && args[1] === '--scope' && ['user', 'project', 'task'].includes(args[2])) scope = args[2] as Scope;
    else if (args.length !== 1) fail('--clear accepts only --scope user|project|task');
    clear(questionId, scope);
    return;
  }
  fail('unsupported command');
}

if (import.meta.main) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : 'bfstack-question-preference: failed'); process.exit(1); }
}
