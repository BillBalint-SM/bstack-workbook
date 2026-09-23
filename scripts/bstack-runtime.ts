#!/usr/bin/env bun
// One local runtime for both the source plugin and Codex's cached plugin.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { bashScriptInvocation } from '../lib/gbrain-exec';

const root = resolve(import.meta.dir, '..').replaceAll('\\', '/');
const [mode = 'check', skill] = process.argv.slice(2);

try {
  if (mode === 'read') {
    if (!skill || !/^[a-z][a-z0-9-]*$/.test(skill)) throw new Error('Invalid workflow name');
    const folder = skill === 'bstack' ? 'gstack' : skill === 'upgrade' ? 'gstack-upgrade' : `gstack-${skill}`;
    // Cross-workflow reads must carry the same host translation as plugin entrypoints.
    // Read both first: a missing render must not return a partial instruction bundle.
    const contract = readFileSync(join(root, 'plugin/bstack/HOST.md'), 'utf8');
    // The downstream update route deliberately replaces upstream self-update.
    // Cross-skill reads must not reintroduce reset/setup/relink instructions.
    const source = skill === 'upgrade'
      ? join(root, 'plugin/bstack/skills/upgrade/SKILL.md')
      : join(root, '.agents/skills', folder, 'SKILL.md');
    const workflow = readFileSync(source, 'utf8');
    process.stdout.write(contract + '\n\n---\n\n' + workflow);
    process.exit(0);
  }
  if (!['check', 'run', 'hook', 'safety', 'lifecycle', 'questions'].includes(mode)) throw new Error('Usage: bstack-runtime.ts check | read <workflow> | run | hook | lifecycle | questions | safety <action> [value]');
  if (process.platform !== 'win32') throw new Error('This private runtime targets Windows + Git Bash, not WSL');
  const bash = bashScriptInvocation('-s', []);
  if (!bash) throw new Error('Git Bash not found; set GSTACK_BASH to its bash.exe');
  const normalize = (value: string) => {
    // Git Bash /c/... paths and native C:/... paths must identify one state store.
    const native = value.replace(/^\/([A-Za-z])\//, '$1:/');
    if (!isAbsolute(native) || !/^[A-Za-z]:[\\/]/.test(native)) throw new Error(`Not a Windows absolute path: ${value}`);
    return resolve(native).replaceAll('\\', '/');
  };
  const profile = normalize(process.env.USERPROFILE || homedir());
  const state = normalize(process.env.GSTACK_STATE_ROOT || process.env.GSTACK_HOME || join(profile, '.bstack/state'));
  if (process.env.GSTACK_HOME && normalize(process.env.GSTACK_HOME).toLowerCase() !== state.toLowerCase()) {
    throw new Error('GSTACK_HOME and GSTACK_STATE_ROOT disagree; refusing split state');
  }
  const jq = Bun.which('jq');
  const jqDir = process.env.BSTACK_JQ_BIN || (jq ? dirname(realpathSync(jq)) : '');
  const env = { ...process.env, HOME: profile, USERPROFILE: profile, GSTACK_HOME: state,
    GSTACK_STATE_ROOT: state, GSTACK_STATE_DIR: state, GSTACK_ROOT: root,
    GSTACK_BIN: `${root}/bin`, GSTACK_BROWSE: `${root}/browse/dist`, GSTACK_DESIGN: `${root}/design/dist`,
    GSTACK_CODEX_ROOT: root, GSTACK_CODEX_SKILLS_ROOT: `${root}/.agents/skills`,
    GSTACK_BASH: bash.cmd, GSTACK_HOST: 'codex', BSTACK_RUNTIME: '1',
    BSTACK_BUN_BIN: dirname(process.execPath).replaceAll('\\', '/'),
    // Resolve the actual jq binary directory; a WinGet Links reparse point
    // may not be traversable by Git Bash in the restricted token.
    BSTACK_JQ_BIN: jqDir.replaceAll('\\', '/'),
    // Do not let an unrelated Claude plugin or shell profile redirect this host.
    CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: '', CLAUDE_PLANS_DIR: '', BASH_ENV: '', ENV: '',
  };
  if (mode === 'lifecycle') {
    const input = readFileSync(0, 'utf8');
    const event = JSON.parse(input);
    if (event.hook_event_name !== 'Stop') throw new Error('Unsupported lifecycle event');
    if (typeof event.cwd !== 'string' || !isAbsolute(event.cwd)) throw new Error('Invalid lifecycle cwd');
    // Delegate telemetry repair, including its unknown outcome and fail-open
    // semantics. Do not invent a successful workflow or duplicate its logic.
    const result = spawnSync(process.execPath, [join(root, 'hosts/claude/hooks/timeline-stop-hook.ts')], {
      env, cwd: event.cwd, input, encoding: 'utf8', timeout: 5000,
      windowsHide: true, shell: false,
    });
    if (result.error || result.status !== 0) throw new Error('Timeline hook failed');
    process.exit(0);
  }
  if (mode === 'hook' || mode === 'safety' || mode === 'questions') {
    const script = mode === 'questions' ? 'bstack-questions.ts' : 'bstack-safety.ts';
    const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...process.argv.slice(2)], {
      env, stdio: 'inherit', windowsHide: true, shell: false,
    });
    if (result.error || result.status !== 0) throw new Error('Safety handler failed');
    process.exit(0);
  }
  const bootstrap = `export PATH="$(cygpath -u "$BSTACK_BUN_BIN"):$PATH"
if ! command -v jq >/dev/null 2>&1 && [ -x "$BSTACK_JQ_BIN/jq.exe" ]; then
  export PATH="$(cygpath -u "$BSTACK_JQ_BIN"):$PATH"
fi
command -v jq >/dev/null 2>&1 || { echo 'bstack: jq is required. Install: winget install --id jqlang.jq --exact --source winget' >&2; exit 127; }
jq --version >/dev/null || exit $?
_slug_output="$("$GSTACK_BIN/gstack-slug")" || exit $?
_slug="$(printf '%s\\n' "$_slug_output" | sed -n 's/^SLUG=//p' | head -1)"
case "$_slug" in ''|.|..|*[!a-zA-Z0-9._-]*) echo 'Invalid project slug' >&2; exit 1;; esac
# Git Bash aliases Windows Temp as /tmp; its cache key can differ from the
# native Bun fallback's /c/Users/... key. Pin all children to this real result.
export GSTACK_PROJECT_SLUG="$_slug"
export GSTACK_PLAN_DIR="$GSTACK_HOME/projects/$_slug/ceo-plans"
`;
  const body = mode === 'check'
    ? 'printf "BSTACK_ROOT=%s\\nGSTACK_HOME=%s\\n" "$GSTACK_ROOT" "$GSTACK_HOME"\nbun --version\njq --version\n"$GSTACK_BIN/gstack-paths"\n'
    : readFileSync(0, 'utf8');
  if (!body.trim()) throw new Error('Empty script');
  const result = spawnSync(bash.cmd, ['--noprofile', '--norc', '-s'], {
    input: bootstrap + body.replaceAll('\r\n', '\n'), env, stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true, shell: false,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`bstack: ${error instanceof Error ? error.message : error}`);
  // Codex treats exit 2 as a blocking hook error; exit 1 can fail open.
  process.exit(mode === 'hook' ? 2 : ['lifecycle', 'questions'].includes(mode) ? 0 : 1);
}
