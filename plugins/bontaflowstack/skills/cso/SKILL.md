---
name: cso
description: Audit a chosen codebase or change for evidence-backed security risks, trust boundaries and remediation priorities.
---

# Security audit

Read [HOST.md](../../HOST.md). Default to a scoped read-only audit; access to
code is not authorization for live exploitation, cloud scans, secret rotation,
dependency installation or publication.

1. Resolve target, available source and mode. Choose full or diff analysis;
   conflicting full/diff requests need clarification before execution.
   Apply a named scope such as infra, code, skills, supply-chain, OWASP or auth.
   Comprehensive mode expands relevant coverage, not authorization.
2. Map architecture, entry points, identities, data classification, privileged
   actions and trust boundaries. Trace actual definitions and callers.
   Examine applicable areas proportionally:
   - input validation, injection, authentication and authorization;
   - data integrity, cryptography, randomness and sensitive storage/logging;
   - secrets in the authorized source/history range, with redacted output;
   - dependency versions, lockfiles, install scripts and reachable supply risk;
   - CI permissions, artifact trust, deployment/infra configuration;
   - webhook signatures, replay prevention and external integrations;
   - LLM/tool/skill input boundaries, instruction injection and tool privileges;
   - OWASP risk categories and STRIDE threats where relevant to the system.
3. Use installed read-only checks where available. Current vulnerability claims
   require current authoritative evidence and exact affected versions. If
   external lookup is unavailable or outside scope, mark those claims unverified;
   a lockfile scan alone does not establish current CVE absence.
4. Verify findings against the actual source and real data path. Use a safe
   local reproduction where practical. Separate exploitable behavior, a design
   risk and a heuristic hit; never claim exploitation from a grep match.
   Active verification stays within the explicitly authorized target/effects.
5. Report location, trigger, consequence, confidence, redacted evidence and
   minimal remediation. Do not print credentials or personal payloads, and do
   not send private source to external services. Deduplicate related symptoms.
6. State checked and untested scope. Save a local report/trend only when
   requested, starting and closing the HOST lifecycle for writes. Compare only
   equivalent scopes. Fixes and external actions retain their own authorization;
   no finding silently triggers them. Reusable project lessons use only
   bontaflow-memory when authorized.