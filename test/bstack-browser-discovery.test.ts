import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { locateBinary } from '../browse/src/find-browse';

test('an explicit runtime owns browser discovery and cannot fall back to old gstack', () => {
  const root = mkdtempSync(join(tmpdir(), 'bstack browser '));
  const previous = process.env.GSTACK_ROOT;
  try {
    process.env.GSTACK_ROOT = root;
    expect(locateBinary()).toBeNull();
    mkdirSync(join(root, 'browse/dist'), { recursive: true });
    const browser = join(root, 'browse/dist', process.platform === 'win32' ? 'browse.exe' : 'browse');
    writeFileSync(browser, '', { mode: 0o755 });
    expect(locateBinary()).toBe(browser);
  } finally {
    if (previous === undefined) delete process.env.GSTACK_ROOT;
    else process.env.GSTACK_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
