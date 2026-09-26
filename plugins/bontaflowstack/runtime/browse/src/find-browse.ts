import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
export function locateBinary(): string | null {
  const root = process.env.BFSTACK_ROOT || resolve(import.meta.dir, '../..');
  const candidate = join(root, 'browse', 'dist', 'browse.exe');
  return existsSync(candidate) ? candidate : null;
}
if (import.meta.main) {
  const found = locateBinary();
  if (!found) { console.error('BLOCKED: packaged Windows browser is missing'); process.exit(1); }
  console.log(found);
}