/**
 * Shared config for browse CLI + server.
 *
 * Resolution:
 *   1. BROWSE_STATE_FILE env → derive stateDir from parent
 *   2. git rev-parse --show-toplevel → projectDir/.bfstack/
 *   3. process.cwd() fallback (non-git environments)
 *
 * The CLI computes the config and passes BROWSE_STATE_FILE to the
 * spawned server. The server derives all paths from that env var.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mkdirSecure } from './file-permissions';

export interface BrowseConfig {
  projectDir: string;
  stateDir: string;
  stateFile: string;
  consoleLog: string;
  networkLog: string;
  dialogLog: string;
  auditLog: string;
}

/**
 * Detect the git repository root, or null if not in a repo / git unavailable.
 */
export function getGitRoot(): string | null {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    windowsHide: true,
      stdout: 'pipe',
      stderr: 'pipe',
      // Raised from 2s: under heavy machine load `git rev-parse` routinely
      // takes >2s (measured 6.3s spikes). Timing out here returns null →
      // resolveConfig falls back to process.cwd() → state files scatter across
      // cwds (split-brain daemons; `goto` and `url` hit different servers). 8s
      // still bounds a genuinely broken .git from hanging the CLI forever.
      timeout: 8_000,
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve all browse config paths.
 *
 * If BROWSE_STATE_FILE is set (e.g. by CLI when spawning server, or by
 * tests for isolation), all paths are derived from it. Otherwise, the
 * project root is detected via git or cwd.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): BrowseConfig {
  let stateFile: string;
  let stateDir: string;
  let projectDir: string;

  if (env.BROWSE_STATE_FILE) {
    stateFile = env.BROWSE_STATE_FILE;
    stateDir = path.dirname(stateFile);
    projectDir = path.dirname(stateDir); // parent of .bfstack/
  } else {
    projectDir = getGitRoot() || process.cwd();
    stateDir = path.join(projectDir, '.bfstack');
    stateFile = path.join(stateDir, 'browse.json');
  }

  return {
    projectDir,
    stateDir,
    stateFile,
    consoleLog: path.join(stateDir, 'browse-console.log'),
    networkLog: path.join(stateDir, 'browse-network.log'),
    dialogLog: path.join(stateDir, 'browse-dialog.log'),
    auditLog: path.join(stateDir, 'browse-audit.jsonl'),
  };
}

function isIgnoredByGit(projectDir: string, relPath: string): boolean {
  try {
    const proc = Bun.spawnSync(['git', 'check-ignore', '-q', '--', relPath], {
    windowsHide: true,
      cwd: projectDir, stdout: 'pipe', stderr: 'pipe',
      timeout: 2_000,
    });
    return proc.exitCode === 0;
  } catch {
    // git not found, timed out, or not a repo (exit 128). Fall through to
    // the text-check path — appending is the safe default when unsure.
    return false;
  }
}

/**
 * Create the .bfstack/ state directory if it doesn't exist.
 * Throws with a clear message on permission errors.
 */
export function ensureStateDir(config: BrowseConfig): void {
  try {
    mkdirSecure(config.stateDir);
  } catch (err: any) {
    if (err.code === 'EACCES') {
      throw new Error(`Cannot create state directory ${config.stateDir}: permission denied`);
    }
    if (err.code === 'ENOTDIR') {
      throw new Error(`Cannot create state directory ${config.stateDir}: a file exists at that path`);
    }
    throw err;
  }

  // Load-bearing guard: a self-contained ignore INSIDE the state dir so its
  // contents can NEVER be `git add`-ed, regardless of the project's own
  // .gitignore (which may be absent, or the append below may silently fail).
  // The state dir holds session-state.json (live cookies + localStorage/
  // sessionStorage tokens) and browse-network.log / browse-audit.jsonl
  // (captured request headers can carry bearer tokens). Written unconditionally,
  // synchronously, before return — the project-.gitignore dance below is now
  // redundant safety, kept so `.bfstack/` still reads as ignored in git status.
  try {
    fs.writeFileSync(path.join(config.stateDir, '.gitignore'), '*\n');
  } catch {
    // Best-effort; the project-.gitignore path below is the fallback.
  }

  // Ensure .bfstack/ is in the project's .gitignore
  // First, check if git already ignores .bfstack/ (via global excludes, .git/info/exclude, or parent .gitignore)
  if (isIgnoredByGit(config.projectDir, '.bfstack/')) return;

  const gitignorePath = path.join(config.projectDir, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.match(/^\.bfstack\/?$/m)) {
      const separator = content.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}.bfstack/\n`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      // Write warning to server log (visible even in daemon mode)
      const logPath = path.join(config.stateDir, 'browse-server.log');
      try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Warning: could not update .gitignore at ${gitignorePath}: ${err.message}\n`);
      } catch {
        // stateDir write failed too — nothing more we can do
      }
    }
    // ENOENT (no .gitignore) — skip silently
  }
}

/**
 * Derive a slug from the git remote origin URL (owner-repo format).
 * Falls back to the directory basename if no remote is configured.
 */
export function getRemoteSlug(): string {
  try {
    const proc = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
    windowsHide: true,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2_000,
    });
    if (proc.exitCode !== 0) throw new Error('no remote');
    const url = proc.stdout.toString().trim();
    // SSH:   git@github.com:owner/repo.git → owner-repo
    // HTTPS: https://github.com/owner/repo.git → owner-repo
    const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return `${match[1]}-${match[2]}`;
    throw new Error('unparseable');
  } catch {
    const root = getGitRoot();
    return path.basename(root || process.cwd());
  }
}

/**
 * Read the binary version (git SHA) from browse/dist/.version.
 * Returns null if the file doesn't exist or can't be read.
 */
export function readVersionHash(execPath: string = process.execPath): string | null {
  try {
    const versionFile = path.resolve(path.dirname(execPath), '.version');
    return fs.readFileSync(versionFile, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the bfstack home directory.
 *
 * Honors the runtime's state-directory convention:
 *   1. BFSTACK_HOME env (explicit override)
 *   2. $HOME/.bfstack (default)
 */
export function resolveBfstackHome(): string {
  return process.env.BFSTACK_HOME || path.join(os.homedir(), '.bfstack');
}

/**
 * Read one key from the flat-YAML config store at <bfstack home>/config.yaml
 * (the shape bin/bfstack-config writes: `key: value` lines). Tolerates
 * optional single/double quotes around the value and a trailing `# comment`.
 * Returns the unquoted value string, or null when the file is missing or
 * unreadable or the key is absent.
 *
 * Shared parser for flat-YAML configuration values.
 */
export function readBfstackConfigYamlKey(key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const yaml = fs.readFileSync(path.join(resolveBfstackHome(), 'config.yaml'), 'utf-8');
    // Last match wins: bin/bfstack-config's `get` reads duplicates with
    // `tail -1`, and both surfaces must agree on the same line.
    const all = [...yaml.matchAll(new RegExp(`^\\s*${escaped}\\s*:\\s*['"]?([^'"#\\n]*?)['"]?\\s*(?:#.*)?$`, 'gm'))];
    return all.length > 0 ? all[all.length - 1][1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the Chromium profile directory.
 *
 * Resolution order:
 *   1. `explicit` arg (no production caller passes one today; kept for
 *      direct programmatic use)
 *   2. CHROMIUM_PROFILE env (used by gbrowser's gbd per-workspace)
 *   3. <resolveBfstackHome()>/chromium-profile (default)
 */
export function resolveChromiumProfile(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  const env = process.env.CHROMIUM_PROFILE;
  if (env && env.length > 0) return env;
  return path.join(resolveBfstackHome(), 'chromium-profile');
}

/**
 * Pre-launch / shutdown cleanup of stale Chromium singleton lockfiles
 * (SingletonLock, SingletonSocket, SingletonCookie). Chromium's
 * ProcessSingleton refuses to start when these exist from a prior crash
 * (SIGKILL, hard crash, etc.) since they point at a PID that no longer exists.
 *
 * Defensive guard: refuses to operate unless ALL of these hold:
 *   1. `userDataDir` is an absolute path (no CWD-relative footguns)
 *   2. basename is exactly 'chromium-profile' OR the absolute path matches
 *      the absolute form of $CHROMIUM_PROFILE env value
 *
 * Prevents accidentally deleting lock files from an unrelated directory if
 * profile resolution is misconfigured upstream (CWD drift, env injection).
 *
 * Lock ownership cannot be reconstructed from a profile directory alone.
 * Verified cleanup is performed by the CLI while it still has the process
 * identity record; launch paths fail closed when a lock remains.
 */
export function cleanSingletonLocks(userDataDir: string): void {
  if (!path.isAbsolute(userDataDir)) {
    console.warn(`[browse] cleanSingletonLocks: refusing relative path: ${userDataDir}`);
    return;
  }
  const resolved = path.resolve(userDataDir);
  const basename = path.basename(resolved);
  const explicitProfile = process.env.CHROMIUM_PROFILE;
  const explicitAbs = explicitProfile && path.isAbsolute(explicitProfile)
    ? path.resolve(explicitProfile)
    : null;
  const isSafe = basename === 'chromium-profile' || (explicitAbs !== null && resolved === explicitAbs);
  if (!isSafe) {
    console.warn(`[browse] cleanSingletonLocks: refusing to clean unrecognized profile dir: ${resolved}`);
    return;
  }
  const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    .map(lockFile => path.join(resolved, lockFile))
    .filter(fs.existsSync);
  if (locks.length) {
    throw new Error(`[browse] Refusing to delete an unverified Chromium profile lock: ${locks[0]}`);
  }
}
