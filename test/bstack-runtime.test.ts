import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('bstack runs in Git Bash with isolated canonical state and exact child status', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bstack runtime '));
  const state = join(scratch, '.gstack');
  mkdirSync(state);
  writeFileSync(join(state, 'config.yaml'), 'telemetry: off\nupdate_check: false\n');
  const env = { ...process.env, USERPROFILE: scratch, HOME: scratch,
    GSTACK_HOME: state, GSTACK_STATE_ROOT: state, GSTACK_PLAN_DIR: '' };
  const cli = resolve(import.meta.dir, '../scripts/bstack-runtime.ts');
  const run = (mode: string, input = '', ...args: string[]) => spawnSync(process.execPath, [cli, mode, ...args], {
    cwd: scratch, env, input, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  try {
    expect(run('check').status).toBe(0);
    expect(run('check').stdout).toContain('jq-');
    const missingJq = spawnSync(process.execPath, [cli, 'run'], {
      cwd: scratch, env: { ...env, LOCALAPPDATA: scratch, Path: 'C:/Program Files/Git/usr/bin', PATH: 'C:/Program Files/Git/usr/bin' },
      input: 'echo MUST_NOT_RUN', encoding: 'utf8', timeout: 30000, windowsHide: true,
    });
    expect(missingJq.status, missingJq.stderr).toBe(127);
    expect(missingJq.stderr).toContain('jq is required');
    expect(missingJq.stdout).not.toContain('MUST_NOT_RUN');
    const child = run('run', 'printf verified > "$GSTACK_HOME/child.txt"\nexit 23\n');
    expect(child.status).toBe(23);
    expect(readFileSync(join(state, 'child.txt'), 'utf8')).toBe('verified');
    const paths = run('run', 'bun -e \'console.log(process.env.HOME);console.log(process.env.GSTACK_HOME)\'\n');
    expect(paths.stdout.replaceAll('\\', '/')).toContain(state.replaceAll('\\', '/'));
    expect(run('read', '', 'review').stdout).toContain('## Preamble (run first)');
    expect(run('read', '', '../review').status).not.toBe(0);
    expect(run('run', '"$GSTACK_BIN/gstack-skill-start" --skill review --model gpt\n').stdout).not.toContain('UPGRADE_AVAILABLE');
    writeFileSync(join(state, '.proactive-prompted'), '');
    const onboarding = run('run', '"$GSTACK_BIN/gstack-skill-start" --skill ship --model gpt\n');
    expect(onboarding.stdout).toContain('Offer optional Codex-native skill routing in AGENTS.md');
    expect(onboarding.stdout).not.toContain('Add routing rules to CLAUDE.md');
    writeFileSync(join(scratch, 'AGENTS.override.md'), '## Skill routing\nUse bstack.\n');
    expect(run('run', '"$GSTACK_BIN/gstack-skill-start" --skill ship --model gpt\n').stdout).toContain('HAS_ROUTING: yes');
    const git = (...args: string[]) => expect(spawnSync('git', args, { cwd: scratch, env, windowsHide: true }).status).toBe(0);
    git('init', '-b', 'main');
    git('config', 'user.name', 'bstack fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('remote', 'add', 'origin', 'https://github.com/bstack-fixture/runtime.git');
    // Clear no cache: upstream intentionally keeps project identity sticky.
    const slug = run('run', '"$GSTACK_BIN/gstack-slug"').stdout.match(/^SLUG=(.+)$/m)![1].trim();
    writeFileSync(join(scratch, 'source.txt'), 'fixture');
    git('add', 'source.txt');
    git('commit', '-m', 'fixture');
    expect(run('run', `"$GSTACK_BIN/gstack-review-log" '{"skill":"review","status":"pass"}'`).status).toBe(0);
    expect(run('run', `"$GSTACK_BIN/gstack-decision-log" '{"decision":"Keep fixtures local","rationale":"Isolated test","scope":"repo","source":"user"}'`).status).toBe(0);
    expect(run('run', `"$GSTACK_BIN/gstack-learnings-log" '{"skill":"review","type":"tool","key":"bstack-fixture","insight":"Local fixture","confidence":8,"source":"observed"}'`).status).toBe(0);
    const project = join(state, 'projects', slug);
    expect(JSON.parse(readFileSync(join(project, 'main-reviews.jsonl'), 'utf8').trim()).wtree).toMatch(/^[a-f0-9]{40}$/);
    expect(readFileSync(join(project, 'decisions.jsonl'), 'utf8')).toContain('Keep fixtures local');
    expect(readFileSync(join(project, 'learnings.jsonl'), 'utf8')).toContain('bstack-fixture');
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-File', resolve(import.meta.dir, '../plugin/bstack/scripts/bstack.ps1'), '-Mode', 'run'], {
      cwd: scratch, env, input: 'exit 29', encoding: 'utf8', timeout: 30000, windowsHide: true,
    });
    expect(ps.status, ps.stderr).toBe(29);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
