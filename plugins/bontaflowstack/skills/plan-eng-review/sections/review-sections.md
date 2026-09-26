# Engineering review dimensions

1. Architecture: component/data boundaries, authorization, ownership, shared
   callers, distribution and rollback. Trace normal, missing, empty and error
   paths where the change creates them; name user-visible recovery.
2. Code quality: existing conventions, duplicated invariants, fragile exception
   handling, overbuilding and missing validation. Check generated symbols and
   schema sources before claiming a field does not exist.
3. Tests: inspect AGENTS.md, scripts, configurations and test files. Match checks
   to changed behavior; include a regression for a demonstrated defect.
   Integration/E2E belong at real boundaries, not every trivial branch.
   State planned tests versus tests actually run. Do not install a new suite.
4. Performance: identify actual workload/bottleneck evidence. Assess resource
   bounds, queries, caching and concurrency only where relevant.

For a deep review, include a test plan, failure map, dependency-aware tasks and
diagrams when useful. Safe independent work may be planned in parallel; this
does not authorize spawning workers. A second opinion needs a real available
authorized mechanism and must be identified honestly.
