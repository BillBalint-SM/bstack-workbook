import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('Codex questions preserve real answers, per-question dedup, project preferences and secret exclusions', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bstack questions '));
  const state = join(scratch, '.gstack');
  mkdirSync(state);
  writeFileSync(join(state, 'config.yaml'), 'telemetry: off\nupdate_check: false\n');
  const env = { ...process.env, HOME: scratch, USERPROFILE: scratch, GSTACK_HOME: state,
    GSTACK_STATE_ROOT: state, GSTACK_PROJECT_SLUG: '', GSTACK_QUESTION_LOG_NO_DERIVE: '1' };
  const cli = resolve(import.meta.dir, '../scripts/bstack-runtime.ts');
  const run = (mode: string, input: string) => spawnSync(process.execPath, [cli, mode], {
    env, cwd: scratch, input, encoding: 'utf8', timeout: 20000, windowsHide: true,
  });
  try {
    const slug = run('run', '"$GSTACK_BIN/gstack-slug"').stdout.match(/^SLUG=(.+)$/m)![1].trim();
    const project = join(state, 'projects', slug);
    mkdirSync(project, { recursive: true });
    const questions = ['layout', 'color'].map(id => ({ id, header: id, question: `Choose ${id} <gstack-qid:fixture-${id}>`, options: [{ label: 'A (recommended)' }, { label: 'B' }] }));
    const event = { hook_event_name: 'PostToolUse', session_id: 'fixture-session', tool_use_id: 'fixture-call', cwd: scratch,
      tool_name: 'request_user_input', tool_input: { questions }, tool_response: { answers: { layout: { answers: ['B'] }, color: { answers: ['A (recommended)'] } } } };
    const result = run('questions', JSON.stringify(event));
    expect(result.status, result.stderr).toBe(0);
    const log = join(project, 'question-log.jsonl');
    const text = readFileSync(log, 'utf8');
    const records = text.trim().split('\n').map(line => JSON.parse(line));
    expect(records.map(r => [r.question_id, r.user_choice])).toEqual([['fixture-layout', 'B'], ['fixture-color', 'A']]);
    expect(run('questions', JSON.stringify(event)).status).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe(text);
    for (const unsupported of [
      { ...event, tool_name: 'request_user_input_async' },
      { ...event, tool_response: { answers: {} } },
      { ...event, tool_response: { answers: { layout: { answers: [] }, color: { answers: ['B'] } } } },
    ]) {
      expect(run('questions', JSON.stringify(unsupported)).status).toBe(0);
      expect(readFileSync(log, 'utf8')).toBe(text);
    }
    const secret = { ...event, tool_use_id: 'secret-call', tool_input: { questions: questions.map(q => ({ ...q, isSecret: true })) } };
    expect(run('questions', JSON.stringify(secret)).status).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe(text);
    writeFileSync(join(project, 'question-preferences.json'), JSON.stringify({ 'fixture-layout': 'never-ask' }));
    const pre = { ...event, hook_event_name: 'PreToolUse', tool_use_id: 'pre-call', tool_input: { questions: [questions[0]] } };
    const automatic = run('questions', JSON.stringify(pre));
    expect(JSON.parse(automatic.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(automatic.stdout).toContain('auto-decide');
    const oneWay = { ...pre, tool_use_id: 'destructive-call', tool_input: { questions: [{ ...questions[0], question: 'Delete production database? <gstack-qid:fixture-layout>' }] } };
    expect(run('questions', JSON.stringify(oneWay)).stdout.trim()).toBe('');
    expect(run('questions', '{').status).toBe(0);
    expect(run('questions', JSON.stringify({ ...event, session_id: 'other-session' })).status).toBe(0);
    expect(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      .filter(record => record.session_id === 'other-session')).toHaveLength(2);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 120000);
