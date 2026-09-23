import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('Codex Stop delegates append-only unknown completion, is idempotent and fails open', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bstack lifecycle '));
  const state = join(scratch, '.gstack');
  mkdirSync(state);
  writeFileSync(join(state, 'config.yaml'), 'telemetry: off\nupdate_check: false\n');
  const env = { ...process.env, HOME: scratch, USERPROFILE: scratch, GSTACK_HOME: state,
    GSTACK_STATE_ROOT: state, GSTACK_PROJECT_SLUG: '' };
  const cli = resolve(import.meta.dir, '../scripts/bstack-runtime.ts');
  const run = (mode: string, input: string) => spawnSync(process.execPath, [cli, mode], {
    env, cwd: scratch, input, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  try {
    const probe = run('run', '"$GSTACK_BIN/gstack-slug"');
    expect(probe.status).toBe(0);
    const slug = probe.stdout.match(/^SLUG=(.+)$/m)![1].trim();
    const project = join(state, 'projects', slug);
    mkdirSync(project, { recursive: true });
    const timeline = join(project, 'timeline.jsonl');
    const original = JSON.stringify({ skill: 'review', event: 'started', session: 'fixture-run', branch: 'main' }) + '\n';
    writeFileSync(timeline, original);
    const input = JSON.stringify({ hook_event_name: 'Stop', cwd: scratch, session_id: 'fixture-codex' });
    const result = run('lifecycle', input);
    expect(result.status, result.stderr).toBe(0);
    const repaired = readFileSync(timeline, 'utf8');
    expect(repaired.startsWith(original)).toBe(true);
    const completion = JSON.parse(repaired.trim().split('\n')[1]);
    expect(completion).toMatchObject({ skill: 'review', event: 'completed', session: 'fixture-run', outcome: 'unknown', source: 'stop-hook' });
    expect(run('lifecycle', input).status).toBe(0);
    expect(readFileSync(timeline, 'utf8')).toBe(repaired);
    expect(run('lifecycle', '{').status).toBe(0);
    expect(run('lifecycle', JSON.stringify({ hook_event_name: 'PreToolUse', cwd: scratch })).status).toBe(0);
    expect(readFileSync(timeline, 'utf8')).toBe(repaired);
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-File', resolve(import.meta.dir, '../plugin/bstack/scripts/bstack.ps1'), '-Mode', 'lifecycle'], {
      env, cwd: scratch, input, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    expect(ps.status, ps.stderr).toBe(0);
    expect(readFileSync(timeline, 'utf8')).toBe(repaired);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60000);
