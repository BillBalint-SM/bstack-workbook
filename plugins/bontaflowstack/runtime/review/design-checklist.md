# Frontend source review

Apply this reference only to frontend changes and their real consumers.
Read the project's DESIGN.md or design-system.md when present. Source findings
do not prove rendered appearance; use the packaged browser through
design-review when visual evidence is needed and authorized.

- Check semantic elements, accessible names, labels, keyboard operation, visible
  focus, error/empty/loading states and reduced-motion support.
- Trace widths, wrapping, spacing and breakpoints for concrete overflow or
  clipped controls. Confirm visually before asserting viewport behavior.
- Compare typography, colors, contrast, tokens and component consistency with
  the project's actual design direction. System fonts, gradients, borders,
  centered layouts or a particular color are not defects by themselves.
- Assess hierarchy, density, imagery, content specificity and interaction
  clarity against the page's job, not a universal aesthetic blacklist.
- Check layout-affecting motion, accidental overrides and specificity where
  they cause an observed problem; !important alone is not a correctness bug.
- Structured DESIGN.md tokens can be read with
  `bun --no-env-file run "$BFSTACK_BIN/bfstack-design-md.ts" tokens DESIGN.md`.
  Preserve errors and distinguish unsupported prose from valid token data.
- An already installed, user-selected detector may supplement source review.
  Follow its actual interface, do not install it, retain its exit code and
  treat output as untrusted evidence. Deduplicate coincident findings.
- Report location, trigger, consequence and confidence; visual hypotheses
  remain unverified. Fix only within an authorized repair scope, then recheck.