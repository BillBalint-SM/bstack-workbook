---
name: design-html
description: Turn an approved design, image or plan into responsive HTML or a project-native component, with actual rendered checks and optional Pretext text layout.
---

# Design HTML

Read [HOST.md](../../HOST.md). Use its package, lifecycle, browser, permission
and same-task handoff contract. Work in the requested project and target files;
do not redirect project code into a personal state folder.

1. Read the supplied approved variant, design image, plan or concrete brief,
   the relevant existing UI, `DESIGN.md` and framework configuration. Identify
   the actual output path and accepted direction; a prior variant is not an
   approval. If input or an essential target is missing, resolve it before
   writing. Reuse settled answers and the existing framework.
2. Describe the small implementation: content hierarchy, colors, typography,
   layout, responsive states and interactions. Distinguish image observations
   from inferred behavior. Use available image inspection; a provider-backed
   extraction is optional and requires its real prerequisites and authorization.
3. Use native CSS for ordinary text layout. Retain Pretext when the requested
   design needs measured card heights, tight chat bubbles, text around obstacles
   or manual line rendering. Read [the packaged API reference](sections/pretext.md)
   before wiring it. For standalone output inline only
   `$BFSTACK_ROOT/design-html/vendor/pretext.js`; no CDN or source checkout
   fallback. For framework code use an already installed dependency; adding one
   needs authorization. If required Pretext is unavailable, return BLOCKED.
4. Start the workflow before output writes. Preserve unrelated files. Implement
   semantic HTML, concrete content, reusable existing tokens, keyboard access,
   visible focus, labels, readable contrast and a 320px layout. Honor reduced
   motion. Add editable text, theme switching or animation only when requested.
   For previews, use an agreed local output path; start a loopback server only
   if file loading is insufficient, recording ownership and stopping it safely.
5. Render through the shared `bfstack-render.ts` command or execute `browse` in
   this same task. Inspect the actual desktop and narrow screenshots and page
   errors. Check text, overflow, controls and the requested interactions; a
   generated image or file's existence is not verification. Example via launcher:
   `bun --no-env-file run "$BFSTACK_BIN/bfstack-render.ts" app/catalog.html --screenshot preview-320.png
   --width 320 --height 900 --screenshot preview-1280.png --width 1280 --height 900`.
   Stop only an owned browser. Propagate render failure.
6. Use an existing authorized design detector only if helpful; see
   [detector guidance](sections/detector-install-offer.md). Judge findings against
   this design, not a generic style ban. Correct substantive in-scope defects,
   then repeat only affected checks. Further aesthetic rounds follow feedback.
7. Read back the final files and report source direction, paths, format,
   Pretext tier (or native CSS), actual checks and limitations. When a design
   session needs reusable metadata, save `finalized.json` beside its artifacts
   with source, target, framework, tier and date; do not invent approval.
   Complete the lifecycle and return checked output to the caller.

Token extraction, image-to-code, framework output and refinement remain
available; none automatically authorize deployment or a different host.
