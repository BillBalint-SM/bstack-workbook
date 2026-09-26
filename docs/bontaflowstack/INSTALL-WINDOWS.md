# BontaFlowStack installation on Windows

**Status:** development candidate. The P3 minimum native probes passed, but
`nativeAcceptance` for the release and all full workflows remains `NOT_RUN`.

The adjacent `.sha256` file detects ZIP corruption when its value comes from a
trusted download channel. It is not a release signature.

1. Download and extract the BontaFlowStack ZIP to a stable user-writable folder. Keep
   the extracted root, `.agents/plugins/marketplace.json`, and
   `plugins/bontaflowstack/` together. The marketplace's `source.path` is relative to
   that root and resolves to `./plugins/bontaflowstack`.
2. Open the extracted root as a Codex Desktop project and restart Codex Desktop.
   In **Plugins Directory**, find the marketplace from that project, then choose
   **BontaFlowStack** and install it. Codex keeps the installed plugin cache separate
   from this extracted source.
3. Start a new Codex task and confirm that the plugin and its `bfstack` entry
   skill are discoverable. In the BontaFlowStack package, use
   `$bontaflowstack:bfstack`. The entry skill, helper names, and
   `open-bfstack-browser` use the short name `bfstack`.
4. Open **Settings → Hooks**, inspect every listed BontaFlowStack hook, and make the
   trust decision in the native UI: the general `PreToolUse` safety hook, the
   `PreToolUse` question hook, the `PostToolUse` question hook, and `Stop`
   lifecycle hook. This location was confirmed in Desktop `26.917.8451.0`; the
   first task did not show an automatic trust prompt. Installing the plugin
   alone does not trust a hook, and changed definitions can require review
   again. A missing hook or trust refusal is `BLOCKED`. Do not edit trust
   records or bypass the native decision.

The general `PreToolUse` hook calls the packaged scoped-safety handler. It can
deny an identified action and require a matching explicit confirmation, but it
does not override Codex permissions and is not yet evidence of full safety
enforcement. The question hooks handle `request_user_input`: `PreToolUse`
performs advisory preference handling and `PostToolUse` records a completed
question event. A secret-marked question is skipped. For a supported,
non-secret question the current reused runtime may store the question text,
options and selected answer in its local question log; do not use it for secret
or sensitive answers.

The `Stop` hook sends the trusted lifecycle event to the packaged runtime. A
matching project and actual Codex task may receive an `unknown` completion; the
hook never declares `passed`. Hook failures in lifecycle or questions mode are
fail-open handler results, not evidence that the intended observation or
enforcement occurred. The PowerShell execution-policy flag applies only to the
hook child process and does not modify Windows policy or bypass Codex trust.

BontaFlowStack stores its local state under `%LOCALAPPDATA%\BontaFlowStack\state`. It ignores inherited `BFSTACK_STATE_ROOT` and `BFSTACK_HOME` overrides from another installation.

To remove BontaFlowStack, use Codex Desktop's native plugin UI. Keep the extracted
folder until removal is complete. Any separate BontaFlowStack state location is user
data and is not removed by this package runbook.

This runbook follows the documented marketplace discovery model, but does not
establish release acceptance. P3 historically recorded install, discovery,
explicit Stop-hook trust, a native question UI and removal in a clean Windows
x64 environment. That evidence applies to the earlier minimal probe only. The
new candidate's native hook, question capture, lifecycle, full workflow and
external-scenario acceptance remain `NOT_RUN`.
