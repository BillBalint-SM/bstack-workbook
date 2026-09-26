/** Compatibility boundary: browser work stays in the existing Codex task. */
export function spawnTerminalAgent(_opts: {
  stateFile: string; serverPort: number; ownerPid: number;
  cwd?: string; extraEnv?: Record<string, string>; scriptPath?: string;
}): null { return null; }