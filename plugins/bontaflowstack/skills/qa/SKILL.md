---
name: qa
description: Test a scoped web flow, repair verified in-scope defects and retest the actual behavior with the packaged browser.
---

# QA and fixes

Read [HOST.md](../../HOST.md). Follow scope, lifecycle, owned-browser and
same-task handoff rules. A report-only request belongs to `qa-only`.
This skill may repair only the application/files the user authorized.

1. Read the target, relevant test plan, working-tree changes and existing checks.
   Support quick, full, diff-aware and named-baseline regression modes with
   explicit coverage. Do not bootstrap a framework, install packages, edit CI
   or make commits simply because no test suite exists.
2. Obtain a real baseline by executing `qa-only` in this task, then inspect
   its findings/evidence. Reuse an existing baseline only if content, target
   and conditions still match; identify reuse honestly.
3. Triage verified defects by consequence. Trace each failure through actual
   source and shared callers. Explain missing auth/source/services as BLOCKED,
   and mark uncertain fixes separately rather than claiming verification.
4. For an authorized fix, preserve baseline evidence, start the repair lifecycle
   and make the smallest change addressing the cause. Add a meaningful focused
   regression where behavior changes; use the project's existing test setup.
   Pure visual changes can use a before/after render instead of mirrored tests.
   Never delete a failing check to make the result look green.
5. Re-run the actual failing interaction with `browse`; inspect output,
   screenshot and console. Re-run affected checks, expanding only for new risk.
   Keep original failures. If a change regresses, safely undo only your own
   isolated edit and report it; do not automatically revert Git history.
6. Stop when the scoped outcome is checked or a concrete blocker is reached.
   No arbitrary fix count, probability formula, forced score or per-fix commit.
   Record verified, unverified and deferred items in the existing
   [QA report](templates/qa-report-template.md); preserve unrelated work.
7. Read the final report, close owned resources and the lifecycle, and return
   actual changes, evidence and remaining scope. Publication, deployment and
   repository integration keep their separate authorization boundaries.
