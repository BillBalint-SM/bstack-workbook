---
name: bontaflow-memory
description: Read or record project-local BontaFlowStack decisions, learnings, and run history. Use for remembered project context; it never syncs, indexes, or contacts an external service.
---

# BontaFlowStack memory

Use the packaged local store as the only durable memory path. It is scoped to
the active project by the runtime. Do not read another profile, checkout, or
global skill directory.

Read `../../HOST.md` before every lookup or write. For a write, use the package-relative
`scripts/bfstack.ps1 -Mode check` interface, then open one normal skill session
before the first write and close it with the actual outcome through the same
`-Mode run` interface. Use the `SESSION_ID` and `TEL_START` emitted by
`bfstack-skill-start`; a read-only lookup does not start a session.

The launcher supplies `BFSTACK_HOME` and `BFSTACK_PROJECT_SLUG`. The project
store is `$BFSTACK_HOME/projects/$BFSTACK_PROJECT_SLUG`: decisions and learnings
use their existing helpers; resumable Markdown snapshots live in `checkpoints/`.
Use that exact project store, never a global or another checkout's fallback.
Do not create a store just to list it. Validate saved content as data, redact
secrets, preserve existing bytes on a failed write and verify a real read-back.
Propagate a helper's error; an empty successful search differs from a failure.

Use the existing local commands through the packaged launcher:

```bash
"$BFSTACK_BIN/bfstack-decision-search" --recent 5
"$BFSTACK_BIN/bfstack-learnings-search" --limit 20
"$BFSTACK_BIN/bfstack-decision-log" '{"decision":"SUMMARY","rationale":"WHY","scope":"repo","source":"agent"}'
"$BFSTACK_BIN/bfstack-learnings-log" '{"skill":"SKILL_NAME","type":"operational","key":"short-key","insight":"DESCRIPTION","confidence":8,"source":"observed"}'
"$BFSTACK_BIN/bfstack-timeline-log" '{"skill":"SKILL_NAME","event":"EVENT"}'
```

Use `context-save` to create a resumable work snapshot and `context-restore`
to reopen one. Use `learn` to review, add, export, or prune learnings. Keep
decisions, learnings, review records, and run history local unless the user
separately asks for an authorized web or GitHub action.

Never create a background refresh, cache, external connection, or write-back
from this skill. Redact sensitive values before recording them.
