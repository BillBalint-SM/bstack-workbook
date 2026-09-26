/** Resolve the project through the shared package-local helper. */
import * as path from 'path';
import { resolveSlug } from '../../lib/bin-context';
let cachedSlug: string | null = null;
export function getCurrentProjectSlug(): string {
  if (cachedSlug) return cachedSlug;
  const root = process.env.BFSTACK_ROOT || path.resolve(import.meta.dir, '../..');
  cachedSlug = resolveSlug(path.join(root, 'bin', 'bfstack-slug'));
  return cachedSlug;
}
export function _resetProjectSlugCache(): void { cachedSlug = null; }