/** Local scoped browser tokens. Only the root token can mint sub-tokens. */
import * as crypto from 'crypto';
import { READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS } from './commands';

// ─── Scope Definitions ─────────────────────────────────────────
// Derived from commands.ts, but reclassified by actual side effects.
// The key insight (from Codex adversarial review): commands.ts READ_COMMANDS
// includes js/eval/cookies/storage which are actually dangerous. The scope
// model here overrides the commands.ts classification.

/** Commands safe for read-only agents */
export const SCOPE_READ = new Set([
  'snapshot', 'text', 'html', 'links', 'forms', 'accessibility',
  'console', 'network', 'perf', 'dialog', 'is', 'inspect',
  'url', 'tabs', 'status', 'screenshot', 'pdf', 'css', 'attrs',
  'media', 'data',
]);

/** Commands that modify page state or navigate */
export const SCOPE_WRITE = new Set([
  'goto', 'back', 'forward', 'reload',
  'load-html',
  'click', 'fill', 'select', 'hover', 'type', 'press', 'scroll', 'wait',
  'upload', 'viewport', 'newtab', 'closetab',
  'dialog-accept', 'dialog-dismiss',
  'download', 'scrape', 'archive',
]);

/** Page-level power tools — JS execution, credential access, page mutations */
export const SCOPE_ADMIN = new Set([
  'eval', 'js', 'cookies', 'storage',
  'cookie',
  'header', 'useragent',
  'style', 'cleanup', 'prettyscreenshot',
]);

/** Browser-wide destructive commands — can kill the server, disconnect headed mode */
export const SCOPE_CONTROL = new Set([
  'state', 'handoff', 'resume', 'stop', 'restart', 'connect', 'disconnect',
]);

/** Meta commands — generally safe but some need scope checking */
export const SCOPE_META = new Set([
  'tab', 'diff', 'frame', 'responsive', 'snapshot',
  'watch', 'inbox', 'focus',
]);

export type ScopeCategory = 'read' | 'write' | 'admin' | 'meta' | 'control';

const SCOPE_MAP: Record<ScopeCategory, Set<string>> = {
  read: SCOPE_READ,
  write: SCOPE_WRITE,
  admin: SCOPE_ADMIN,
  control: SCOPE_CONTROL,
  meta: SCOPE_META,
};

export class InvalidScopeError extends Error {}

export function assertValidTokenOptions(scopes: readonly string[], rateLimit: number): void {
  const validScopes: ScopeCategory[] = ['read', 'write', 'admin', 'meta', 'control'];
  for (const s of scopes) {
    if (!validScopes.includes(s as ScopeCategory)) {
      throw new InvalidScopeError(`Invalid scope: ${s}. Valid: ${validScopes.join(', ')}`);
    }
  }
  if (rateLimit < 0) throw new InvalidScopeError('rateLimit must be >= 0');
}

/**
 * Typed error for a reserved or malformed clientId. `root` is the sentinel that
 * checkScope/checkDomain/checkRate and the server command gate use to mean "the
 * omnipotent root caller" (validateToken:360), so a scoped token carrying it
 * would bypass every enforcement path. Empty/non-string ids collapse distinct
 * agents together and break revoke-by-clientId. Request-path writers throw;
 * restoreRegistry skips-and-logs so one bad state-file entry can't drop later
 * sessions or brick boot.
 */
export class ReservedClientIdError extends Error {}

export function assertValidClientId(clientId: unknown): asserts clientId is string {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw new ReservedClientIdError('clientId must be a non-empty string');
  }
  if (clientId.trim().toLowerCase() === 'root') {
    throw new ReservedClientIdError("clientId 'root' is reserved");
  }
}

// ─── Types ──────────────────────────────────────────────────────

export interface TokenInfo {
  token: string;
  clientId: string;
  type: 'session';
  scopes: ScopeCategory[];
  domains?: string[];          // glob patterns, e.g. ['*.myapp.com']
  tabPolicy: 'own-only' | 'shared';
  rateLimit: number;           // requests per second (0 = unlimited)
  expiresAt: string | null;    // ISO8601, null = never
  createdAt: string;
  commandCount: number;        // how many commands have been executed
}

export interface CreateTokenOptions {
  clientId: string;
  scopes?: ScopeCategory[];
  domains?: string[];
  tabPolicy?: 'own-only' | 'shared';
  rateLimit?: number;
  expiresSeconds?: number | null; // null = never, default = 86400 (24h)
}

export interface TokenRegistryState {
  agents: Record<string, Omit<TokenInfo, 'commandCount'>>;
}

// ─── Rate Limiter ───────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(clientId: string, limit: number): { allowed: boolean; retryAfterMs?: number } {
  if (limit <= 0) return { allowed: true };

  const now = Date.now();
  const bucket = rateBuckets.get(clientId);

  if (!bucket || now - bucket.windowStart >= 1000) {
    rateBuckets.set(clientId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    const retryAfterMs = 1000 - (now - bucket.windowStart);
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 100) };
  }

  bucket.count++;
  return { allowed: true };
}

// ─── Token Registry ─────────────────────────────────────────────

const tokens = new Map<string, TokenInfo>();
let rootToken: string = '';

export function initRegistry(root: string): void {
  // Idempotent re-init: same token is a no-op so embedders can call this
  // alongside any prior call without fighting. Different token after init
  // means a misconfigured caller — throw clearly rather than silently
  // invalidate every scoped token already issued.
  if (rootToken !== '' && rootToken !== root) {
    throw new Error(
      'token-registry already initialized with a different token; ' +
      'embedders must call buildFetchHandler before any registry-mutating code path'
    );
  }
  rootToken = root;
}

export function getRootToken(): string {
  return rootToken;
}

export function isRootToken(token: string): boolean {
  // Constant-time compare so a caller who can provoke an isRootToken() call
  // can't measure byte-by-byte string-compare timing to recover the token.
  // Compare UTF-8 byte lengths (not JS string length) before timingSafeEqual,
  // which throws on length-mismatched buffers. A multibyte input whose JS
  // string length matches rootToken but whose UTF-8 byte length differs must
  // return false on the auth path, not error out.
  if (!rootToken) return false;
  const tokenBytes = Buffer.byteLength(token, 'utf8');
  const rootBytes = Buffer.byteLength(rootToken, 'utf8');
  if (tokenBytes !== rootBytes) return false;
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(rootToken, 'utf8');
  return crypto.timingSafeEqual(a, b);
}

function generateToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Create a scoped session token (for direct minting via CLI or /token endpoint).
 * Only callable by root token holder.
 */
export function createToken(opts: CreateTokenOptions): TokenInfo {
  const {
    clientId,
    scopes = ['read', 'write'],
    domains,
    tabPolicy = 'own-only',
    rateLimit = 10,
    expiresSeconds = 86400, // 24h default
  } = opts;

  // Validate inputs
  assertValidClientId(clientId);
  assertValidTokenOptions(scopes, rateLimit);
  if (expiresSeconds !== null && expiresSeconds !== undefined && expiresSeconds < 0) {
    throw new Error('expiresSeconds must be >= 0 or null');
  }

  const token = generateToken('gsk_sess_');
  const now = new Date();
  const expiresAt = expiresSeconds === null
    ? null
    : new Date(now.getTime() + expiresSeconds * 1000).toISOString();

  const info: TokenInfo = {
    token,
    clientId,
    type: 'session',
    scopes,
    domains,
    tabPolicy,
    rateLimit,
    expiresAt,
    createdAt: now.toISOString(),
    commandCount: 0,
  };

  // Replace the previous local session for this client.
  for (const [t, existing] of tokens) {
    if (existing.clientId === clientId && existing.type === 'session') {
      tokens.delete(t);
      break;
    }
  }

  tokens.set(token, info);
  return info;
}

/**
 * Validate a token and return its info if valid.
 * Returns null for expired, revoked, or unknown tokens.
 * Root token returns a special root info object.
 */
export function validateToken(token: string): TokenInfo | null {
  if (isRootToken(token)) {
    return {
      token: rootToken,
      clientId: 'root',
      type: 'session',
      scopes: ['read', 'write', 'admin', 'meta', 'control'],
      tabPolicy: 'shared',
      rateLimit: 0, // unlimited
      expiresAt: null,
      createdAt: '',
      commandCount: 0,
    };
  }

  const info = tokens.get(token);
  if (!info) return null;

  // Check expiry
  if (info.expiresAt && new Date(info.expiresAt) < new Date()) {
    tokens.delete(token);
    return null;
  }

  return info;
}

/**
 * Check if a command is allowed by the token's scopes.
 * The `chain` command is special: it's allowed if the token has meta scope,
 * but each subcommand within chain must be individually scope-checked.
 */
export function checkScope(info: TokenInfo, command: string): boolean {
  if (info.clientId === 'root') return true;

  // Special case: chain is in SCOPE_META but requires that the caller
  // has scopes covering ALL subcommands. The actual subcommand check
  // happens at dispatch time, not here.
  if (command === 'chain' && info.scopes.includes('meta')) return true;

  for (const scope of info.scopes) {
    if (SCOPE_MAP[scope]?.has(command)) return true;
  }

  return false;
}

/**
 * Check if a URL is allowed by the token's domain restrictions.
 * Returns true if no domain restrictions, or if the URL matches any glob.
 */
export function checkDomain(info: TokenInfo, url: string): boolean {
  if (info.clientId === 'root') return true;
  if (!info.domains || info.domains.length === 0) return true;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    for (const pattern of info.domains) {
      if (matchDomainGlob(hostname, pattern)) return true;
    }

    return false;
  } catch {
    return false; // Invalid URL — deny
  }
}

function matchDomainGlob(hostname: string, pattern: string): boolean {
  // Simple glob: *.example.com matches sub.example.com
  // Exact: example.com matches example.com only
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // .example.com
    return hostname.endsWith(suffix) || hostname === pattern.slice(2);
  }
  return hostname === pattern;
}

/**
 * Check rate limit for a client. Returns { allowed, retryAfterMs? }.
 */
export function checkRate(info: TokenInfo): { allowed: boolean; retryAfterMs?: number } {
  if (info.clientId === 'root') return { allowed: true };
  return checkRateLimit(info.clientId, info.rateLimit);
}

/**
 * Record that a command was executed by this token.
 */
export function recordCommand(token: string): void {
  const info = tokens.get(token);
  if (info) info.commandCount++;
}

/** Revoke every local session for a client and clear its rate bucket. */
export function revokeToken(clientId: string): number {
  let deleted = 0;
  for (const [token, info] of tokens) {
    if (info.clientId === clientId) {
      tokens.delete(token); // Map tolerates delete during for...of iteration
      deleted++;
    }
  }
  if (deleted > 0) rateBuckets.delete(clientId);
  return deleted;
}

/**
 * Rotate the root token. All scoped tokens are invalidated.
 * Returns the new root token.
 */
export function rotateRoot(): string {
  rootToken = crypto.randomUUID();
  tokens.clear();
  rateBuckets.clear();
  return rootToken;
}

/** List active local scoped tokens. */
export function listTokens(): TokenInfo[] {
  const now = new Date();
  const result: TokenInfo[] = [];

  for (const [token, info] of tokens) {
    if (info.expiresAt && new Date(info.expiresAt) < now) {
      tokens.delete(token);
      continue;
    }
    if (info.type === 'session') {
      result.push(info);

    }
  }

  return result;
}

/**
 * Serialize the token registry for state file persistence.
 */
export function serializeRegistry(): TokenRegistryState {
  const agents: TokenRegistryState['agents'] = {};

  for (const info of tokens.values()) {
    if (info.type === 'session') {
      const { commandCount, ...rest } = info;
      agents[info.clientId] = rest;
    }
  }

  return { agents };
}

/**
 * Restore the token registry from persisted state file data.
 */
export function restoreRegistry(state: TokenRegistryState): void {
  tokens.clear();
  const now = new Date();

  for (const [clientId, data] of Object.entries(state.agents)) {
    if (data.type !== 'session') continue;
    // Skip expired tokens
    if (data.expiresAt && new Date(data.expiresAt) < now) continue;

    // Skip-and-log rather than throw: a hand-edited or corrupt state file must
    // not brick boot or drop every later valid session. A persisted clientId
    // 'root' would otherwise inject a token that bypasses all scope checks.
    try {
      assertValidClientId(clientId);
    } catch (err) {
      console.warn(`[browse] restoreRegistry: skipping invalid clientId ${JSON.stringify(clientId)}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    tokens.set(data.token, {
      ...data,
      clientId,
      commandCount: 0,
    });
  }
}

// Test-only reset. Zeroes the registry so a subsequent initRegistry call
// always succeeds. Needed by tests that
// follow the rotateRoot() pattern — rotateRoot leaves rootToken non-empty,
// which would otherwise trip the initRegistry mismatch guard.
export function __resetRegistry(): void {
  rootToken = '';
  tokens.clear();
  rateBuckets.clear();
}
