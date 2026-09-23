#!/usr/bin/env bun
// Build a relocatable Windows/Codex plugin from an already built checkout.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, inventory } from '../plugin/bstack/scripts/verify-runtime';

const source = resolve(import.meta.dir, '..');
const output = resolve(process.argv[2] || '');
if (process.argv.length !== 3 || basename(output) !== 'bstack') {
  throw new Error('Usage: bun scripts/package-bstack.ts <new-output-directory>/bstack');
}
const relOutput = relative(source, output);
if (!relOutput.startsWith('..') && !isAbsolute(relOutput)) throw new Error('Output must be outside the source checkout');
if (existsSync(output)) throw new Error('Output already exists');
const marketFile = join(dirname(output), '.agents/plugins/marketplace.json');
if (existsSync(marketFile)) throw new Error('Marketplace already exists');
for (const file of ['browse/dist/browse.exe', 'design/dist/design.exe', 'make-pdf/dist/pdf.exe', '.agents/skills/gstack-review/SKILL.md']) {
  if (!existsSync(join(source, file))) throw new Error(`Run the Windows source build first: ${file} missing`);
}

const omitted = new Set(['.git', '.github', '.claude', '.factory', '.kiro', '.opencode', '.slate', '.cursor', '.openclaw', '.hermes', '.gbrain', '.gstack', '.gstack-worktrees', '.context', '.sources', 'tmp', 'test', 'compat', 'node_modules', 'claude', 'benchmark-models', 'pair-agent', 'openclaw', 'ios-clean', 'ios-design-review', 'ios-fix', 'ios-qa', 'ios-sync']);
const omittedSkills = new Set(['claude', 'benchmark-models', 'pair-agent', 'ios-clean', 'ios-design-review', 'ios-fix', 'ios-qa', 'ios-sync']);
const runtime = join(output, 'runtime');
mkdirSync(dirname(output), { recursive: true });
cpSync(join(source, 'plugin/bstack'), output, {
  recursive: true,
  filter: file => {
    const rel = relative(join(source, 'plugin/bstack'), file).replaceAll('\\', '/');
    return !rel.startsWith('skills/') || !omittedSkills.has(rel.split('/')[1]);
  },
});
mkdirSync(join(output, '.codex-plugin'), { recursive: true });
cpSync(join(source, 'scripts/bstack-plugin-manifest.json'), join(output, '.codex-plugin/plugin.json'));
cpSync(source, runtime, {
  recursive: true,
  filter: file => {
    const rel = relative(source, file).replaceAll('\\', '/');
    if (!rel) return true;
    if (omitted.has(rel.split('/')[0]) || rel.split('/').includes('node_modules')) return false;
    if (rel.startsWith('.agents/skills/gstack-') && omittedSkills.has(rel.split('/')[2]?.replace(/^gstack-/, ''))) return false;
    if (rel === 'plugin/bstack' || rel === 'docs/bstack' ||
        ['scripts/bstack-p0-baseline.ts', 'scripts/package-bstack.ts', 'scripts/check-bstack-package.ts', 'scripts/bstack-plugin-manifest.json'].includes(rel)) return false;
    if (rel !== '.env.example' && (rel === '.env' || rel.startsWith('.env.'))) throw new Error(`Refusing to package secret file: ${rel}`);
    return true;
  },
});
mkdirSync(join(runtime, 'plugin/bstack/skills/upgrade'), { recursive: true });
cpSync(join(source, 'plugin/bstack/HOST.md'), join(runtime, 'plugin/bstack/HOST.md'));
cpSync(join(source, 'plugin/bstack/skills/upgrade/SKILL.md'), join(runtime, 'plugin/bstack/skills/upgrade/SKILL.md'));
const exportedSkills = readdirSync(join(output, 'skills'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
writeFileSync(join(runtime, '.agents/skills/gstack/SKILL.md'),
  `# bstack — Codex on Windows\n\nRoute requests only to the installed bstack skills.\nRead the chosen skill's complete workflow before acting.\n\nAvailable skills:\n${exportedSkills.filter(name => name !== 'bstack').map(name => `- ${name}`).join('\n')}\n`);

const install = spawnSync(process.execPath, ['install', '--frozen-lockfile', '--production'], {
  cwd: runtime, stdio: 'inherit', windowsHide: true, timeout: 180000,
});
if (install.error || install.status !== 0) throw new Error('Bundled dependency install failed; output is incomplete');

const files = inventory(runtime);
const pluginFiles = inventory(output, false, true);
for (const file of Object.keys(pluginFiles)) {
  if (['integrity.json', 'runtime.json', 'hooks/hooks.json', 'scripts/bstack.ps1'].includes(file)) delete pluginFiles[file];
}
const manifest = JSON.stringify({ schema: 2, root: 'runtime', files, pluginFiles,
  externalDependencies: ['Bun', 'Git Bash', 'jq', 'PowerShell', 'browser installation'] }, null, 2) + '\n';
const config = JSON.stringify({ runtime: 'runtime/scripts/bstack-runtime.ts', integritySha256: digest(manifest) }, null, 2) + '\n';
writeFileSync(join(output, 'integrity.json'), manifest);
writeFileSync(join(output, 'runtime.json'), config);

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const shaCheck = (path: string, base: string) => {
  const target = `(Join-Path ${base} ${quote(path)})`;
  return `if ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes(${target}))).Replace('-','') -ne '${digest(readFileSync(join(output, path)))}') { throw 'Changed release entrypoint' }`;
};
const launcherPath = join(output, 'scripts/bstack.ps1');
const launcher = readFileSync(launcherPath, 'utf8');
const marker = '# RELEASE_BINDING: populated only in the sealed copy, before config is read.';
if (!launcher.includes(marker)) throw new Error('Launcher binding point missing');
writeFileSync(launcherPath, launcher.replace(marker,
  ['scripts/verify-runtime.ts', 'runtime.json', 'integrity.json'].map(file => shaCheck(file, '(Join-Path $PSScriptRoot ..)')).join('\n    ')));

const hooksPath = join(output, 'hooks/hooks.json');
const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
for (const groups of Object.values(hooks.hooks) as any[]) for (const group of groups) for (const hook of group.hooks) {
  const mode = hook.command.match(/-Mode (hook|questions|lifecycle)$/)?.[1];
  if (!mode) throw new Error('Unknown hook mode');
  const boundFiles = mode === 'hook' ? ['scripts/bstack.ps1']
    : ['scripts/bstack.ps1', 'scripts/verify-runtime.ts', 'runtime.json', 'integrity.json'];
  const checks = boundFiles
    .map(file => shaCheck(file, '$root')).join('; ');
  const script = `& { $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; try { $root=$env:PLUGIN_ROOT; if (-not $root) { throw 'Missing PLUGIN_ROOT' }; ${checks}; & (Join-Path $root 'scripts/bstack.ps1') -Mode ${mode}; exit $LASTEXITCODE } catch { [Console]::Error.WriteLine('bstack: package check failed: ' + $_.Exception.Message); exit ${mode === 'hook' ? 2 : 0} } }`;
  hook.command = hook.commandWindows = `powershell.exe -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
}
writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\n');
mkdirSync(dirname(marketFile), { recursive: true });
writeFileSync(marketFile, JSON.stringify({
  name: 'bstack-local',
  interface: { displayName: 'bstack (local)' },
  plugins: [{ name: 'bstack', source: { source: 'local', path: './bstack' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity' }],
}, null, 2) + '\n', { flag: 'wx' });
console.log(`Packaged ${Object.keys(files).length} runtime files and ${Object.keys(pluginFiles).length} plugin files at ${output}`);
