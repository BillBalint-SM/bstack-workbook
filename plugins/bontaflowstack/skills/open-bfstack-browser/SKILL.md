---
name: open-bfstack-browser
description: Open the packaged BontaFlowStack browser visibly and check its connection. Use for a visible browsing session or manual sign-in before resuming work.
---

# Open BontaFlowStack browser

Read [HOST.md](../../HOST.md). Use the selected package's launcher and its
start/end protocol; availability, actual launch and native activation are
separate results. This opens the package's own browser profile.

1. Through launcher `run`, require both the executable and extension:
   `test -x "$BFSTACK_BROWSE/browse.exe" && test -f "$BFSTACK_ROOT/extension/manifest.json"`.
   A missing file is `BLOCKED`. Never build, download, install or switch packages.
2. Inspect the resolved `$BROWSE_STATE_FILE` through the launcher without running
   a browser command. A missing state file means no recorded session. If present,
   check its recorded process identity and loopback health without logging its
   token. Do not use `browse.exe status` for this preflight: it starts a headless
   daemon when none exists. Preserve an existing session; a busy profile or
   unsafe attachment is `BLOCKED`. Do not kill a process, clear a lock or reset
   a profile to make the check pass.
3. Start the workflow once, then run `"$BFSTACK_BROWSE/browse.exe" connect`
   as the first browser command, followed by `"$BFSTACK_BROWSE/browse.exe" status`.
   Check the actual headed connection,
   health and extension result. A live PID alone does not prove readiness.
4. If the request includes a page, follow [browse](../browse/SKILL.md) in this
   task with that URL and scope; consume its checked page result. Otherwise
   report the connection result. Do not claim that an untested page works.
5. For login, leave the visible session with the user and wait for the real
   sign-in. Continue with `resume` and inspect the resulting page. Never import
   cookies, copy personal profiles, type credentials or bypass a login wall.
6. Complete the workflow with its actual outcome. Report launch, health,
   visibility evidence and any unfinished human handoff separately.

Leave a user-requested session open. Close a disposable test session only through
its own stop API after checking its recorded identity; never by process name or
by terminating a process tree. Installed entry-skill selection remains a separate
native E2E check.
