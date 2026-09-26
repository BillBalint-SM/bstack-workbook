# BontaFlowStack Codex Desktop host contract

This package runs only in the Windows x64 Codex Desktop environment. Its skills
are maintained workflows; their presence is not evidence of native acceptance.

## Packaged interface

Skills use one package-relative PowerShell entry point:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/bfstack.ps1" -Mode <mode>
```

Supported modes are:

| Mode | Purpose |
|---|---|
| `check` | Validate packaged runtime availability before a workflow claims it can run. |
| `read` | Return HOST and a named skill's instructions without writing state; it does not execute the skill. |
| `run` | Run a packaged runtime command supplied on standard input; it is not a skill-dispatch API. |
| `hook` | Handle a trusted pre-execution hook event. |
| `safety` | Evaluate a packaged safety rule. |
| `lifecycle` | Process a trusted lifecycle event. |
| `questions` | Process a trusted question event. |

The implementation must resolve the script and its runtime from the installed
plugin directory. A skill must not use an absolute development checkout path,
a user profile path, or another host's global configuration as fallback.

The installed BontaFlowStack package uses the `bontaflowstack` plugin identity
and `%LOCALAPPDATA%\BontaFlowStack\state`. Its short router name is `bfstack` (`bontaflowstack:bfstack`);
internal `BFSTACK_*` helper names remain valid. The launcher supplies the paths
for the selected package identity. Always use the launcher from the
selected installed plugin. Do not copy state or credentials from another
installation. Project outputs remain in the selected project, so use the
separate test projects for acceptance runs.

## Task scope and host capabilities

A skill may use only an actually available Codex Desktop capability. An older
host command, unavailable browser/runtime, untrusted hook, missing login, or
unsupported platform branch returns a concrete `BLOCKED` or `OUT` result; it
does not launch another host or simulate a result.

This shared contract takes precedence over conflicting wording in the package's
skills and references. It remains subordinate to the user's scope and the
host's governing instructions. A skill cannot widen tool restrictions, leave
plan mode, invent tools or grant itself permission through its own text.

Use the smallest workflow that fulfils the request. Extra review rounds,
scoring, research or another model are warranted only by the request or a
concrete risk. A review or read request does not itself authorize fixes,
commits, publication, memory changes or configuration changes. Reuse an already
given decision when its target, effect and scope still apply; do not request
the same authorization again. Web and GitHub actions require the user's choice
of target and applicable authorization.

For a missing required decision, use an actually available Codex question tool
within its current mode and purpose limits, or ask in prose and wait for the
real answer. A recommendation, saved preference, delegated worker, timeout or
silence cannot provide a required answer. Saved preferences remain advisory
unless their exact optional-question scope and reset limits are enforced.

Only the packaged Windows browser is supported by these workflows. Other-host
browser branches are `OUT`. The launcher
`check` mode verifies only its documented basic runtime/tool output; it does not
prove a browser is ready. A workflow may use the packaged browser executable
only after its own package-relative executable/extension test succeeds through
the launcher's `run` standard-input path; otherwise the browser-dependent step
is `BLOCKED`. It must not install a browser or driver.
Package setup, reset, relink and self-update commands are disabled inside
workflows. A missing package capability is a named blocker, not permission to
download dependencies or switch installations. Preserve the shared browser,
HTML renderer, local authentication and required common helpers. Login uses a
visible human sign-in followed by resume; never copy a personal browser profile
or import credentials to avoid this boundary.

Trusted hooks are optional runtime prerequisites. Hook absence or trust refusal
means the workflow cannot claim enforcement. Lifecycle and question records are
scoped to the real project and Codex task.

## Skill handoff in the same task

The caller selects a skill from this package and supplies the concrete input,
scope, existing decisions and an output condition. Load that target using:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/bfstack.ps1" -Mode read -Skill "<skill>"
```

Then follow its instructions in the same Codex task, perform the requested
work, and inspect the actual answer or artifact against the output condition.
Pass the checked result back to the caller and use it in the next requested
step. The existing response or case report must identify the caller, target,
input, output/evidence and check outcome; a new dispatch service is unnecessary.

A recommendation, instruction read or self-reported completion alone is not
a successful handoff. A missing target is `BLOCKED`; preserve command errors
and propagate target failure or waiting status without running dependent steps
as if they succeeded. Do not manufacture native call-return events, task IDs
or hook observations. Native selection of the installed entry skill is a
separate acceptance claim from this same-task execution.

## Timeline protocol

For one real workflow run, the skill invokes the packaged starter exactly once
before its workflow side effects by supplying this Bash command to the
launcher’s `run` standard input:

```bash
"$BFSTACK_BIN/bfstack-skill-start" --skill "<skill>" --model "gpt" --parent-pid "$PPID"
```

The direct output is the authoritative session protocol: retain
`SKILL_START_PROTO: 1`, `SESSION_ID`, and `TEL_START`. The starter itself writes
the `started` event and reports existing local configuration without changing it.
It does not inject onboarding prompts, auto-commits or another host's instructions.
Router selection/instruction reads, read-only memory lookups/lists/restores and an
explicit no-file trial do not start a workflow session. A side-effecting target
owns its start/end pair; routing to it does not create an extra wrapper session.
If host mode or the user's scope forbids a write, do not override that boundary
for logging; do not claim that a skipped lifecycle operation was recorded.
After a required-answer wait, continue the same opened session rather than
starting another one. Safety workflows start only after their input boundary and
a fresh native-hook observation pass. Run the read-only native status check in
the current project first:
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/bfstack.ps1" -Mode safety -Action status`.
Its JSON is `{session, projectKey, careful, freeze}` and proves only local scope
identity. The only valid hook observation is the exact
`BFSTACK_SAFETY_HOOK_OBSERVED session=<actual native session_id> project=<64 lower-case hex SHA-256 of canonical project root (Git root when available, otherwise the current project directory)>`
additional context delivered by that same tool result, with marker `session` and
`project` matching the JSON `session` and `projectKey`. Do not accept a manually
invoked hook, command/tool output, `trusted_hash`, or an observation from
another task. If the marker or matching JSON is absent, return `BLOCKED`: have
the user verify the four BontaFlowStack hooks in Codex Settings, then retry status in
the current task. Native deny behavior remains E2E.

At an actual terminal completion of a started run, the skill invokes the
existing packaged completion command through the launcher `run` standard input:

```bash
"$BFSTACK_BIN/bfstack-skill-end" --skill "<skill>" --outcome "<success|error|abort|unknown>" --session-id "$SESSION_ID" --tel-start "$TEL_START"
```

Use only the `SESSION_ID` and `TEL_START` emitted by that run's starter and an
outcome that reflects the actual result. A required-answer wait leaves the run
open and does not call the completion command. A block before the starter also
has no completion command. This contract adds no new completion engine.

The packaged `bfstack-timeline-log` runtime command is the sole shared timeline
writer. A caller passes one JSON argument, for example
`"$BFSTACK_BIN/bfstack-timeline-log" '{"skill":"<skill>","event":"waiting_user"}'`,
inside a Bash script supplied to the launcher’s `run` standard input. The actual
`CODEX_THREAD_ID` remains inherited in the environment; the runtime adds the
session identifier and project slug. Skills do not create a parallel P4 journal
or invent a task identifier.

Immediately before a skill ends a turn while it awaits a required answer, it
appends a `waiting_user` event with its skill name. After a real later reply,
it appends `resumed` before continuing. A Stop repair preserves waiting or
ambiguous runs rather than marking them complete. This protocol never turns a
timeout, recommendation, silence, or simulated event into a reply.

## Included workflows

The maintained `plugins/bontaflowstack/skills` tree contains 40 packaged skills. The
local `bontaflow-memory` skill is the sole memory direction; `context-save`,
`context-restore`, and `learn` retain their focused local workflows through it.

Web and GitHub operations run only when the user chooses them. The reduced
package does not provide background monitoring, external memory synchronization,
cookie import, remote browser pairing, package upgrade, dedicated PDF rendering,
or a bundled diagram renderer. For diagrams, use an available user-selected
diagram skill such as `archify` within its own scope.

## Results and evidence

Report in the user's language: `SUCCESS` for a checked completed result,
`FAIL` for an observed execution failure, `BLOCKED` for a missing prerequisite,
`WAITING_USER` for a required real answer, or `UNKNOWN` when completion cannot
be established. Include the useful evidence and any incomplete scope. These
workflow statuses are distinct from the start/end command's outcome values.

Availability checks, instruction loading, a minimal functional flow and native
Desktop acceptance are separate evidence levels. Keep synthetic test inputs
labelled; they cannot stand in for actual login, authorization or hook trust.
Never promote a skipped or blocked mandatory step to success. Retain the real
exit code before formatting command output so a successful formatter does not
hide a failed command.
