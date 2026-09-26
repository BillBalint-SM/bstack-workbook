import { existsSync } from "fs";

export function isExecTimeout(err: unknown): boolean {
  const e = err as { killed?: boolean; signal?: string; code?: unknown };
  return e?.killed === true || e?.signal === "SIGTERM" || e?.code === "ETIMEDOUT";
}

const WINDOWS_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

export interface ScriptInvocation {
  cmd: string;
  argv: string[];
  shell: false;
}

/** Resolve a bash shebang script without routing through cmd.exe on Windows. */
export function bashScriptInvocation(
  scriptPath: string,
  args: string[],
  opts: { platform?: string; exists?: (p: string) => boolean; env?: NodeJS.ProcessEnv } = {},
): ScriptInvocation | null {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return { cmd: scriptPath, argv: args, shell: false };
  const exists = opts.exists ?? existsSync;
  const override = (opts.env ?? process.env).BFSTACK_BASH?.trim();
  const bash = [...(override ? [override] : []), ...WINDOWS_BASH_CANDIDATES].find(exists);
  return bash ? { cmd: bash, argv: [scriptPath.replace(/\\/g, "/"), ...args], shell: false } : null;
}
