---
name: unfreeze
description: Clear only the current Codex task's project edit boundary while preserving careful command warnings. Use when the user asks to release a freeze; requires a matching native safety-hook observation.
---

# Unfreeze

Read `../../HOST.md` before acting. Use its packaged launcher, safety
prerequisite and start/wait/end protocol.

1. Run `-Mode safety -Action status` in the current project. Verify the fresh
   matching native-hook context required by HOST and retain the returned
   task, prior boundary and careful flag. Missing evidence is `BLOCKED`.
2. Start one `unfreeze` workflow and invoke
   `-Mode safety -Action unfreeze` with the inherited task identity.
3. Read status again. Verify `freeze: null` and the unchanged careful flag.
   Report the prior boundary if present, or a clear no-op if already unfrozen.
4. Finish the workflow with the actual result and return that checked result
   to any calling skill under the HOST handoff contract.

Do not delete files, reset a profile, alter platform permissions, release
another task's boundary or describe unfreeze as disabling command warnings.