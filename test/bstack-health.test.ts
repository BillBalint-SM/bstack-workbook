import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { ALL_HOST_CONFIGS } from '../hosts/index';

test('health-check accepts the primary host deliberately skipped skill', () => {
  const result = spawnSync(process.execPath, ['run', 'scripts/skill-check.ts'], {
    cwd: resolve(import.meta.dir, '..'), encoding: 'utf8', timeout: 120_000,
    windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  expect(result.stdout).not.toMatch(/claude\/SKILL\.md\s+— generated file missing/);
  expect(result.status).toBe(0);
}, 130_000);

test('health-check still rejects a real missing output and stale generated content', () => {
  const root = resolve(import.meta.dir, '..');
  const fixture = mkdtempSync(resolve(root, 'bstack-health-fixture-'));
  const name = basename(fixture);
  try {
    writeFileSync(resolve(fixture, 'SKILL.md.tmpl'), `---\nname: ${name}\ndescription: Test fixture.\n---\nExpected content.\n`);
    const check = () => spawnSync(process.execPath, ['run', 'scripts/skill-check.ts'], {
      cwd: root, encoding: 'utf8', timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    });
    const missing = check();
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain('generated file missing');
    writeFileSync(resolve(fixture, 'SKILL.md'), 'Wrong content.\n');
    const stale = check();
    expect(stale.status).toBe(1);
    expect(stale.stdout).toMatch(/STALE: bstack-health-fixture-/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    // Upstream dry-run still creates host metadata folders. Clean this test's
    // uniquely named outputs too, so the next health-check isn't contaminated.
    for (const host of ALL_HOST_CONFIGS) {
      if (host.name === 'claude') continue;
      rmSync(resolve(root, host.hostSubdir, 'skills', `gstack-${name}`), { recursive: true, force: true });
    }
  }
}, 250_000);
