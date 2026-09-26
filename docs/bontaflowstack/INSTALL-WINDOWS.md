# Install BontaFlowStack on Windows

BontaFlowStack v0.1.4 is a prerelease for Windows x64 Codex Desktop. The owner accepted this release on 2026-09-26 using the verification described below.

## Verification and release decision

| Evidence | Result | Scope |
| --- | --- | --- |
| Release ZIP and installed files | PASS | Build `deb14b0fadc2424baeb0ad06511c73c6`; 14,163 installed files, with none missing or mismatched. |
| Native Codex Desktop smoke test | PASS | In Windows Sandbox, `bfstack` handed off to `bontaflow-memory`; a read-only lookup succeeded with zero lessons. |
| Parallel local agent cases | 4 PASS | `office-hours`: business, creator, and ambiguous-goal branches; `spec`: read local code before asking a question. Separate fixtures stayed unchanged. These were local agent tasks, not native Desktop E2E runs. |
| Reconstructed 0.1.4 Desktop campaign | 205/205 cases dispositioned; full E2E not accepted | 125 narrow-behavior PASS, 3 FAIL, 4 PARTIAL, 72 BLOCKED/NOT_RUN, 1 OUT. Results cover test chats and selected packaged helpers; native skill-catalog activation was not independently verified. This is a new inventory because the earlier authoritative scenario file is unavailable. |

The owner's v0.1.4 release decision remains the historical release decision. The later campaign does not establish full native Desktop E2E acceptance. PASS means only the stated small branch matched expectations, including expected wait or block behavior. The 72 blocked/not-run cases require their listed prerequisites or a safe, isolated test environment before they can count as passes. [Read the findings and limits](E2E-20260926.md).

## Install

1. Download `bontaflowstack-0.1.4-deb14b0fadc2424baeb0ad06511c73c6.zip` and its adjacent `.sha256` file from the [v0.1.4 release](https://github.com/BillBalint-SM/bontaflowstack-workbook/releases/tag/v0.1.4). The expected ZIP SHA-256 is `53c7ae4021990a3712e89465584c8f8244747b23e343530f3bbec8ffb3f20559`. The hash detects a damaged download when the expected value comes from a trusted channel; it is not a release signature.

   ```powershell
   (Get-FileHash -LiteralPath '.\bontaflowstack-0.1.4-deb14b0fadc2424baeb0ad06511c73c6.zip' -Algorithm SHA256).Hash
   ```

2. Extract the ZIP to a stable, writable directory. Keep the extracted root, `.agents/plugins/marketplace.json`, and `plugins/bontaflowstack/` together. The marketplace's `source.path` resolves to `./plugins/bontaflowstack` from that root. GitHub's "Code → Download ZIP" contains source files, not the full installation package.
3. Open the extracted root as a Codex Desktop project and restart Desktop. In **Plugins Directory**, find that project's marketplace, choose **BontaFlowStack**, and install it.
4. Start a new Codex task. Confirm that `$bontaflowstack:bfstack` is available. The plugin ID is `bontaflowstack`; the short router and helper name is `bfstack`.

## Review the hooks

Open **Settings → Hooks** and inspect the four BontaFlowStack hook entries: the general `PreToolUse` safety hook, the `PreToolUse` and `PostToolUse` question hooks, and the `Stop` lifecycle hook. Approve each hook in Codex's native interface if you want to use it. Plugin installation does not approve hooks, and a changed hook definition can require another review. If a required hook is absent or untrusted, the dependent workflow reports `BLOCKED`.

The safety hook can deny a recognized action and ask for explicit confirmation. It does not replace Codex permissions. The question hooks observe supported `request_user_input` events. A secret-marked question is skipped; a supported non-secret question may be stored with its text, options, and selected answer in a local log. Avoid sensitive answers in that workflow.

The `Stop` hook passes a trusted lifecycle event to the packaged runtime. It can record an `unknown` completion for a matching project and Codex task; it does not declare a run passed. Hook handler failures can be fail-open, so a returned handler result alone does not prove that an event was observed. The PowerShell execution-policy flag applies to the child process only. It does not change Windows policy or Codex hook trust.

## Local state and removal

BontaFlowStack stores local state under `%LOCALAPPDATA%\BontaFlowStack\state`. The package ignores inherited `BFSTACK_STATE_ROOT` and `BFSTACK_HOME` overrides from another installation.

Uninstall through Codex Desktop's plugin interface before removing the extracted folder. Local state is user data and is not removed automatically.
