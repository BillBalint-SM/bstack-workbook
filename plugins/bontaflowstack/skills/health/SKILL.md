---
name: health
description: Run a project's existing quality checks and report their actual results, coverage and comparable trends without repairing code.
---

# Project health

Read [HOST.md](../../HOST.md). This is a diagnostic workflow, not permission to
fix code, install packages, rewrite configuration or create commits.

1. Read project instructions, package/task scripts and existing tool/config
   files. Identify type checks, lint, tests, dead-code and shell checks actually
   available. Prefer documented project commands. Missing tools are NOT_RUN.
2. State the selected checks and any known side effects. Use existing safe
   project checks; do not execute untrusted scripts outside the user's scope.
   Run sequentially, preserving each command, duration, exit code and useful
   stdout/stderr. A successful formatter must not hide a failing tool.
3. Distinguish findings, runner/configuration failure, missing prerequisite and
   a clean result. An unrecognized error is not a quality score or a pass.
   Report coverage/tests only when the tool actually provides those numbers.
4. Present a compact dashboard: category, actual command, result, evidence and
   next action. A completed dashboard can contain failing checks; it does not
   mean the project is healthy. No auto-fix follows the report.
5. If a numeric score is requested, disclose the rubric and measured inputs.
   For a complete five-category dashboard use weights: type 24%, lint 20%,
   tests 31%, dead code 14%, shell 11%. With missing categories report coverage
   and individual results; do not silently treat skipped checks as perfect.
   Scores are a documented heuristic, not release acceptance.
6. Reuse history only for the same tools, scope and conditions. Report changed
   coverage separately from a trend. Save configuration or append local history
   only when requested; keep an existing schema and preserve failed runs.
   Before authorized writes use HOST lifecycle; read back the saved report and
   close the lifecycle. A no-file trial does not create history.