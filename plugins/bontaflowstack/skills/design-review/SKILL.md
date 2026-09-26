---
name: design-review
description: Inspect real UI output for visual and interaction defects, optionally repair authorized issues, and verify the affected design in the packaged browser.
---

# Design review

Read [HOST.md](../../HOST.md). Use the packaged browser with scoped actions,
real auth and owned-resource cleanup. Review-only means no application changes.

1. Establish URL/pages, accepted design direction, source access and whether
   fixes are requested. Read relevant `DESIGN.md` and existing components.
   Modes: quick (critical screen), full (agreed pages), deep (specified detailed
   audit), diff-aware or regression against a named matching baseline.
2. Execute `browse` to observe the actual page, inspect fresh snapshots and
   desktop/narrow screenshots. View the images. For a text plan use
   `plan-design-review`; never call an inferred appearance a rendered result.
3. Review applicable dimensions: hierarchy/first impression, typography,
   contrast and semantic color, spacing/layout, interaction states, responsive
   behavior, motion/reduced motion, content/copy, design-system consistency and
   performance evidence. Trace important journeys and cross-page consistency.
   Examine empty/error/loading/disabled states where the scope includes them.
4. Tie each finding to an observed element, viewport, impact and reproduction.
   Prefer measurable overflow, inaccessible controls, misleading copy or broken
   states over personal style bans. An approved system font, card grid or color
   is not inherently a defect. Do not invent engagement or performance metrics.
   An optional authorized installed detector can add findings; absent support is
   NOT_RUN, not permission to install or change hosts.
5. Save a scoped report and actual evidence when authorized. Scores are optional:
   state the rubric, measured coverage and uncertainty; do not force 10/10.
   Regression comparisons need matching pages/viewports and prior evidence.
6. If fixes are requested, triage, trace source/shared callers and make a minimal
   change. Preserve before evidence. Check the same viewport and interaction
   again, plus affected regressions. Separate verified from unverified/deferred
   fixes. Do not bootstrap tools, commit or revert history automatically.
7. If a target mockup is explicitly needed, execute `design-shotgun` or
   `design-html` and consume its checked output. Missing image-service/auth
   blocks only that requested path; it cannot yield a fake target image.
8. Read the final report, retain failures, stop owned resources and close the
   lifecycle. Return findings/fixes with before/after evidence, scope and remaining
   limitations. An audit result alone is not release acceptance.

Use the existing [QA report structure](../qa/templates/qa-report-template.md)
where useful. Persistent learning belongs to `bontaflow-memory` only when
requested; an audit does not automatically write preferences.
