/**
 * Atomic-write helper for agent-authored browser-skills (D3 from Phase 2 plan).
 *
 * /skillify stages a candidate skill into ~/.bfstack/.tmp/skillify-<spawnId>/,
 * runs $B skill test against it, and only renames the directory into its final
 * tier path on success + user approval. On failure or rejection, the staged
 * directory is removed entirely — no half-written skill ever appears in
 * $B skill list, no tombstone for something the user never approved.
 *
 *   stageSkill    — write all files into the staging dir, return its path
 *   commitSkill   — atomic rename into the final tier path; refuses to clobber
 *   discardStaged — rm -rf the staged dir (called on test fail or reject)
 *
 * Symlink discipline: lstat() the staging dir before rename to refuse moves
 * through symlinks; realpath() the final tier root to ensure the destination
 * lands inside the expected directory tree.
 */

import * as fs from 'fs';
import * as path from 'path';
import { mkdirSecure } from './file-permissions';
import { isPathWithin } from './platform';
import type { TierPaths } from './browser-skills';
import { defaultTierPaths } from './browser-skills';
import { resolveBfstackHome } from './config';

// ─── Naming validation ──────────────────────────────────────────

/**
 * Skill names must be safe directory names: lowercase letters, digits, dashes.
 * Starts with a letter, no consecutive dashes, no trailing dash, ≤64 chars.
 * Rejects '..', leading dots, slashes, anything that could escape the tier dir.
 */
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function validateSkillName(name: string): void {
  if (!name) throw new Error('Skill name is empty.');
  if (name.length > 64) throw new Error(`Skill name too long (${name.length} > 64).`);
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid skill name "${name}". Must be lowercase letters/digits/dashes, ` +
      `start with a letter, no leading/trailing/consecutive dashes.`,
    );
  }
}

// ─── Staging ────────────────────────────────────────────────────

export interface StageSkillOptions {
  name: string;
  /** Map of relative path → contents. Path may contain '/' for nested dirs. */
  files: Map<string, string | Buffer>;
  /** Optional override (tests pass synthetic spawn ids). */
  spawnId?: string;
  /** Optional override (tests pass a fake tmp root). */
  tmpRoot?: string;
}

/**
 * Stage a skill into the staging tree:
 *   <tmpRoot>/.bfstack/.tmp/skillify-<spawnId>/<name>/
 *
 * The leaf <name> directory is what gets renamed during commit. The wrapper
 * skillify-<spawnId>/ is per-spawn so concurrent /skillify invocations don't
 * collide. Returns the absolute path to the staged skill dir (ending in <name>).
 */
export function stageSkill(opts: StageSkillOptions): string {
  validateSkillName(opts.name);
  if (opts.files.size === 0) {
    throw new Error('stageSkill: files map is empty.');
  }

  const spawnId = opts.spawnId ?? generateSpawnId();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(spawnId)) throw new Error('Invalid staging id.');
  // Validate every member before creating any files, including Windows paths.
  for (const relPath of opts.files.keys()) {
    if (!relPath || path.win32.isAbsolute(relPath) || /[:\x00]/.test(relPath)
      || relPath.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Invalid file path in stageSkill: "${relPath}".`);
    }
  }
  const tmpRoot = opts.tmpRoot ?? path.join(resolveBfstackHome(), '.tmp');
  const wrapperDir = path.join(tmpRoot, `skillify-${spawnId}`);
  const stagedDir = path.join(wrapperDir, opts.name);

  mkdirSecure(tmpRoot);
  // A fresh wrapper prevents overwriting a previous run or traversing its links.
  fs.mkdirSync(wrapperDir, { mode: 0o700 });
  mkdirSecure(stagedDir);

  for (const [relPath, contents] of opts.files) {
    const filePath = path.join(stagedDir, relPath);
    const fileDir = path.dirname(filePath);
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  return stagedDir;
}

// ─── Commit (atomic rename) ─────────────────────────────────────

export interface CommitSkillOptions {
  name: string;
  tier: 'project' | 'global';
  stagedDir: string;
  /** Optional override (tests pass synthetic tier paths). */
  tiers?: TierPaths;
}

/**
 * Atomically move the staged skill into its final tier path. Refuses to
 * clobber an existing skill at the same path — the agent's approval gate
 * MUST surface name collisions before calling this.
 *
 * Returns the absolute path of the committed skill dir.
 *
 * Throws when:
 *   - tier path is unresolved (project tier with no project root)
 *   - destination already exists
 *   - staged dir is a symlink (refuses to follow)
 *   - resolved destination escapes the tier root (defense in depth)
 */
export function commitSkill(opts: CommitSkillOptions): string {
  validateSkillName(opts.name);

  const tiers = opts.tiers ?? defaultTierPaths();
  const tierRoot = opts.tier === 'project' ? tiers.project : tiers.global;
  if (!tierRoot) {
    throw new Error(`commitSkill: tier "${opts.tier}" has no resolved path.`);
  }

  // Refuse to follow a symlinked staging dir — caller should hand us the path
  // returned by stageSkill, which is always a real directory.
  let stagedStat: fs.Stats;
  try {
    stagedStat = fs.lstatSync(opts.stagedDir);
  } catch (err: any) {
    throw new Error(`commitSkill: staged dir "${opts.stagedDir}" not accessible: ${err.code ?? err.message}`);
  }
  if (stagedStat.isSymbolicLink()) {
    throw new Error(`commitSkill: staged dir "${opts.stagedDir}" is a symlink — refusing to commit.`);
  }
  if (!stagedStat.isDirectory()) {
    throw new Error(`commitSkill: staged path "${opts.stagedDir}" is not a directory.`);
  }

  // Ensure the tier root exists, then resolve its real path so the final
  // destination check defends against tierRoot itself being a symlink.
  fs.mkdirSync(tierRoot, { recursive: true, mode: 0o755 });
  const realTierRoot = fs.realpathSync(tierRoot);

  const dest = path.join(realTierRoot, opts.name);
  if (!isPathWithin(dest, realTierRoot)) {
    // Should be impossible after validateSkillName, but defense in depth.
    throw new Error(`commitSkill: destination "${dest}" escapes tier root.`);
  }

  // Refuse to clobber. Both regular dirs and symlinks count.
  let destExists = false;
  try {
    fs.lstatSync(dest);
    destExists = true;
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (destExists) {
    throw new Error(
      `commitSkill: a skill named "${opts.name}" already exists at ${dest}. ` +
      `Pick a different name or remove the existing skill first ` +
      `($B skill rm ${opts.name}${opts.tier === 'global' ? ' --global' : ''}).`,
    );
  }

  fs.renameSync(opts.stagedDir, dest);
  return dest;
}

// ─── Discard (cleanup on failure or reject) ─────────────────────

/**
 * Remove the staged skill directory and its per-spawn wrapper. Called on
 * test failure (step 8 of /skillify) or approval rejection (step 9).
 *
 * Missing owned directories are harmless. Foreign paths, links and actual
 * deletion failures are rejected, never hidden.
 */
export function discardStaged(stagedDir: string, tmpRoot = path.join(resolveBfstackHome(), '.tmp')): void {
  const root = path.resolve(tmpRoot);
  const target = path.resolve(stagedDir);
  const relative = path.relative(root, target).split(path.sep);
  if (relative.length !== 2 || !/^skillify-[a-zA-Z0-9_-]{1,100}$/.test(relative[0]!)) {
    throw new Error('Refusing to discard a path outside the staging tree.');
  }
  validateSkillName(relative[1]!);
  const wrapper = path.dirname(target);
  for (const candidate of [wrapper, target]) {
    if (!fs.existsSync(candidate)) return;
    if (fs.lstatSync(candidate).isSymbolicLink()
      || !isPathWithin(fs.realpathSync(candidate), fs.realpathSync(root))) {
      throw new Error('Refusing to discard a linked or escaped staging path.');
    }
  }
  fs.rmSync(target, { recursive: true });
  if (fs.readdirSync(wrapper).length === 0) fs.rmdirSync(wrapper);
}

// ─── Spawn id ───────────────────────────────────────────────────

/** Per-spawn id matching the format used by skill-token.ts. */
function generateSpawnId(): string {
  // 8 random hex chars + millis suffix — collision risk negligible across
  // concurrent /skillify invocations on a single machine.
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${rand}-${Date.now().toString(36)}`;
}
