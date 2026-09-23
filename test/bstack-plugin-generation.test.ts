import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('plugin generation catches stale and retired wrappers without deleting unknown content', () => {
  const output = mkdtempSync(join(tmpdir(), 'bstack plugin '));
  const generator = resolve(import.meta.dir, '../scripts/build-bstack-plugin.ts');
  const run = (...args: string[]) => spawnSync(process.execPath, [generator, '--out-dir', output, ...args], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  try {
    expect(run().status).toBe(0);
    expect(run('--check').status).toBe(0);
    const skill = join(output, 'skills/review/SKILL.md');
    writeFileSync(skill, 'stale');
    expect(run('--check').status).toBe(1);
    expect(readFileSync(skill, 'utf8')).toBe('stale');
    expect(run().status).toBe(0);
    mkdirSync(join(output, 'skills/retired'));
    writeFileSync(join(output, 'skills/retired/SKILL.md'), 'owner content');
    expect(run('--check').status).toBe(1);
    expect(run().status).toBe(1);
    expect(readFileSync(join(output, 'skills/retired/SKILL.md'), 'utf8')).toBe('owner content');
  } finally { rmSync(output, { recursive: true, force: true }); }
});
