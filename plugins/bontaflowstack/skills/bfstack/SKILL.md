---
name: bfstack
description: Choose the appropriate BontaFlowStack skill for a requested task and execute it in the same Codex task with a checked result. Use when the user invokes bfstack without a specific skill or asks which skill fits. A request for advice or a skill list returns guidance without starting a workflow.
---

# BontaFlowStack router

Read `../../HOST.md` before routing. It defines the shared Codex, authorization,
runtime and result rules. Use this plugin's `scripts/bfstack.ps1`; do not search
another installation or a development checkout for a missing target.

## Select the smallest matching workflow

1. Respect an explicitly named skill and the user's requested scope. If the
   user asks which skill to use, explain the match without executing it.
2. Otherwise choose the specific match in the table. Browser use is a
   dependency of QA, scraping and visual review, not a reason to replace those
   workflows with general browsing. A review request does not authorize fixes.
3. Ask only if missing information would materially change the target or an
   authorized action. Reuse decisions already given in this task. If nothing
   matches, answer directly; do not force the request into this suite.
4. Execute one target at a time. Continue to another skill only when the
   requested workflow needs it and the preceding result has been checked.

The short names below refer exclusively to skills in this BontaFlowStack
package. The installed catalog may display them as `bontaflowstack:<name>`;
the launcher's `-Skill` argument takes the short name without a slash.

| Request | Target |
| --- | --- |
| Explore an idea or whether it is worth building | `/office-hours` |
| Turn an agreed need into a specification or a requested issue draft | `/spec` |
| Review product direction, value or scope of a plan | `/plan-ceo-review` |
| Review architecture, implementation approach or engineering risks of a plan | `/plan-eng-review` |
| Review the visual design proposed in a plan | `/plan-design-review` |
| Review API, CLI, SDK or onboarding experience proposed in a plan | `/plan-devex-review` |
| Run the coordinated plan reviews | `/autoplan` |
| Review or adjust local question preferences | `/plan-tune` |
| Choose a design system, visual identity or design direction | `/design-consultation` |
| Produce the final HTML design from an agreed direction | `/design-html` |
| Compare several visual design alternatives | `/design-shotgun` |
| Diagnose a bug, error or unexplained behavior | `/investigate` |
| Review code or a diff, including a requested second opinion | `/review` |
| Inspect a site's bugs and report findings without fixing | `/qa-only` |
| Test a site and fix the authorized findings | `/qa` |
| Audit visual consistency or polish of an existing page | `/design-review` |
| Audit the actual developer experience | `/devex-review` |
| Measure performance or compare a performance baseline | `/benchmark` |
| Report existing code quality signals | `/health` |
| Inspect security risks or vulnerabilities | `/cso` |
| Inspect a page, take a screenshot or run a one-time post-deploy browser check | `/browse` |
| Open the packaged visible browser, including for manual sign-in | `/open-bfstack-browser` |
| Extract structured information from a page | `/scrape` |
| Make a reusable local skill from the latest successful scrape | `/skillify` |
| Generate missing project or feature documentation | `/document-generate` |
| Update documentation for shipped changes | `/document-release` |
| Summarize recent engineering work and lessons | `/retro` |
| Prepare and perform the authorized shipping or PR workflow | `/ship` |
| Merge, deploy and verify an explicitly authorized target | `/land-and-deploy` |
| Configure deployment settings for a selected target | `/setup-deploy` |
| Report the landing queue and current work status | `/landing-report` |
| Read or record local project decisions and run history | `/bontaflow-memory` |
| Save resumable working context | `/context-save` |
| Restore saved working context | `/context-restore` |
| Review, add, export or prune local learnings | `/learn` |
| Enable destructive-command protection | `/careful` |
| Restrict file edits to a chosen directory | `/freeze` |
| Combine destructive-command protection with an edit boundary | `/guard` |
| Clear the active edit boundary | `/unfreeze` |

## Execute the selected skill and return its result

State the selected target briefly when that helps explain the work. Supply its
concrete input: the request, relevant local artifact or URL, scope, decisions
already made, and the output condition to check. Carry existing authorization
forward without widening it.

Load the target's instructions from this same package:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/bfstack.ps1" -Mode read -Skill "<skill>"
```

Replace `<plugin>` with this plugin's resolved directory and `<skill>` with the
selected table entry. The returned bundle contains HOST and the target skill.
A failed read is `BLOCKED` for that target; preserve its error and do not
substitute a similarly named skill from elsewhere.

Follow the returned target instructions in this same Codex task, subject to
HOST and the user's scope. Load its required local references, perform its
work, and inspect the actual answer or artifact against the output condition.
Instruction retrieval alone is not successful execution. Do not start a
separate task or invent a native skill-call API to perform this handoff.

Return the checked target result to the calling workflow and use it in the
next requested step. Keep the target, input, output/evidence and check outcome
traceable in the existing response or case report. Propagate `FAIL`, `BLOCKED`,
`WAITING_USER` or `UNKNOWN`; do not run dependent steps as if they succeeded.
Do not recursively route back to this router without a new user request.

## Runtime and completion

The router's selection, guidance and instruction reads do not open a session.
A target that performs workflow side effects owns
its start/end protocol under HOST. Keep the actual `CODEX_THREAD_ID` inherited;
the router does not create a second target session or a synthetic native event.

For browser-dependent targets, use the packaged Windows browser after its
readiness check. Authentication uses visible human sign-in, then continuation;
missing login is a named blocker and never permission to import credentials.

Respect an explicit opt-out from proactive suggestions. Invoking this router
to do a task is an explicit routing request; asking it for advice is not an
execution request. If the user asks to persist an opt-out or opt-in, use the
existing `bfstack-config set proactive false` or `true` through the packaged
launcher and normal write-session protocol. Do not change this setting merely
because a request has no matching skill.

Report the actual target outcome, useful evidence and any untested boundary in
the user's language. A routing recommendation, loaded instruction bundle or
skipped step must not be reported as a completed workflow.
