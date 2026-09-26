---
name: devex-review
description: Try a developer's actual first-success and error paths, measure friction and report evidence-backed improvements.
---

# Developer experience audit

Read [HOST.md](../../HOST.md). Test the chosen developer journey, not a
hypothetical product. A plan-only request belongs to plan-devex-review.

1. Read README, project instructions and actual entry scripts/interfaces.
   Establish the requested target and existing prerequisites. Do not install
   dependencies, create accounts or change user configuration to bypass a gap.
2. Follow the shortest documented path to first success. Use actual local
   commands and the packaged browse workflow for selected web surfaces.
   Record steps, outputs, elapsed time and starting conditions. Command duration
   is not a new user's total onboarding time; estimates remain labelled.
3. Exercise one relevant safe error path, inspect the actual message, and
   assess whether it explains the problem, cause and recovery. Other scenarios
   follow only when requested or risk justifies them.
4. Cover relevant dimensions: getting started; API/CLI/SDK ergonomics; errors;
   documentation/search/examples; migration/deprecation; developer environment;
   community/support; feedback and measurement. Distinguish tested, inferred,
   unavailable and not-run dimensions. Do not invent adoption statistics.
5. For web steps inspect real snapshots, console and screenshots, using visible
   human sign-in when required. Do not import cookies or assume authentication.
   External submissions and browsing follow the existing target authorization.
6. Report the first-success command, measured steps, prioritized friction and
   actionable recommendations. Optional scores need a stated rubric and evidence.
   Compare with plan-devex-review only when scope and metric definitions match;
   a promised score is not a measured baseline.
7. Keep an audit read-only. Authorized reports/logs use the HOST lifecycle,
   preserve raw failures and bind to the actual target. Execute any requested
   repair or documentation handoff in this task and inspect its result before
   claiming it helped. Otherwise offer recommendations only.