---
name: learn
description: Review, search, add, prune or export the current project's local learnings. Use for remembered patterns, pitfalls and preferences; reads do not change the store.
---

# Project learnings

Read `../../HOST.md` and load `bontaflow-memory` from the same package.
Use its project store, local commands and validation rules. Return the actual
memory operation's checked result; do not modify source code automatically.

## Read commands

- Default: `"$BFSTACK_BIN/bfstack-learnings-search" --limit 20`.
- Search: add `--query "$QUERY"`, with the query passed as data, not inserted
  into shell code. Optional type filtering uses the helper's `--type` flag.
- Present the actual type, source, date and confidence. A successful empty
  result means no matches; preserve nonzero exits and malformed-store errors.
- Stats: read the current project's `learnings.jsonl`; report raw count and
  unique count after latest-timestamp deduplication by key and type, counts
  by type/source, and average confidence. Use zero/unknown for an empty store,
  never NaN; report malformed records rather than silently discarding them.

## Add or update

Reuse provided fields. Ask only for missing meaningful data: type, short
alphanumeric/hyphen/underscore key, insight, confidence 1–10 and optional
project-relative files. Types: pattern, pitfall, preference, architecture,
tool, operational, investigation. Preserve source truth: `user-stated` only
for an actual user statement; fixture/agent findings use `observed` or
`inferred`. Start one `learn` write run, call the memory contract's
`bfstack-learnings-log` with serialized JSON, and verify it through search.
An update appends the revised entry with the same key/type; latest wins.

## Prune

Read at most 100 current-project entries, flag stale file references and
conflicting key/type insights, and show the exact proposed changes. Reuse
specific valid removal authorization; otherwise leave entries unchanged and
request the decision. For an authorized removal, validate every original
JSONL record, retain a recoverable original and atomically replace only the
selected records. An invalid file or ambiguous target stops the write.
Verify retained neighbors and the requested change before finishing the run.

## Export

Read up to 50 entries and return redacted Markdown grouped as Patterns,
Pitfalls, Preferences, Architecture and any other present types. Save or append
to a named project document only when requested. A read-only display, search,
stats or export-to-response does not start a write session.

If asked for a global or another project's export, return `UNSUPPORTED_SCOPE`
without reading or writing either store. Never widen beyond the current
project. No external
sync, hidden cache refresh or automatic learning capture is implied.
