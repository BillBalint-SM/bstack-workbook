---
name: ship
description: Prepare a verified change for delivery, review and documentation, then perform only the authorized commit, push and PR steps.
---

# Prepare and ship a change

Read [HOST.md](../../HOST.md). Separate local preparation from publication.
A local-only request can complete preparation without implying a PR, merge,
release or deployment. Those effects require applicable authorization.

1. Pin repository, branch, HEAD, verified base, working-tree changes, remotes
   and existing PR when remote reading is selected. Resolve unknown edits and
   preserve user work. An empty diff has nothing to ship; no default-base guess.
2. Read requirements, plan/acceptance criteria, project checks and distribution
   configuration. Report missing delivery infrastructure. Do not bootstrap
   tests, install tools, fetch/merge/rebase, squash history or change CI merely
   because an old workflow suggested it. Reconcile the base only within scope.
3. Run existing affected tests and mandatory project gates; use evaluations
   when the changed behavior has them. Preserve each exit code and distinguish
   new, pre-existing and environmental failures. Do not waive a failure or
   rename it success. Coverage needs actual measured evidence.
4. Where evidence persistence is requested, use the existing
   `"$BFSTACK_BIN/bfstack-evidence" run --label "<lane>" -- "<exact command>"`.
   Read its help and result; use its content-bound check before publication.
   Otherwise retain raw commands/results and bind them to exact reviewed inputs.
   Changed code invalidates affected evidence; timestamps alone do not validate it.
5. Execute review in this same task with the concrete diff and requirements.
   Inspect and consume its findings; reuse only matching actual prior evidence.
   Apply relevant frontend/security/specialist lenses, without compulsory
   parallel agents or a second host. Resolve substantive issues within authorized
   repair scope and re-run affected checks; propagate failures/blockers.
6. Map implementation and test evidence to the plan. Report partial, missing,
   deferred and external items. Do not mark a TODO complete solely because a
   helper or reviewer said so.
7. Follow the repository's actual version/changelog policy when release edits
   are requested. Keep three/four-part version semantics and monorepo version
   paths; use packaged version helpers only for this selected policy. Queue
   awareness needs authorized live reads via landing-report. An offline bump
   cannot claim collision safety. No automatic version bump for every review.
8. Execute document-release for requested documentation synchronization with
   the exact change and scope; inspect the resulting docs/coverage. Missing
   new reference material can flow to document-generate. Keep factual changes
   separate from unresolved product decisions. Read back final diffs.
9. Before requested commits/push/PR work, verify the current target and content
   again, run the applicable redaction check and inspect its real result.
   No secret values in output. Stage exact owned files, make coherent commits
   only on the feature branch, and push normally to the authorized remote.
   Never auto-install hooks, force-push or commit all unrelated changes.
10. Create/update a PR only for the verified branch/base. Follow the project's
    title/template rules, preserve real newlines in a body file, include actual
    test/review/doc evidence and explicit limits. Do not invent version prefixes,
    issue links or outcomes. Reuse an existing PR; verify the response and link.
    External comment replies/resolution require their own requested scope.
11. Report local preparation, commit, push and PR outcomes separately. A merged
    PR follows land-and-deploy's finite verification path when requested, not
    background monitoring. Start/close HOST lifecycle for authorized writes.
    No permission/preferences setup is appended as a mandatory post-ship step.