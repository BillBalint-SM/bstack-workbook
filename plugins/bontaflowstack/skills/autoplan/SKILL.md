---
name: autoplan
description: Run proportional plan reviews sequentially in the same Codex task, carry forward checked findings and preserve unresolved decisions.
---

# Autoplan

Read [HOST.md](../../HOST.md). Follow its scope, lifecycle, question and
same-task handoff contract. This is a review pipeline, not permission to
implement, create issues, publish or launch another host/model.

1. Identify the concrete plan, current decisions and intended result. Read
   relevant local code and instructions. Reuse a sufficient brief; execute
   office-hours/spec only if requested or an essential input must be developed.
2. Select applicable phases: product/scope with plan-ceo-review, UI with
   plan-design-review, developer surfaces with plan-devex-review, and engineering
   with plan-eng-review last. A narrow requested review may omit irrelevant
   phases; report that scope. Do not silently omit a requested phase.
3. Start before authorized report or plan writes. Preserve a local original
   copy if amending the plan. Do not stash, reset or commit the working tree.
   A no-file review keeps artifacts/state unchanged.
4. For each selected phase, sequentially load the target from this package,
   give it the current plan, scope, existing answers and required output, and
   actually execute its review in this task. Inspect its concrete findings and
   target/content identity before proceeding. A launcher read or recommendation
   is not a completed review. Carry errors and BLOCKED/waiting states forward.
5. Collect findings as accepted, proposed, deferred or unresolved with the real
   decision source. Resolve routine implementation details only within already
   delegated scope. Do not use majority voting, a score, a saved preference or
   silence to supply a required user decision. Changes in product scope, external
   effects and irreversible actions retain their own authorization boundaries.
   A report-only request may finish with open decisions.
6. Amend the plan only as authorized; give the actual amended plan to the next
   review. Engineering must assess the final proposed content. Reuse a prior
   result only when target bytes and assumptions still match, explicitly stating
   reuse rather than claiming a new review.
7. Consolidate duplicate findings, conflicts, acceptance checks and implementation
   tasks. Preserve distinct failures and dependency ordering; a parallel work
   suggestion does not start workers. Optional independent review uses a real
   available authorized mechanism, never a nested-host fallback.
8. Return the reviewed plan identity, phases executed/reused/skipped, concrete
   findings, decision sources and remaining blockers. For an authorized plan
   report use `## BFSTACK REVIEW REPORT` and an honest unresolved-decisions list.
   Write actual review records using existing helpers only when requested; do
   not create clean rows for skipped phases or overwrite earlier evidence.
   Check final files, then close the lifecycle with the real outcome.

Hand off to implementation only if requested and its required decisions are
resolved. Review completion and readiness to implement are distinct results.
