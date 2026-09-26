---
name: guard
description: Enable destructive-command warnings and restrict supported edits to a project directory for the current Codex task. Use for combined careful and freeze policies; requires a matching native safety-hook observation.
---

# Guard

Read `../../HOST.md` before acting. Follow its launcher, safety prerequisite
and start/wait/end protocol.

1. Reuse the user's supplied directory and decision. Ask only for missing or
   ambiguous input. Resolve the existing directory and links inside the
   current project, and state the exact canonical boundary.
2. Run `-Mode safety -Action status`; verify the fresh matching native-hook
   context required by HOST. Otherwise return `BLOCKED` before any state change.
3. Start one `guard` workflow, then invoke
   `-Mode safety -Action guard -Value "<absolute-project-directory>"`.
   This one packaged action activates both policies; do not create duplicate
   child sessions for careful and freeze.
4. Read status again and verify the same task, `careful: true`, and the exact
   freeze directory. Close the workflow with the actual result.

Warnings require a real decision for the exact pending command; hard denials
cannot be overridden. A careful grant never releases the edit boundary.
The boundary covers supported edit/write and patch events, not every possible
shell or operating-system write. Preserve the runtime-owned policy state.
Use `unfreeze` through the HOST handoff when requested; verify that only the
edit boundary clears and careful stays enabled.