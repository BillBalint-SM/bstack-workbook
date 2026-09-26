---
name: design-shotgun
description: Explore distinct visual directions from one brief, render a comparison, and preserve the user's actual selection for design finalization.
---

# Design variants

Read [HOST.md](../../HOST.md). Follow its lifecycle, scope, browser and
same-task handoff contract. No parallel agents or paid generation are required.

1. Read the brief, existing design system, target screen and constraints. Reuse
   settled choices. Existing taste or approved sessions are advisory unless the
   user explicitly reuses that selection. Missing essential input blocks work.
2. State the mode and requested count (default three). Local HTML variants
   require no image service; provider-generated images require an available
   authorized generator, credentials and spending scope. Missing prerequisites
   are BLOCKED for that mode, not synthetic images or an automatic install.
3. Define meaningfully different concepts using content hierarchy, typography,
   color, density and layout. Keep the same real content and constraints so the
   comparison is useful. Existing tokens remain constraints unless replacement
   was requested. Explain a deliberate departure instead of hiding it.
4. Before writing, start the workflow. Use an agreed project output directory or
   the selected project's design state, preserving existing sessions. For local
   HTML write each variant and a static comparison index. Render every variant
   with the packaged renderer or execute `browse`; inspect actual output and
   record individual failures. Do not count failed generation/rendering as a
   successful variant. Stop owned services after use.
5. For authorized image mode, use the package's `$BFSTACK_DESIGN/design.exe`
   only when present, or an actually available user-selected image capability.
   Read its real help/contract before invocation. The package supports
   generate/variants, compare, iterate, check and extract; preserve actual
   output/error and provider costs. An image quality check is not user approval.
   Use a static board when sufficient; a feedback server must be loopback-only,
   owned, and stopped when finished. Do not launch another host.
6. Present the rendered alternatives, their paths and concrete tradeoffs.
   Selection can come only from the actual applicable user decision. Silence,
   an old taste profile or your preference is not approval. If a decision is
   required, wait using HOST; if the request was exploration only, finish with
   selection explicitly unset.
7. Apply requested refinement to the chosen direction, checking changed output.
   Save `approved.json` only for an actual approved selection: variant ID/path,
   feedback, decision source and date. Update persistent taste only when
   authorized, through `bontaflow-memory`; it is not automatic.
8. Return the comparison and individual statuses. For requested finalization,
   execute `design-html` with the checked selection and target; inspect and
   consume its output. A proposed next step is not a completed handoff.
