---
name: review
description: Review a specified change for correctness, scope and consequential regressions, with findings tied to actual code and evidence.
---

# Review a change

Read [HOST.md](../../HOST.md). Default to review only. Fixes, commits and
external comments require authorization for those operations.

1. Resolve the explicit target and a verified local base, or the supplied file
   pair/patch. Read working-tree status and preserve unrelated work. Do not
   assume origin/main, fetch, create a PR or review an empty diff as completed.
2. Compare the request, relevant plan/acceptance criteria and actual changes.
   Distinguish implemented, partial, missing, deferred and externally blocked
   items. Read existing TODOs/docs only when relevant; do not invent intent.
3. Read `"$BFSTACK_ROOT/review/checklist.md"`; a missing required checklist is
   BLOCKED. Read full changed definitions and their callers, not only hunks.
   Start with data loss, security, races and wrong results; then check tests,
   compatibility, error handling, performance and distribution where affected.
4. Apply specialist lenses as warranted. The package's
   `review/specialists/` contains testing, maintainability, security,
   performance, data-migration, api-contract, simplification and red-team
   guidance. These are perspectives for this task, not an automatic delegation
   or second-model requirement. For frontend changes also read
   `"$BFSTACK_ROOT/review/design-checklist.md"`.
5. Verify each finding: exact definition, real call path, triggering input,
   observed or demonstrable consequence and whether the diff already fixes it.
   Cite location and evidence. Separate credible uncertainty from a confirmed
   defect; do not turn a pattern hit or taste preference into a blocker.
6. If the user selected remote review, inspect only the authorized repository
   and comments. Deduplicate against actual external findings; draft replies
   separately. Reading comments does not authorize posting/resolving them.
   Optional workspace queue data is advisory, never proof of current review.
7. Return prioritized findings with minimal fixes, checked scope and missing
   verification. With authorized repairs, trace shared callers, fix the cause,
   run affected checks and preserve before/after evidence. Review-only stays
   unchanged; file length or severity alone never grants permission to edit.
8. If review persistence is requested, start the lifecycle before writing and
   log the checked result using `"$BFSTACK_BIN/bfstack-review-log"` with its JSON
   argument immediately after review. Bind the report to the actual content,
   target and evidence; a later timestamp cannot validate changed content.
   Store reusable lessons only through `bontaflow-memory` when authorized.
   Inspect any saved report and close the lifecycle. No-file review has no
   artificial session or completion record.