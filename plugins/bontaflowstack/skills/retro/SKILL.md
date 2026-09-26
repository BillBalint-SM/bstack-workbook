---
name: retro
description: Summarize an explicit local Git window with verifiable delivery, quality and focus evidence, and optional comparable history.
---

# Engineering retrospective

Read [HOST.md](../../HOST.md). Default to a read-only report for this repository
over seven days. Commit activity is evidence, not an employee performance rating.

1. Parse a positive h/d/w window, explicit ordered date range, compare mode or
   global mode with a user-selected repository set. Reject invalid/reversed
   ranges. Report the actual clock anchor, local timezone and exact bounds;
   day/week windows begin at local midnight, hour windows remain relative.
2. Verify the local ref and repository. Do not invent a base or automatically
   fetch. State when remote freshness is unknown. Global mode reads only the
   selected repositories; no scanning personal profiles or other tool histories.
   No selected/discoverable authorized repository is BLOCKED.
3. For repository metrics run the packaged helper through the launcher:
   `"$BFSTACK_BIN/bfstack-retro-metrics" --base "<verified-local-base>" --since "<start>" --until "<end>"`.
   Inspect RETRO_METRICS_PROTO, RETRO_METRICS_ERROR, RETRO_REF and guard lines;
   exit zero alone is not success. Report fallback refs and partial data.
4. Tie each metric to raw commits/checks. Distinguish commits, referenced PR
   numbers, verified merges and features actually released. Local Git cannot
   prove deployment. Test files changed are not tests passed or coverage.
   Session estimates from commit gaps are heuristics, not measured working time.
5. Summarize shipping activity, quality signals, hotspots, focus and documented
   wins/risks. Solo/team and cross-project views use actual selected data;
   do not infer personal identity from Git configuration or invent contributors.
   Relevant local decisions and lessons are read only via bontaflow-memory.
6. Compare equivalent windows/refs/metric definitions. A missing comparable
   report is BLOCKED for that comparison, not a fabricated trend. Missing
   external merge or session evidence remains unknown, not zero.
7. Return evidence, inferences and unknowns separately with useful next actions.
   Save only to an authorized local path, using HOST lifecycle and read-back;
   preserve previous reports. No automatic upgrade, external synchronization,
   background monitoring or global configuration change.