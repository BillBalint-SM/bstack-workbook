import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('Windows evidence records the actual project and binds freshness to tested content', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bstack evidence '));
  const repo = join(scratch, 'repo with spaces');
  const state = join(scratch, 'state with spaces');
  const evidence = resolve(import.meta.dir, '../bin/gstack-evidence');
  mkdirSync(repo);
  mkdirSync(state);
  const env = { ...process.env, GSTACK_HOME: state, GSTACK_STATE_ROOT: state, HOME: scratch,
    GSTACK_BASH: 'C:\\Program Files\\Git\\bin\\bash.exe', GSTACK_TELEMETRY: 'off' };
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', timeout: 15000, windowsHide: true });
    expect(r.status).toBe(0);
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [evidence, ...args], {
    cwd: repo, env, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  try {
    git('init', '-b', 'main');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'bstack fixture');
    git('remote', 'add', 'origin', 'https://github.com/bstack-fixture/evidence.git');
    writeFileSync(join(repo, 'source.txt'), 'before\n');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const recorded = run('run', '--label', 'test', '--', 'echo verified');
    expect(recorded.status).toBe(0);
    const checked = run('check', '--label', 'test', '--expect-cmd', 'echo verified');
    expect(checked.stdout).toContain('EVIDENCE: FRESH');
    expect(checked.status).toBe(0);
    const ledger = join(state, 'projects', 'bstack-fixture-evidence', 'main-evidence.jsonl');
    const record = JSON.parse(readFileSync(ledger, 'utf8').trim());
    expect(record.wtree).toMatch(/^[a-f0-9]{40}$/);
    writeFileSync(join(repo, 'source.txt'), 'after\n');
    expect(run('check', '--label', 'test').stdout).toContain('EVIDENCE: STALE');
    expect(run('run', '--label', 'failed', '--', 'exit 17').status).toBe(17);
    expect(run('check', '--label', 'failed').stdout).toContain('recorded run failed');
    expect(run('run', '--label', 'changed', '--', 'echo changed >> source.txt').status).toBe(0);
    expect(run('check', '--label', 'changed').stdout).toContain('record has no content fingerprint');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
