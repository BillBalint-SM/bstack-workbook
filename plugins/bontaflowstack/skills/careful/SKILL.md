---
name: careful
description: Enable session-scoped warnings for destructive commands when the user asks for careful or safety mode. Requires a fresh matching native safety-hook observation; hard denials cannot be overridden.
---

# Careful

Read `../../HOST.md` before acting. Use its packaged launcher, real task
identity, safety prerequisite and start/wait/end protocol.

1. Read the current project's safety status with the launcher:
   `-Mode safety -Action status`. Match its session and project key to the
   fresh native-hook additional context required by HOST. If unavailable or
   mismatched, report `BLOCKED` with the missing prerequisite; write no state.
2. After that check, start one `careful` workflow through the HOST protocol.
3. Invoke `-Mode safety -Action careful` in the same project and task.
4. Read status again. Report active only when that same session confirms
   `careful: true`; preserve any existing freeze boundary.
5. Close the started workflow with the actual result. Enabling the policy
   does not itself prove native command interception.

The packaged classifier warns on recursive deletion, SQL DROP/TRUNCATE,
force-push, hard reset/restore, kubectl delete and Docker removal/prune.
Filesystem-root/home deletion and default-branch force-push are hard denials.
Ambiguous commands retain the runtime's decision path.

For a warning, describe the exact pending action and wait for a real applicable
decision. Only after confirmation use the returned pending ID with
`-Mode safety -Action approve -Value "<pending-id>"`, then retry the unchanged
tool call once. Never approve a different command, reuse a consumed grant,
override a hard denial or treat this policy as additional Codex permission.