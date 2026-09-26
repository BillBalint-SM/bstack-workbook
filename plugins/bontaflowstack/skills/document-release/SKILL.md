---
name: document-release
description: Bring existing documentation into line with a verified change, map missing coverage and check the resulting files.
---

# Synchronize release documentation

Read [HOST.md](../../HOST.md). The request may be an audit or authorized local
documentation edits. It does not by itself authorize commits or publication.

1. Pin the change/base and inspect relevant source, tests and existing docs.
   Map changed APIs, flags, configuration, behavior and operations to their
   documentation. Mark each entity current, stale, missing or not applicable.
   An unreadable source or ambiguous change is a concrete gap.
2. Update only authorized factual documentation. Preserve project voice,
   unrelated text and historical evidence. README positioning, architectural
   rationale, security promises and unsupported migration claims are decisions,
   not mechanical replacements; use existing direction or leave the gap explicit.
3. For genuinely missing material in scope, execute document-generate here
   with the exact entities, target paths and output condition. Read its actual
   result and incorporate it in the coverage map. A recommendation is not
   completed documentation.
4. Keep CHANGELOG user-facing and supported by the actual diff. Do not invent
   dates, links, authors or released status. Update TODOs only when evidence
   proves completion. Version changes follow the selected repository policy
   and request, not an automatic bump for prose.
5. Check cross-document terms, commands, counts and local links; run a safe
   affected example. Broken links or untested external examples remain visible.
   Scope a required follow-up narrowly; no mandatory full documentation rebuild.
6. Read back the final diff and saved files, then report updated/unchanged/
   missing coverage and checked limits. Use HOST lifecycle for authorized writes.
   Return the checked result to ship/land-and-deploy when called; propagate any
   failure or blocker. A no-op audit should say no changes were needed.