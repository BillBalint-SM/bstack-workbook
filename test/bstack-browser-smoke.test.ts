import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('native Windows browser loads local HTML, snapshots, clicks, and reports console', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bstack browser smoke '));
  const state = join(scratch, '.gstack');
  mkdirSync(state);
  const browser = resolve(import.meta.dir, '../browse/dist/browse.exe');
  const env = { ...process.env, GSTACK_HOME: state, BROWSE_STATE_FILE: join(state, 'browse.json'),
    BROWSE_PARENT_PID: '0', BROWSE_IDLE_TIMEOUT: '60000' };
  try {
    const html = join(scratch, 'fixture.html');
    writeFileSync(html, '<!doctype html><html lang="en"><title>bstack fixture</title><button onclick="this.textContent=\'Verified\'">Check</button></html>');
    // Exercise the browser using the same native Node subprocess environment
    // as its Windows server launcher.
    const result = spawnSync('node', ['-e', `
      const assert = require('node:assert/strict');
      const {spawnSync} = require('node:child_process');
      const [browser, cwd, html] = process.argv.slice(1);
      const run = (...args) => {
        const r = spawnSync(browser, args, {cwd, encoding:'utf8', timeout:30000, windowsHide:true});
        assert.equal(r.status, 0, r.stderr); return r.stdout;
      };
      try {
        run('load-html', html);
        assert.match(run('snapshot', '-i'), /Check/);
        run('click', 'button');
        assert.match(run('snapshot', '-i'), /Verified/);
        run('console');
      } finally { run('stop'); }
    `, browser, scratch, html], { env, encoding: 'utf8', timeout: 100_000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    // Keep browser artifacts for inspection. Cleanup hit EBUSY/EPERM on this
    // host and a direct cleanup was policy-blocked; do not work around that.
    console.log(`Browser artifacts retained: ${scratch}`);
  }
}, 120_000);
