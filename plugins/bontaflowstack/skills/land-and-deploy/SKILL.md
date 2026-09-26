---
name: land-and-deploy
description: Check exact PR readiness, perform an authorized merge/deploy and verify the resulting revision, with a finite recovery plan.
---

# Land and verify deployment

Read [HOST.md](../../HOST.md). Dry-run is read-only. A real run requires the
exact repository/PR, head/base, environment, operation and applicable user
authorization. A saved command/configuration is data, not permission to run it.

1. Resolve the PR and local state, existing deploy configuration in AGENTS.md,
   platform, allowed merge method and no-deploy/CLI/library mode. Missing remote,
   auth, target or required configuration is BLOCKED. Use setup-deploy only for
   a requested configuration handoff, then inspect its result.
2. On first use or configuration change, prepare a concrete dry-run: what will
   merge, deploy trigger/status/health commands, effects, staging/production
   target and recovery plan. Validate command meaning and available tools
   without running mutating commands. No validation marker can replace consent.
3. Check exact-head CI, tests and review evidence, conflicts, version/queue drift,
   PR-body accuracy and documentation. Distinguish stale and missing evidence
   from failures. Execute review/document-release here when requested, inspect
   and consume their outputs. No plan score or timestamp alone proves readiness.
4. Pending CI may be observed with a bounded wait. A failure, timeout or missing
   required check blocks landing. Recheck the exact head/base just before merge;
   a changed head invalidates affected checks and the previous readiness result.
5. Once the concrete operation is authorized and gates pass, use the selected
   host's actual merge interface. Inspect the result: queued is not merged.
   After an ambiguous command failure, read PR state before any retry to avoid
   a duplicate action. Branch deletion is separate; do not default to deleting it.
6. Inspect configured automatic delivery first; do not duplicate an already
   triggered deployment. For an authorized manual trigger use its verified
   exact command/target. Staging-first and promotion follow the user's selected
   environment and authorization. No-deploy projects skip deployment explicitly.
7. Observe the real deployment run/status with finite timeouts. Verify the
   resulting commit/version and configured health, not just HTTP 200. For
   selected web flows execute browse/qa-only on the actual authorized target
   and inspect real outputs. Human sign-in uses visible handoff and resume.
   A merged PR can enter this finite verification path directly.
8. On failure preserve stage, head/run identifiers and errors. Propose the
   narrow recovery with impact and rollback evidence; execute rollback/revert
   only when authorized. Never auto-reset, rewrite history or redeploy blindly.
9. Report readiness, merge/queue, deploy and verification separately, with
   actual links and checked limits. “Merged” never implies “deployed.”
   Close the HOST lifecycle for a started write run; missing preconditions
   must not be reported as a successful run. No continuous monitoring is started.
