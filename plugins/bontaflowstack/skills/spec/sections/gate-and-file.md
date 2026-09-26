# Validate, save and optionally publish

Follow HOST and the user's selected destination. There is no mandatory external
scoring process, issue creation, worktree, stash or second agent.

1. Review the exact draft for credentials, personal/internal information and
   unsupported claims. Remove unnecessary sensitive detail before creating
   evidence or a shared artifact. Do not print a secret in a finding.
2. Before persisting or sending the spec, put its exact bytes in the runtime's
   local temporary scope and run the existing packaged helper through launcher
   `run`: `"$BFSTACK_BIN/bfstack-redact" --from-file "<draft>" --repo-visibility
   "<public|private|unknown>" --json`. Use known visibility; unknown remains strict.
   Save the exit code before formatting the diagnostic.
3. Exit 0 permits the applicable sink. Exit 3 blocks all downstream output of the
   raw body: redact at source and rescan. Exit 2 requires addressing the actual
   medium findings: redact/edit/cancel, or an applicable explicit decision where
   the helper allows acknowledgment. Other nonzero codes are scan errors and
   block the sink. Never treat missing tooling as clean. Do not automatically
   rotate credentials or expand this task into an incident response.
4. Use the same scanned bytes for the requested local file or external payload.
   A changed body needs a new scan. Verify the resulting file or response. An
   approved local file does not authorize posting it or any commit/push.
5. For a chosen tracker, prepare the exact title/body and target first. Reuse
   applicable publication authorization, otherwise request it at this final step.
   Preserve tracker failures; never invent an issue number or continue dependent
   implementation as if filing succeeded. Use structured input or a body file,
   never shell-interpolated issue text.
6. Optional quality scoring must name the actual reviewer/check and its outcome.
   If unavailable, report the limit. A quality gate bypass never bypasses the
   redaction boundary. Do not retry unless a concrete finding changed the draft.
7. `--execute` can continue with the checked spec in the same task when authorized
   and feasible. A separate task or subagent requires its own applicable request.
   Preserve dirty work; do not auto-stash or manufacture native task identifiers.

A no-file answer still omits secrets. A blocked required decision remains open;
HOST's waiting/resume rules apply. Keep only useful, content-safe evidence in the
local project; optional decision/learning records go through `bontaflow-memory`.
