# Design brief and handoff

Save only when the task requests a file. Prefer the project's established docs
location; otherwise use `docs/designs/<topic>.md`. A local memory copy is optional
through `bontaflow-memory`, not an automatic second write. Inspect an existing
file before editing; preserve unrelated content and link a superseded design.
For a no-file trial, return the brief in the answer.

Use only useful sections:
- Goal, mode and concrete problem.
- Current evidence and constraints; assumptions explicitly identified.
- Alternatives, selected approach and reason; rejected approaches need one line.
- Success criteria, dependencies and open decisions.
- Distribution/usage where relevant, and one next action.

Startup briefs include demand, workaround and narrow user/value. Builder briefs
include learning/creative purpose, time budget and demo outcome. Do not add
personality assessments, empty sections, invented agreement or a fictional
independent review. Unresolved decisions keep the brief in draft.

Inspect the exact bytes for secrets or private information before persisting or
sharing. Use the packaged redaction helper when those risks apply; preserve scan
errors and block an unsafe sink. Repository documentation is not automatically
public, and a local file write does not authorize a commit or remote publication.

Read back the saved result. Pass the exact document and open decisions to a
requested next skill using HOST; verify and consume its actual output. Otherwise
state a next action without starting implementation.
