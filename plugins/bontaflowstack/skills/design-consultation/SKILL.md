---
name: design-consultation
description: Develop or refine a coherent design system from the product brief, with optional research and previews, then document approved choices.
---

# Design consultation

Read [HOST.md](../../HOST.md) and follow its scope, real-question, lifecycle,
browser and same-task handoff rules. A conversation or no-file proposal does
not authorize implementation, persistent preferences or project instructions.

1. Read the actual brief, relevant UI and existing `DESIGN.md`. Establish the
   audience, primary task, surface, constraints and intended impression from
   available evidence. Ask only for a consequential missing decision. Preserve
   an existing system unless the user asks to replace it.
2. For an existing design document, run `bun --no-env-file run
   "$BFSTACK_BIN/bfstack-design-md.ts" check DESIGN.md` through the launcher.
   Inspect the reported format; exit zero alone does not mean valid. Read a
   retained legacy document as prose. Convert or mark it only when authorized;
   the existing converter preserves a backup. Do not silently migrate it.
3. Use project-local `bontaflow-memory` or an existing taste profile only when
   relevant. Previous choices are advisory, not today's approval. Do not write
   a profile or copy personal state as a side effect of this consultation.
4. If research is requested, inspect authorized references using an available
   read-only tool, or hand off to `browse` for the chosen pages. Cite observed
   sources. Unavailable research is a stated limitation, never invented support.
5. Propose one coherent direction: color and contrast; typography and font
   availability; layout, spacing and mobile behavior; shape and depth;
   component states; motion and reduced motion. Tie choices to the product.
   Offer a distinct alternative or deliberate visual risk when useful; there
   is no mandatory number of questions, risks, scores or review rounds.
6. Apply requested refinements while checking the remaining choices still fit.
   An approved direction can proceed without asking the same question again.
   For a requested local preview, execute `design-html` with that direction
   and an authorized output path, inspect its rendered result and use the
   findings. For variants use `design-shotgun`. Image-provider availability
   does not authorize network requests or spending; missing prerequisites
   block that path. A skipped preview is not a visual check.
7. When documentation is authorized, write or update the chosen `DESIGN.md`.
   Use concrete values in YAML groups `colors`, `typography`, `rounded`,
   `spacing`, `components`; include foreground/background and semantic
   success/warning/error colors, type roles, spacing and component states.
   Explain overview, layout, depth, shapes, do/don't rules, motion and decisions
   in prose. Keep the existing format when requested. Do not add an `AGENTS.md`
   instruction unless that edit is also authorized.
8. Read back the result. For the structured format, inspect both `check` and
   `tokens` output from `bfstack-design-md.ts`: require `DESIGN_MD_FORMAT: spec`,
   no invalid references, concrete tokens and coverage of the agreed states.
   Format recognition alone is not semantic completeness or accessibility.
   Complete a started lifecycle only after the actual checks.

Return the direction, decision source, actual preview/document paths, checked
properties and remaining limitations. Execute any requested next skill using
the checked artifact; a suggested next step is not a completed handoff.
