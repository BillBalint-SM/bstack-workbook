// Content binding, not an OS security boundary. The host still owns executable
// trust, permissions and external toolchain/dependency provisioning.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const excluded = new Set(['.git', 'node_modules', 'test', 'dist', '.gstack', '.context',
  '.gstack-worktrees', 'tmp', '.sources', '.claude', '.factory', '.kiro', '.opencode',
  '.slate', '.cursor', '.openclaw', '.hermes', '.gbrain']);
export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const hookRoots = new Set(['scripts', 'lib', 'hosts', 'bin', 'careful', 'plugin']);
export function inventory(root: string, hooksOnly = false, skipRuntime = false): Record<string, string> {
  const files: Record<string, string> = Object.create(null);
  function walk(relative: string) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules') continue;
      if (!relative && excluded.has(entry.name)) continue;
      if (!relative && skipRuntime && entry.name === 'runtime') continue;
      if (!relative && hooksOnly && entry.isDirectory() && !hookRoots.has(entry.name)) continue;
      if (entry.name === '.env' || entry.name.startsWith('.env.')) {
        if (entry.name !== '.env.example') throw new Error('Refusing to seal a tree containing environment secrets');
      }
      if (entry.name.endsWith('.log')) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = join(root, file);
      if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Unsealed link: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files[file] = digest(readFileSync(absolute));
      else throw new Error(`Unsupported runtime entry: ${file}`);
    }
  }
  walk('');
  return files;
}

if (import.meta.main) {
  try {
    const configPath = resolve(process.argv[2]);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const bytes = readFileSync(join(dirname(configPath), 'integrity.json'));
    if (!/^[a-f0-9]{64}$/.test(config.integritySha256) || digest(bytes) !== config.integritySha256) throw new Error('Invalid integrity manifest');
    const manifest = JSON.parse(bytes.toString('utf8'));
    const sourceRoot = manifest.schema === 2
      ? resolve(dirname(configPath), manifest.root)
      : manifest.schema === 1 ? resolve(manifest.root) : null;
    const runtime = manifest.schema === 2
      ? resolve(dirname(configPath), config.runtime)
      : resolve(config.runtime);
    if (!sourceRoot || resolve(sourceRoot, 'scripts/bstack-runtime.ts') !== runtime) throw new Error('Runtime binding mismatch');
    const hooksOnly = ['hook', 'safety', 'lifecycle', 'questions'].includes(process.argv[3]);
    const actual = inventory(sourceRoot, hooksOnly);
    const expected = Object.fromEntries(Object.entries(manifest.files).filter(([file]) => !hooksOnly || !file.includes('/') || hookRoots.has(file.split('/')[0])));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Runtime content changed; rebuild and review the release');
    const pluginFiles = inventory(dirname(configPath), false, manifest.schema === 2);
    // Launcher is pinned by native hook trust; it contains this manifest's
    // digest, so including it here would create a self-referential hash cycle.
    for (const file of ['integrity.json', 'runtime.json', 'hooks/hooks.json', 'scripts/bstack.ps1']) delete pluginFiles[file];
    if (JSON.stringify(pluginFiles) !== JSON.stringify(manifest.pluginFiles)) throw new Error('Release plugin changed');
  } catch (error) {
    console.error(`bstack integrity: ${error instanceof Error ? error.message : 'verification failed'}`);
    process.exit(1);
  }
}
