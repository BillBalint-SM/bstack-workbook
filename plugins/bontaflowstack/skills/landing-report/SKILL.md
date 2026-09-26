---
name: landing-report
description: Read delivery and version-queue evidence for a selected repository, showing freshness and blocked states without changing Git or remote state.
---

# Landing report

Read [HOST.md](../../HOST.md). This report is read-only: no fetch, commit,
version write, merge or persistent session/history merely to render a dashboard.

1. Identify the exact repository, verified base, version source and selected
   remote or supplied snapshot. Snapshot evidence is labelled with origin/time,
   never treated as a live API result. A missing remote is BLOCKED for a live
   queue; local version arithmetic cannot establish an empty remote queue.
2. When the user selected live remote reads and auth/platform is available,
   use the packaged helper through the launcher:
   `bun run "$BFSTACK_BIN/bfstack-next-version" --base "<base>" --bump patch --current-version "<version>" --workspace-root null`.
   Pass an explicitly authorized workspace root only for sibling inspection.
   Query micro/minor/major as needed for the requested version preview.
   The helper may contact the hosting platform; do not use it as an offline probe.
3. Inspect exit status and JSON host/offline/warnings/claimed/siblings fields.
   Keep unreadable, stale, active, version-collision and empty states distinct.
   A failed query is never “no queued work.” Timestamp freshness separately
   from passing CI; a proposed next version is not a reservation.
4. Report each PR's known head/check state, version claim and evidence age.
   Distinguish unknown fields from successful checks. Collisions are risks,
   not permission to rewrite another branch. Sibling activity is a heuristic.
5. Give a useful next action based on verified state. Missing prerequisites
   stay BLOCKED; do not fabricate GitHub/GitLab availability from a locally
   installed CLI. No provider or queue mutation follows this report.