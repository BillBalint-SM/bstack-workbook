import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ObservedProcessIdentity {
  pid: number;
  startedAt: string;
  executable: string;
  commandLine: string;
}

export interface ProcessIdentity extends ObservedProcessIdentity {
  stateFile: string;
  profileDir?: string;
}

export type ProcessInspector = (pid: number) => ObservedProcessIdentity | null;

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function normalizePathInCommand(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isAbsolutePath(value: unknown): value is string {
  return isNonEmptyString(value) && path.isAbsolute(value);
}

function isObservedIdentity(value: Partial<ObservedProcessIdentity>): value is ObservedProcessIdentity {
  return isPositiveSafeInteger(value.pid)
    && isNonEmptyString(value.startedAt)
    && isAbsolutePath(value.executable)
    && isNonEmptyString(value.commandLine);
}

function windowsProcessIdentity(pid: number): ObservedProcessIdentity | null {
  if (!isPositiveSafeInteger(pid)) return null;
  try {
    // Windows PowerShell 5 otherwise writes redirected pipeline output in the
    // active console code page. Keep this child PowerShell process UTF-8 only;
    // the exact command line is part of the ownership proof.
    const script = `$utf8=New-Object System.Text.UTF8Encoding($false);[Console]::OutputEncoding=$utf8;$OutputEncoding=$utf8;$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\";if($null -eq $p){exit 2};[pscustomobject]@{pid=$p.ProcessId;startedAt=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;commandLine=$p.CommandLine}|ConvertTo-Json -Compress`;
    const result = Bun.spawnSync(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], {
      stdout: 'pipe', stderr: 'ignore', timeout: 2_000, windowsHide: true,
    });
    if (result.exitCode !== 0) return null;
    const data = JSON.parse(result.stdout.toString()) as Partial<ObservedProcessIdentity>;
    if (!isObservedIdentity(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function procProcessIdentity(pid: number): ObservedProcessIdentity | null {
  if (!isPositiveSafeInteger(pid)) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterName = stat.lastIndexOf(')');
    const fields = stat.slice(afterName + 2).trim().split(/\s+/);
    const startedAt = fields[19]; // /proc stat field 22, stable across PID reuse
    const executable = fs.readlinkSync(`/proc/${pid}/exe`);
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (!startedAt || !executable || !commandLine) return null;
    return { pid, startedAt: `proc:${startedAt}`, executable, commandLine };
  } catch {
    return null;
  }
}

/** Read the process identity required before any direct termination. */
export const inspectProcessIdentity: ProcessInspector = (pid) =>
  process.platform === 'win32' ? windowsProcessIdentity(pid) : procProcessIdentity(pid);

export function captureProcessIdentity(
  input: { pid: number; stateFile: string; profileDir?: string },
  inspect: ProcessInspector = inspectProcessIdentity,
): ProcessIdentity | null {
  if (!isPositiveSafeInteger(input.pid) || !isAbsolutePath(input.stateFile)
    || (input.profileDir !== undefined && !isAbsolutePath(input.profileDir))) return null;
  const observed = inspect(input.pid);
  if (!observed || !isObservedIdentity(observed) || observed.pid !== input.pid) return null;
  return { ...observed, stateFile: input.stateFile, ...(input.profileDir ? { profileDir: input.profileDir } : {}) };
}

/**
 * Fail closed. A state record only authorizes its original state-file owner
 * and the exact process captured at creation time.
 */
export function isCurrentOwnedProcess(
  record: ProcessIdentity | undefined,
  expectedStateFile: string,
  inspect: ProcessInspector = inspectProcessIdentity,
): boolean {
  if (!record || !isObservedIdentity(record) || !isAbsolutePath(record.stateFile)
    || (record.profileDir !== undefined && !isAbsolutePath(record.profileDir))) return false;
  if (normalizePath(record.stateFile) !== normalizePath(expectedStateFile)) return false;
  const current = inspect(record.pid);
  if (!current || !isObservedIdentity(current)) return false;
  if (current.pid !== record.pid || current.startedAt !== record.startedAt) return false;
  if (normalizePath(current.executable) !== normalizePath(record.executable)) return false;
  if (current.commandLine !== record.commandLine) return false;
  if (record.profileDir && !normalizePathInCommand(current.commandLine).includes(normalizePathInCommand(record.profileDir))) return false;
  return true;
}

/** A complete captured record may be removed after its PID is confirmed gone. */
export function belongsToStateFile(record: ProcessIdentity | undefined, expectedStateFile: string): boolean {
  return Boolean(
    record && isObservedIdentity(record) && isAbsolutePath(record.stateFile)
    && normalizePath(record.stateFile) === normalizePath(expectedStateFile),
  );
}
