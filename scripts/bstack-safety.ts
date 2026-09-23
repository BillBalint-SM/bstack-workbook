// Codex event adapter. Classifiers remain upstream-owned; approval grants are
// exact, session-scoped and single-use, never an override for a hard denial.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bashScriptInvocation } from '../lib/gbrain-exec';

type State = { careful: boolean; freeze?: string; pending?: { id: string; key: string }; approved?: string };
const deny = (reason: string) => ({ hookSpecificOutput: {
  hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
} });
function canonical(path: string): string {
  const native = resolve(path.replace(/^\/([A-Za-z])\//, '$1:/'));
  if (existsSync(native)) return realpathSync(native);
  // existsSync follows links: a dangling link is not a safe new in-boundary file.
  if (lstatSync(native, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Unresolved symbolic link');
  const parent = dirname(native);
  if (parent === native) throw new Error('Cannot resolve path');
  return join(canonical(parent), basename(native));
}

export function safety(mode: string, action: string | undefined, value: string | undefined, input: string) {
  const stateRoot = process.env.GSTACK_HOME;
  if (!stateRoot || !isAbsolute(stateRoot)) throw new Error('Canonical GSTACK_HOME required');
  const event = mode === 'hook' ? JSON.parse(input) : undefined;
  const session = event?.session_id ?? process.env.CODEX_THREAD_ID;
  if (typeof session !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(session)) throw new Error('Actual Codex session ID required');
  if (event && (event.hook_event_name !== 'PreToolUse' || typeof event.cwd !== 'string' || !isAbsolute(event.cwd))) {
    throw new Error('Invalid PreToolUse event');
  }
  const directory = join(stateRoot, 'bstack', 'sessions');
  const file = join(directory, `${session}.json`);
  const state: State = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { careful: false };
  if (typeof state.careful !== 'boolean' || (state.freeze !== undefined && typeof state.freeze !== 'string')) {
    throw new Error('Invalid safety state');
  }
  if (state.freeze && !isAbsolute(state.freeze)) throw new Error('Invalid freeze state');
  if (state.pending && (!/^[0-9a-f-]{36}$/.test(state.pending.id) || !/^[0-9a-f]{64}$/.test(state.pending.key))) {
    throw new Error('Invalid pending confirmation');
  }
  if (state.approved !== undefined && (!state.pending || state.approved !== state.pending.key)) {
    throw new Error('Invalid approval state');
  }
  const save = () => {
    mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, file);
  };
  if (mode === 'safety') {
    if (action === 'careful' || action === 'guard') state.careful = true;
    if (action === 'freeze' || action === 'guard') {
      if (!value || !isAbsolute(value.replace(/^\/([A-Za-z])\//, '$1:/'))) throw new Error('Absolute freeze directory required');
      state.freeze = canonical(value);
    } else if (action === 'unfreeze') delete state.freeze;
    else if (action === 'approve') {
      if (!value || state.pending?.id !== value) throw new Error('No matching pending confirmation');
      // Call this ONLY after explicit user confirmation of the pending action.
      state.approved = state.pending.key;
    } else if (action !== 'careful') throw new Error('Unknown safety action');
    if (action !== 'approve') { delete state.pending; delete state.approved; }
    save();
    return { session, careful: state.careful, freeze: state.freeze ?? null };
  }
  if (!state.careful && !state.freeze) return {};
  const tool = event.tool_name;
  const args = event.tool_input;
  if (typeof tool !== 'string' || !args || typeof args !== 'object') throw new Error('Invalid tool payload');
  if (state.freeze) {
    const paths: string[] = [];
    if (tool === 'apply_patch' || tool.endsWith('__apply_patch')) {
      if (typeof args.command !== 'string') throw new Error('Missing patch text');
      for (const line of args.command.split(/\r?\n/)) {
        const match = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/);
        if (match) paths.push(match[1]);
      }
      if (!paths.length) throw new Error('Patch has no recognized file paths');
    } else if (tool === 'Edit' || tool === 'Write') {
      if (typeof args.file_path !== 'string') throw new Error('Missing file path');
      paths.push(args.file_path);
    }
    for (const path of paths) {
      const destination = canonical(resolve(event.cwd, path.replace(/^\/([A-Za-z])\//, '$1:/')));
      const rel = relative(canonical(state.freeze), destination);
      if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) {
        // Preserve upstream's local hook-fire record (pattern only, never paths).
        // As upstream, logging is best-effort and cannot turn a denial into allow.
        const logger = bashScriptInvocation('-c', ['source "$BSTACK_HOOK_HELPER"; gstack_hook_log_fire freeze boundary_deny']);
        if (logger) spawnSync(logger.cmd, logger.argv, {
          cwd: event.cwd, env: { ...process.env, BASH_ENV: '', ENV: '',
            BSTACK_HOOK_HELPER: join(import.meta.dir, '../careful/bin/hook-extract.sh').replaceAll('\\', '/') },
          timeout: 5000, windowsHide: true, shell: false, stdio: 'ignore',
        });
        return deny(`[bstack freeze] Outside edit boundary: ${destination}`);
      }
    }
  }
  const command = args.command ?? args.cmd;
  if (state.careful && (tool === 'Bash' || tool === 'exec_command' || tool.endsWith('__exec_command')) && typeof command !== 'string') {
    throw new Error('Missing shell command');
  }
  if (!state.careful || typeof command !== 'string' || tool === 'apply_patch' || tool.endsWith('__apply_patch')) return {};
  const bash = bashScriptInvocation(join(import.meta.dir, '../careful/bin/check-careful.sh'), []);
  if (!bash) throw new Error('Git Bash unavailable');
  const result = spawnSync(bash.cmd, bash.argv, {
    cwd: event.cwd, env: { ...process.env, BASH_ENV: '', ENV: '' },
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8',
    timeout: 15000, windowsHide: true, shell: false,
  });
  if (result.error || result.status !== 0) throw new Error('Safety classifier failed');
  const output = JSON.parse(result.stdout);
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Malformed classifier result');
  const decision = output.hookSpecificOutput;
  if ((!decision && Object.keys(output).length) || (decision && typeof decision.permissionDecisionReason !== 'string')) {
    throw new Error('Malformed classifier decision');
  }
  if (decision?.permissionDecision === 'deny') return deny(decision.permissionDecisionReason);
  if (decision && decision.permissionDecision !== 'ask') throw new Error('Unknown classifier decision');
  // Upstream is a Bash classifier; do not silently omit native Windows deletes.
  const windowsDelete = /\b(?:Remove-Item|Clear-Content|Remove-ItemProperty|Remove-Variable)\b|\b(?:rmdir|del|erase)\s/i.test(command);
  if (!decision && !windowsDelete) return {};
  const key = createHash('sha256').update(JSON.stringify([session, canonical(event.cwd), tool, args])).digest('hex');
  if (state.approved === key) {
    // Exclusive creation prevents concurrent retries from consuming one grant twice.
    const consumed = join(directory, `${session}.${state.pending?.id}.consumed`);
    try { writeFileSync(consumed, '', { flag: 'wx' }); } catch { return deny('Confirmation already consumed'); }
    delete state.approved;
    delete state.pending;
    save();
    return {};
  }
  state.pending = { id: randomUUID(), key };
  delete state.approved;
  save();
  return deny(`[bstack careful] ${decision?.permissionDecisionReason ?? 'Windows destructive command'}; ask the user about this exact action. Only after explicit confirmation, grant ${state.pending.id} using safety approve, then retry the unchanged tool call once. This does not override Codex permissions.`);
}

if (import.meta.main) {
  const [mode, action, value] = process.argv.slice(2);
  try {
    if (mode !== 'hook' && mode !== 'safety') throw new Error('Unknown mode');
    console.log(JSON.stringify(safety(mode, action, value, mode === 'hook' ? readFileSync(0, 'utf8') : '')));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Safety adapter failed';
    if (mode === 'hook') console.log(JSON.stringify(deny(`[bstack] ${reason}; blocked`)));
    else { console.error(reason); process.exitCode = 1; }
  }
}
