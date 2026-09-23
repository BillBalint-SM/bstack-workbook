#!/usr/bin/env bun
// Small, repeatable structural and runtime check for a built Windows package.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const plugin = process.argv[2];
if (!plugin || basename(plugin) !== 'bstack') throw new Error('Usage: bun scripts/check-bstack-package.ts <package>/bstack');
const config = JSON.parse(readFileSync(join(plugin, 'runtime.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(plugin, 'integrity.json'), 'utf8'));
const metadata = JSON.parse(readFileSync(join(plugin, '.codex-plugin/plugin.json'), 'utf8'));
const marketplace = JSON.parse(readFileSync(join(dirname(plugin), '.agents/plugins/marketplace.json'), 'utf8'));
if (metadata.name !== 'bstack' || manifest.schema !== 2 || manifest.root !== 'runtime' || config.runtime !== 'runtime/scripts/bstack-runtime.ts' || isAbsolute(config.runtime)) {
  throw new Error('Package still depends on an absolute runtime');
}
if (marketplace.plugins?.[0]?.name !== 'bstack' || marketplace.plugins[0].source?.path !== './bstack') {
  throw new Error('Local marketplace does not resolve this package');
}
const skills = readdirSync(join(plugin, 'skills'));
const excluded = ['claude', 'benchmark-models', 'pair-agent', 'ios-clean', 'ios-design-review', 'ios-fix', 'ios-qa', 'ios-sync'];
if (!skills.includes('bstack') || excluded.some(name => skills.includes(name))) throw new Error('Unexpected Windows/Codex skill surface');
const router = readFileSync(join(plugin, 'runtime/.agents/skills/gstack/SKILL.md'), 'utf8');
const listed = [...router.matchAll(/^- ([a-z][a-z0-9-]*)$/gm)].map(match => match[1]).sort();
if (JSON.stringify(listed) !== JSON.stringify(skills.filter(name => name !== 'bstack').sort())) {
  throw new Error('Router and installed skills disagree');
}
if (!existsSync(join(plugin, config.runtime))) throw new Error('Bundled runtime missing');
const state = mkdtempSync(join(tmpdir(), 'bstack-package-check-'));
const check = (() => {
  try {
    return spawnSync('powershell.exe', ['-NoProfile', '-File', join(plugin, 'scripts/bstack.ps1'), '-Mode', 'check'], {
      cwd: tmpdir(), env: { ...process.env, GSTACK_HOME: state, GSTACK_STATE_ROOT: state },
      encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
  } finally {
    if (dirname(resolve(state)) !== resolve(tmpdir())) throw new Error('Unexpected temporary state path');
    rmSync(state, { recursive: true });
  }
})();
if (check.error || check.status !== 0 || !check.stdout.includes('BSTACK_ROOT=')) {
  throw new Error(`Package check failed: ${check.stderr || check.error || check.status}`);
}
console.log(`bstack package PASS: ${skills.length} Windows/Codex entrypoints, bundled runtime and local marketplace`);
