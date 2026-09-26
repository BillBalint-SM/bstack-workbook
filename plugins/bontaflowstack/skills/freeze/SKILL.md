---
name: freeze
description: Restrict supported file edits to an existing directory inside the current project for this Codex task. Use when the user asks to limit edits to a folder; requires a matching native safety-hook observation.
---

# Freeze

Read `../../HOST.md` before acting. Follow its launcher, safety prerequisite
and start/wait/end protocol.

1. Use the directory already supplied by the user. Ask only if it is missing
   or materially ambiguous. Resolve links and show the exact canonical,
   existing directory inside the current project.
2. Run `-Mode safety -Action status` and verify the fresh matching native-hook
   context specified in HOST. Missing or mismatched evidence is `BLOCKED`;
   do not start a workflow or change policy state.
3. Start one `freeze` workflow, then invoke:
   `-Mode safety -Action freeze -Value "<absolute-project-directory>"`.
4. Read status again. Confirm the returned task and canonical boundary,
   preserving the current careful policy, then finish the started workflow.
   An invalid path or failed command must remain a reported failure/blocker.

The packaged policy checks paths of supported edit/write and patch events.
Reads remain allowed. Shell writes and unsupported tools are not a complete
filesystem sandbox; do not promise protection without observed host mapping.
The runtime owns the task's policy JSON. Do not write legacy marker files or
change another task's state. To release this boundary, use `unfreeze` under
the HOST same-task handoff contract and verify its actual result.