#!/usr/bin/env bun
// One local runtime for both the source plugin and Codex's cached plugin.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { bashScriptInvocation } from '../lib/process-exec';

const root = resolve(import.meta.dir, '..').replaceAll('\\', '/');
const pluginRoot = resolve(root, '..').replaceAll('\\', '/');
const [mode = 'check', skill] = process.argv.slice(2);

try {
  if (mode === 'read') {
    if (!skill || !/^[a-z][a-z0-9-]*$/.test(skill)) throw new Error('Invalid workflow name');
    // Cross-workflow reads must carry the same host translation as plugin entrypoints.
    // Read both first: a missing render must not return a partial instruction bundle.
    const contract = readFileSync(join(pluginRoot, 'HOST.md'), 'utf8');
    // The downstream update route deliberately replaces upstream self-update.
    // Cross-skill reads must not reintroduce reset/setup/relink instructions.
    const source = join(pluginRoot, 'skills', skill, 'SKILL.md');
    const workflow = readFileSync(source, 'utf8');
    process.stdout.write(contract + '\n\n---\n\n' + workflow);
    process.exit(0);
  }
  if (!['check', 'run', 'hook', 'safety', 'lifecycle', 'questions'].includes(mode)) throw new Error('Usage: bfstack-runtime.ts check | read <workflow> | run | hook | lifecycle | questions | safety <action> [value]');
  if (process.platform !== 'win32') throw new Error('This private runtime targets Windows + Git Bash, not WSL');
  const bundledBash = join(root, 'tools/git/bin/bash.exe');
  const bash = existsSync(bundledBash) ? { cmd: bundledBash }
    : process.env.BFSTACK_DEV_TOOLS === '1' ? bashScriptInvocation('-s', []) : null;
  if (!bash) throw new Error('Bundled Git Bash is missing');
  const normalize = (value: string) => {
    // Git Bash /c/... paths and native C:/... paths must identify one state store.
    const native = value.replace(/^\/([A-Za-z])\//, '$1:/');
    if (!isAbsolute(native) || !/^[A-Za-z]:[\\/]/.test(native)) throw new Error(`Not a Windows absolute path: ${value}`);
    return resolve(native).replaceAll('\\', '/');
  };
  const profile = normalize(process.env.USERPROFILE || homedir());
  const identity = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8').replace(/^\uFEFF/, '')).name;
  if (identity !== 'bontaflowstack') throw new Error('Unsupported plugin identity');
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('LOCALAPPDATA is required');
  const state = normalize(join(localAppData, 'BontaFlowStack/state'));
  // Refuse reparse points at the shared state boundaries before any helper can
  // follow them into another profile or a directory outside this package.
  for (const candidate of [
    join(localAppData, 'BontaFlowStack'),
    state, join(state, 'tmp'), join(state, 'projects'),
  ]) {
    try {
      if (lstatSync(candidate).isSymbolicLink()) throw new Error(`State path contains a junction or symlink: ${candidate}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const bundledJq = join(root, 'tools/jq.exe');
  const jq = existsSync(bundledJq) ? bundledJq : process.env.BFSTACK_DEV_TOOLS === '1' ? process.env.BFSTACK_DEV_JQ : undefined;
  if (!jq || !existsSync(jq)) throw new Error('Bundled jq is missing');
  const temporary = `${state}/tmp`;
  mkdirSync(temporary, { recursive: true });
  const env = { ...process.env, HOME: profile, USERPROFILE: profile, BFSTACK_HOME: state,
    // Hooks skip the interactive Bash bootstrap. Their child helpers need the
    // same packaged executables even on a machine without developer tools.
    PATH: [dirname(process.execPath), dirname(jq), join(root, 'tools/git/cmd'), join(root, 'tools/node'), process.env.PATH || ''].join(delimiter),
    BFSTACK_STATE_ROOT: state, BFSTACK_STATE_DIR: state, BFSTACK_ROOT: root, BFSTACK_SKILL_ROOT: root,
    BFSTACK_PLAN_DIR: '',
    TMPDIR: temporary, TMP: temporary, TEMP: temporary,
    BFSTACK_BIN: `${root}/bin`, BFSTACK_BROWSE: `${root}/browse/dist`, BFSTACK_DESIGN: `${root}/design/dist`,
    BFSTACK_NODE_PATH: `${root}/tools/node/node.exe`, PLAYWRIGHT_BROWSERS_PATH: `${root}/browse/.playwright-browsers`,
    B: `${root}/browse/dist/browse.exe`, BFSTACK_BROWSE_BIN: `${root}/browse/dist/browse.exe`, BROWSE_BIN: `${root}/browse/dist/browse.exe`,
    BFSTACK_CODEX_ROOT: root, BFSTACK_CODEX_SKILLS_ROOT: `${pluginRoot}/skills`, BFSTACK_PLUGIN_ROOT: pluginRoot,
    BFSTACK_BASH: bash.cmd, BFSTACK_HOST: 'codex', BFSTACK_RUNTIME: '1',
    BFSTACK_BUN_BIN: dirname(process.execPath).replaceAll('\\', '/'),
    // Use the actual executable's directory, not a user-specific package path.
    BFSTACK_JQ_BIN: dirname(jq).replaceAll('\\', '/'),
    // Do not let an unrelated Claude plugin or shell profile redirect this host.
    CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: '', CLAUDE_PLANS_DIR: '', BASH_ENV: '', ENV: '',
  };
  if (mode === 'lifecycle') {
    const input = readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
    const event = JSON.parse(input);
    if (event.hook_event_name !== 'Stop') throw new Error('Unsupported lifecycle event');
    if (typeof event.cwd !== 'string' || !isAbsolute(event.cwd)) throw new Error('Invalid lifecycle cwd');
    const result = spawnSync(process.execPath, [join(root, 'hosts/codex/hooks/timeline-stop-hook.ts')], {
      env, cwd: event.cwd, input, encoding: 'utf8', timeout: 5000,
      windowsHide: true, shell: false,
    });
    if (result.error || result.status !== 0) throw new Error('Timeline hook failed');
    process.exit(0);
  }
  if (mode === 'hook' || mode === 'safety' || mode === 'questions') {
    const script = mode === 'questions' ? 'bfstack-questions.ts' : 'bfstack-safety.ts';
    const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...process.argv.slice(2)], {
      env, stdio: 'inherit', windowsHide: true, shell: false,
    });
    if (result.error || result.status !== 0) throw new Error('Safety handler failed');
    process.exit(0);
  }
  const bootstrap = `export PATH="$(cygpath -u "$BFSTACK_BUN_BIN"):$(cygpath -u "$BFSTACK_JQ_BIN"):$PATH"
# MSYS rewrites inherited temporary paths to /tmp on startup. Pin the shell
# and its native children again after that conversion.
export TMPDIR="$BFSTACK_HOME/tmp" TMP="$BFSTACK_HOME/tmp" TEMP="$BFSTACK_HOME/tmp"
command -v jq >/dev/null 2>&1 || { echo 'bfstack: packaged jq is unavailable' >&2; exit 127; }
jq --version >/dev/null || exit $?
_slug_output="$("$BFSTACK_BIN/bfstack-slug")" || exit $?
_slug="$(printf '%s\\n' "$_slug_output" | sed -n 's/^SLUG=//p' | head -1)"
case "$_slug" in ''|.|..|*[!a-zA-Z0-9._-]*) echo 'Invalid project slug' >&2; exit 1;; esac
# Git Bash aliases Windows Temp as /tmp; its cache key can differ from the
# native Bun fallback's /c/Users/... key. Pin all children to this real result.
export BFSTACK_PROJECT_SLUG="$_slug"
if [ -L "$BFSTACK_HOME/projects/$_slug" ]; then
  echo 'bfstack: state project path contains a junction or symlink' >&2
  exit 1
fi
export BFSTACK_PLAN_DIR="$BFSTACK_HOME/projects/$_slug/ceo-plans"
`;
  let browserState = '';
  if (mode === 'run') {
    const session = process.env.CODEX_THREAD_ID;
    if (!session || !/^[A-Za-z0-9_-]{1,128}$/.test(session)) throw new Error('Actual Codex task ID is required for a workflow run');
    browserState = `export BROWSE_STATE_FILE="$BFSTACK_HOME/projects/$_slug/browser/$CODEX_THREAD_ID/browse.json"
export CHROMIUM_PROFILE="$BFSTACK_HOME/projects/$_slug/browser/$CODEX_THREAD_ID/chromium-profile"
export DESIGN_DAEMON_STATE_FILE="$BFSTACK_HOME/projects/$_slug/design/$CODEX_THREAD_ID/design.json"
`;
  }
  const body = mode === 'check'
    ? 'printf "BFSTACK_ROOT=%s\\nBFSTACK_HOME=%s\\n" "$BFSTACK_ROOT" "$BFSTACK_HOME"\nbun --version\njq --version\n"$BFSTACK_BIN/bfstack-paths"\n'
    : readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
  if (!body.trim()) throw new Error('Empty script');
  const result = spawnSync(bash.cmd, ['--noprofile', '--norc', '-s'], {
    input: bootstrap + browserState + body.replaceAll('\r\n', '\n'), env, stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true, shell: false,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`bfstack: ${error instanceof Error ? error.message : error}`);
  // Codex treats exit 2 as a blocking hook error; exit 1 can fail open.
  process.exit(['hook', 'safety'].includes(mode) ? 2 : ['lifecycle', 'questions'].includes(mode) ? 0 : 1);
}
