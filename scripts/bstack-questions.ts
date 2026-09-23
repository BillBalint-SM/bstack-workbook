// Host payload translation only. Preference rules and records stay in the
// existing gstack hooks. Async question acknowledgements are not user answers.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runBin } from '../hosts/claude/hooks/spawn-bin';

try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (!['PreToolUse', 'PostToolUse'].includes(event.hook_event_name)) throw new Error('Unsupported question event');
  if (!/^(?:.*[._])?request_user_input$/.test(event.tool_name ?? '')) process.exit(0);
  if (typeof event.cwd !== 'string' || !isAbsolute(event.cwd)) throw new Error('Invalid question cwd');
  for (const id of [event.session_id, event.tool_use_id]) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid question event identifier');
  }
  const questions = event.tool_input?.questions;
  if (!Array.isArray(questions) || !questions.length || questions.length > 3) throw new Error('Invalid questions');
  // Never pass secret answers to the upstream logger or automatic preferences.
  if (questions.some(q => q.isSecret === true || q.is_secret === true)) process.exit(0);
  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const q of questions) {
    if (typeof q.id !== 'string' || typeof q.question !== 'string' || !q.id || !q.question
      || ids.has(q.id) || texts.has(q.question) || !Array.isArray(q.options)
      || !q.options.length || q.options.some((o: any) => typeof o?.label !== 'string')) {
      throw new Error('Unsupported or ambiguous question schema');
    }
    ids.add(q.id); texts.add(q.question);
  }
  const translated: Record<string, unknown> = { ...event, tool_name: 'AskUserQuestion', tool_response: undefined,
    tool_input: { questions: questions.map(q => ({ question: q.question, options: q.options })) } };
  if (event.hook_event_name === 'PostToolUse') {
    const response = typeof event.tool_response === 'string' ? JSON.parse(event.tool_response) : event.tool_response;
    const answers: Record<string, string | string[]> = Object.create(null);
    for (const q of questions) {
      const values = response?.answers?.[q.id]?.answers;
      // Cancellation and missing answers must not be recorded as a user choice.
      if (!Array.isArray(values) || !values.length || values.some((v: unknown) => typeof v !== 'string')) {
        throw new Error('No confirmed answer for every question');
      }
      answers[q.question] = values.length === 1 ? values[0] : values;
    }
    translated.tool_response = { answers };
  }
  const slugResult = runBin('gstack-slug', [], { cwd: event.cwd, encoding: 'utf8', timeout: 3000 });
  const slug = String(slugResult.stdout ?? '').match(/^SLUG=([a-zA-Z0-9._-]+)$/m)?.[1];
  if (slugResult.status !== 0 || !slug || slug === '.' || slug === '..') throw new Error('Cannot resolve question project');
  const script = event.hook_event_name === 'PreToolUse' ? 'question-preference-hook.ts' : 'question-log-hook.ts';
  const result = spawnSync(process.execPath, [join(import.meta.dir, '../hosts/claude/hooks', script)], {
    cwd: event.cwd, input: JSON.stringify(translated), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, GSTACK_PROJECT_SLUG: slug, CONDUCTOR_WORKSPACE_PATH: '', CONDUCTOR_PORT: '' },
    windowsHide: true, shell: false,
  });
  if (result.error || result.status !== 0) throw new Error('Question hook failed');
  process.stdout.write(result.stdout);
} catch {
  // Like upstream, do not block the user's question on an analytics failure.
  // Do not log raw payloads: they can contain private answers or credentials.
  console.error('bstack: question hook skipped; unsupported payload or runtime failure');
}
