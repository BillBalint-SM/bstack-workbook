import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('Codex safety denies before confirmation, consumes exact grants once, preserves hard denies and edit boundaries', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bstack safety '));
  const state = join(scratch, '.gstack');
  const inside = join(scratch, 'src');
  mkdirSync(inside);
  const cli = resolve(import.meta.dir, '../scripts/bstack-safety.ts');
  const launcher = resolve(import.meta.dir, '../plugin/bstack/scripts/bstack.ps1');
  const env = { ...process.env, GSTACK_HOME: state, HOME: scratch, USERPROFILE: scratch, CODEX_THREAD_ID: 'fixture-session' };
  const run = (args: string[], input = '') => spawnSync(process.execPath, [cli, ...args], {
    env, cwd: scratch, input, encoding: 'utf8', timeout: 20000, windowsHide: true,
  });
  const event = (command: string, tool_name = 'Bash', session_id = 'fixture-session') => JSON.stringify({
    hook_event_name: 'PreToolUse', session_id, cwd: scratch, tool_name, tool_input: { command },
  });
  const hook = (input: string) => JSON.parse(run(['hook'], input).stdout);
  const pending = () => JSON.parse(readFileSync(join(state, 'bstack/sessions/fixture-session.json'), 'utf8')).pending.id;
  try {
    expect(hook(event('git reset --hard'))).toEqual({});
    expect(run(['safety', 'guard', inside]).status).toBe(0);
    expect(hook(event('git status'))).toEqual({});
    expect(hook(event('git reset --hard')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(run(['safety', 'approve', 'wrong']).status).toBe(1);
    expect(run(['safety', 'approve', pending()]).status).toBe(0);
    expect(hook(event('git reset --hard'))).toEqual({});
    expect(hook(event('git reset --hard')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(run(['safety', 'approve', pending()]).status).toBe(0);
    expect(hook(event('git reset --hard HEAD~1')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(hook(event('rm -rf /')).hookSpecificOutput.permissionDecisionReason).toContain('HIGH');
    expect(hook(event('Remove-Item -Recurse ./data')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(hook(event('git reset --hard', 'Bash', 'other-session'))).toEqual({});
    expect(hook(event('*** Begin Patch\n*** Add File: src/new/file.txt\n+ok\n*** End Patch', 'apply_patch'))).toEqual({});
    expect(hook(event('*** Begin Patch\n*** Update File: src/a.txt\n*** Move to: elsewhere/a.txt\n*** End Patch', 'apply_patch')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(hook(event('*** Begin Patch\n*** Add File: src/../../outside.txt\n+x\n*** End Patch', 'apply_patch')).hookSpecificOutput.permissionDecision).toBe('deny');
    const outside = join(scratch, 'elsewhere');
    mkdirSync(outside);
    symlinkSync(outside, join(inside, 'junction'), 'junction');
    expect(hook(event('*** Begin Patch\n*** Add File: src/junction/new.txt\n+x\n*** End Patch', 'apply_patch')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(hook('{')).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny');
    expect(run(['safety', 'unfreeze']).status).toBe(0);
    expect(hook(event('*** Begin Patch\n*** Add File: outside.txt\n+x\n*** End Patch', 'apply_patch'))).toEqual({});
    const ps = (args: string[], input = '') => spawnSync('powershell.exe', ['-NoProfile', '-File', launcher, ...args], {
      env, cwd: scratch, input, encoding: 'utf8', timeout: 30000, windowsHide: true,
    });
    expect(ps(['-Mode', 'safety', '-Action', 'freeze', '-Value', inside]).status).toBe(0);
    const bridge = ps(['-Mode', 'hook'], event('*** Begin Patch\n*** Add File: outside.txt\n+x\n*** End Patch', 'apply_patch'));
    expect(bridge.status, bridge.stderr).toBe(0);
    expect(JSON.parse(bridge.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    const unicode = ps(['-Mode', 'hook'], event('*** Begin Patch\n*** Add File: src/árvíz.txt\n+x\n*** End Patch', 'apply_patch'));
    expect(JSON.parse(unicode.stdout)).toEqual({});
    const unicodeDirectory = join(inside, 'árvíz');
    mkdirSync(unicodeDirectory);
    expect(ps(['-Mode', 'safety', '-Action', 'freeze', '-Value', unicodeDirectory]).status).toBe(0);
    expect(JSON.parse(ps(['-Mode', 'hook'], event('*** Begin Patch\n*** Add File: src/árvíz/new.txt\n+x\n*** End Patch', 'apply_patch')).stdout)).toEqual({});
    expect(ps(['-Mode', 'hook'], '{').stdout).toContain('"permissionDecision":"deny"');
    const failure = spawnSync('powershell.exe', ['-NoProfile', '-File', launcher, '-Mode', 'hook'], {
      env: { ...env, GSTACK_STATE_ROOT: join(scratch, 'different-state') }, cwd: scratch,
      input: event('git status'), encoding: 'utf8', timeout: 30000, windowsHide: true,
    });
    expect(failure.status).toBe(2);
    const analytics = readFileSync(join(state, 'analytics/skill-usage.jsonl'), 'utf8');
    expect(analytics).toContain('boundary_deny');
    expect(analytics).toContain('git_reset_hard');
    expect(analytics).not.toContain('outside.txt');
    writeFileSync(join(state, 'bstack/sessions/fixture-session.json'), JSON.stringify({ careful: true, approved: 'unbound' }));
    expect(hook(event('git status')).hookSpecificOutput.permissionDecision).toBe('deny');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 120000);
