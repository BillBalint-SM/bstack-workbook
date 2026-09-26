---
name: investigate
description: Reproduce a reported defect, trace its cause through real callers, and verify an authorized minimal repair.
---

# Investigate a defect

Read [HOST.md](../../HOST.md). Diagnose before changing code. A diagnosis-only
request stays read-only; unavailable inputs or execution are concrete blockers.

1. Capture expected/actual behavior, exact inputs, environment and original
   error. Read relevant instructions, changes/history, definitions and all
   affected callers. Consult relevant local knowledge through bontaflow-memory;
   absence of a saved lesson is not a reason to contact an external service.
2. Reproduce the smallest failing flow using existing checks or an isolated
   fixture. Retain the original error and exit code. Do not install tools,
   reset user state or broaden tests merely to obtain a clean result.
3. Compare working and failing paths. Trace boundaries, state, null/empty
   values, configuration, caching, concurrency and dependency behavior where
   evidence points. State one falsifiable hypothesis and an expected result.
4. Run the smallest discriminating check. Reject unsupported hypotheses and
   keep failed attempts. Respect a user-specified attempt budget; when available
   evidence is exhausted report uncertainty and the missing input.
5. For an authorized repair, establish the edit boundary with freeze in this
   task, following its real hook prerequisite. A missing matching native hook
   observation is BLOCKED for this protected repair; diagnosis may still finish.
   Record prior safety state; do not claim enforcement from a manual hook call.
6. Write a focused regression that fails for the observed cause where practical.
   Make the smallest shared fix, preserving unrelated edits. Re-run the original
   reproduction and affected checks once; expand only for a new risk.
   Preserve any regression and diff rather than resetting or claiming success.
7. Report the proven cause or remaining hypothesis, actual evidence, changes
   and checked limits. Restore only a boundary created by this run via unfreeze
   when appropriate; preserve a pre-existing user boundary.
   Authorized local reports/repairs use the HOST lifecycle. Reusable lessons
   go only through bontaflow-memory with applicable write authorization.