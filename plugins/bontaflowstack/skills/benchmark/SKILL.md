---
name: benchmark
description: Measure real page performance, retain samples and compare compatible baselines or trends without modifying the application.
---

# Browser performance benchmark

Read [HOST.md](../../HOST.md). Follow scope, lifecycle, browser readiness,
local authentication and same-task handoff. This is a bounded measurement,
not continuous monitoring, a model benchmark or automatic optimization.

1. Identify URL/pages and allowed conditions. Modes: `--quick` one sample;
   `--baseline` explicit baseline capture; `--pages` chosen paths; `--diff`
   verified local changed-page scope; `--trend` compatible saved history.
   Use the supplied target/base; do not guess a remote or run GitHub by default.
2. Execute `browse` and measure actual pages. Record date, browser, viewport,
   cache/throttling/network/auth conditions and source revision when known.
   Preserve failures; a failed page load is not a slow successful page.
3. Read navigation/paint/resource entries from the page using `perf` or
   `js`. Navigation entries serialize inside the page with `toJSON()`.
   Capture TTFB=responseStart−requestStart, DOM interactive/complete and load,
   FCP from paint entries, resource request count/duration/transfer and script/
   stylesheet inventory. Measure LCP with a buffered PerformanceObserver and
   a bounded wait; null means unavailable. Do not invent CLS/INP from load time.
   A browser lab sample is not a field Core Web Vitals assessment.
4. For a stable comparison take three samples under equivalent conditions,
   retain each and report medians. A quick single sample is explicitly limited.
   Missing/cross-origin/cache-hidden sizes remain unknown, not evidence of zero
   payload. Transfer size and source bundle size are different quantities.
5. Without a comparable baseline report absolute measurements only. Otherwise
   compare like metrics and coverage; zero denominator means percentage N/A.
   Default comparison thresholds (user budgets override): timing regression
   >50% or >500ms, warning >20%; transfer/script/stylesheet regression >25%,
   warning >10%; requests warning >30%. Apply regression before warning.
   These are plugin heuristics, not universal performance standards.
6. Show slowest measured resources and evidence-based suspects. Treat a
   suspected cause as a hypothesis until traced. Evaluate only declared budgets;
   if providing suggested budgets, label them and do not claim user acceptance.
7. For authorized output, start before writing and save the report plus raw
   metrics in the chosen project directory (default .bfstack/benchmark-reports).
   Only `--baseline` updates the selected baseline; retain a dated copy and
   previous history. Trend mode compares compatible historical samples.
8. Check report numbers against raw samples, stop owned resources, close the
   lifecycle and return measured scope, comparison availability and limitations.
   Do not modify code, install Lighthouse or claim an unexecuted performance fix.
