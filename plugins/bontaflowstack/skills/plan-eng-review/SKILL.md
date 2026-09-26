---
name: plan-eng-review
description: Review a concrete plan or branch for architecture, correctness, tests, performance and implementation readiness, with evidence and proportional depth.
---

# plan-eng-review

Trace the affected flow and shared callers. Preserve architecture, code-quality,
test and performance review capability; use a small review for a small change
and a deeper review for material risks. Inspect actual test commands before
recommending them. A plan review does not execute the planned application.
Separate a missing plan decision from an observed implementation defect.

Read [HOST.md](../../HOST.md) for scope, lifecycle, actual questions and
same-task handoff. Review the explicit plan or branch target. Use existing
decisions; ask only if the target or a consequential choice is unresolved.
Read relevant project instructions, the target and its referenced local code.
A review is not authorization to edit implementation, publish, install tools
or persist preferences. For a no-file review return findings without state
writes. Start/end the lifecycle only for an authorized report/log write.

Read [review dimensions](sections/review-sections.md) and select the depth
needed for this request. Explain omitted or unavailable evidence. Prioritize
concrete consequences with target locations, evidence, uncertainty and a
recommended correction; do not manufacture a numeric score or a finding to
fill a section. Scores and deeper rounds are optional. Required decisions
remain open until the real applicable answer; recommendations are not choices.

Before alleging missing behavior, inspect definitions and callers, including
generated/schema declarations. Separate planned behavior from observed code.
For authorized plan edits preserve accepted decisions and unrelated content.
Return checked target identity, findings, open decisions and acceptance checks.
Use current content/plan hashes when reusing earlier review evidence; a recent
timestamp alone does not prove it still applies.

When the caller needs a reusable report, include `## BFSTACK REVIEW REPORT`,
this review's actual status and findings, and either `NO UNRESOLVED DECISIONS`
or explicit unresolved items. Write it into the plan only if authorized,
without deleting other review evidence. Existing `bfstack-review-log` /
`bfstack-review-read` may record/read actual results when in scope; do not log a
clean result before checks or treat it as shipping authorization.
Use `bontaflow-memory` for relevant local decisions only. A requested next
review must actually execute under HOST and return an inspected result.
