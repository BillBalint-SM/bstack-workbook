import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gitArgvIn } from './helpers/scratch-repo';

// Opt-in native integration: no model call, remote, credentials or permission bypass.
test.skipIf(!process.env.BSTACK_SANDBOX_CLI)('native Codex sandbox preserves journals, fingerprints, jq and failures', () => {
  const parent = process.env.BSTACK_SANDBOX_ROOT;
  if (!parent) throw new Error('Set BSTACK_SANDBOX_ROOT to a writable validation directory outside TEMP');
  if (!process.env.CODEX_HOME) throw new Error('Set CODEX_HOME to the already provisioned isolated Codex sandbox profile');
  const jq = Bun.which('jq');
  if (!jq) throw new Error('Install jq before running the native integration');
  // Explicitly authorized read/execute dependency; no Git or state grant is widened.
  const jqDir = dirname(realpathSync(jq));
  const scratch = mkdtempSync(join(parent, 'runtime regression '));
  const repo = join(scratch, 'work');
  const profile = join(scratch, 'profile');
  const state = join(profile, '.gstack');
  mkdirSync(repo);
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'config.yaml'), 'telemetry: off\nupdate_check: false\nartifacts_sync: false\n');
  const env = { ...process.env, USERPROFILE: profile, HOME: profile, GSTACK_HOME: state,
    GSTACK_STATE_ROOT: state, GSTACK_PROJECT_SLUG: '', GSTACK_PLAN_DIR: '' };
  const git = (...args: string[]) => {
    const result = gitArgvIn(repo, args);
    expect(result.status, result.stderr?.toString()).toBe(0);
    return result.stdout.toString().trim();
  };
  const snapshot = (directory: string): string => readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
      const file = join(directory, entry.name);
      return entry.name + ':' + (entry.isDirectory() ? snapshot(file) : readFileSync(file).toString('hex'));
    }).join('\n');
  const run = (input: string) => spawnSync(process.env.BSTACK_SANDBOX_CLI!, [
    'sandbox', '-P', 'bstack-regression', '--include-managed-config', '-c',
    `permissions.bstack-regression={extends=":workspace",workspace_roots={${JSON.stringify(state.replaceAll('\\', '/'))}=true},filesystem={${JSON.stringify(jqDir.replaceAll('\\', '/'))}="read"}}`,
    '-C', repo, 'powershell.exe', '-NoProfile', '-File',
    resolve(import.meta.dir, '../plugin/bstack/scripts/bstack.ps1'), '-Mode', 'run',
  ], { cwd: repo, env, input, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'bstack fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(repo, 'source.txt'), 'before\n');
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
    git('add', '.');
    git('commit', '-m', 'fixture');
    writeFileSync(join(repo, 'source.txt'), 'after\n');
    const before = snapshot(join(repo, '.git'));
    const result = run(`set -e
"$GSTACK_BIN/gstack-review-log" '{"skill":"review","status":"issues_open","source":"regression-fixture","wtree":"forged"}'
"$GSTACK_BIN/gstack-learnings-log" '{"type":"tool","key":"sandbox-fixture","insight":"Isolated regression","confidence":8,"source":"observed"}'
"$GSTACK_BIN/gstack-timeline-log" '{"skill":"fixture","event":"started"}'
"$GSTACK_BIN/gstack-question-preference" --check fixture-choice
"$GSTACK_BIN/gstack-review-read"
printf '%s' '{"tasks":[{"status":"done"},{"status":"open"}]}' | jq -ce '[.tasks[] | select(.status == "done")] | length == 1'
"$GSTACK_BIN/gstack-evidence" run --label test -- 'echo verified'
"$GSTACK_BIN/gstack-evidence" check --label test
`);
    expect(result.status, result.stdout + result.stderr + (result.error?.message ?? '')).toBe(0);
    expect(result.stdout).toContain('ASK_NORMALLY');
    expect(result.stdout).toContain('EVIDENCE: FRESH');
    const project = join(state, 'projects', 'work');
    const record = JSON.parse(readFileSync(join(project, 'main-reviews.jsonl'), 'utf8').trim());
    expect(record.wtree).toMatch(/^[a-f0-9]{40}$/);
    expect(result.stdout.split('---WTREE---')[1].trim().split(/\s/)[0]).toBe(record.wtree);
    expect(readFileSync(join(project, 'learnings.jsonl'), 'utf8')).toContain('sandbox-fixture');
    expect(readFileSync(join(project, 'timeline.jsonl'), 'utf8')).toContain('fixture');
    // The fix must not make the forbidden original object-store write possible.
    const forbidden = run('printf sandbox-protection-probe | git hash-object -w --stdin');
    expect(forbidden.status).not.toBe(0);
    expect(forbidden.stderr).toContain('insufficient permission');
    // Evidence and review must share the real fingerprint without writing Git metadata.
    expect(snapshot(join(repo, '.git'))).toBe(before);
    writeFileSync(join(repo, 'ignored.txt'), 'ignored\n');
    expect(run('"$GSTACK_BIN/gstack-wtree"').stdout.trim()).toBe(record.wtree);
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    const changed = run('"$GSTACK_BIN/gstack-wtree"');
    expect(changed.status, changed.stderr).toBe(0);
    expect(changed.stdout.trim()).not.toBe(record.wtree);
    expect(run('"$GSTACK_BIN/gstack-evidence" check --label test').stdout).toContain('EVIDENCE: STALE');
    expect(snapshot(join(repo, '.git'))).toBe(before);
    expect(run('exit 23').status).toBe(23);
    // Outside the sandbox, commit identical content to prove Git-tree equivalence.
    git('add', '.');
    git('commit', '-m', 'same tested content');
    expect(git('rev-parse', 'HEAD^{tree}')).toBe(changed.stdout.trim());
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
