---
name: document-generate
description: Write missing project or module documentation from verified code, interfaces and runnable examples.
---

# Generate documentation

Read [HOST.md](../../HOST.md). Scope comes from the request or a concrete gap
passed by document-release; do not turn one missing reference into a full site.

1. Inspect relevant source entry points, definitions/callers, tests, package
   commands, configuration and existing documentation. Reuse existing layout
   and language. Missing information stays explicit; never invent behavior.
2. Select the smallest appropriate output: a reference for exact interfaces,
   an explanation for decisions/trade-offs, a how-to for a task, or a tutorial
   for learning through a first result. These four capabilities remain available;
   a small request does not require four documents or repeated confirmation.
3. Start the HOST lifecycle before authorized writes. Preserve existing content
   and unrelated edits. Use exact types, defaults, examples, prerequisites,
   failure behavior and limitations from inspected sources.
4. Run the relevant safe example or existing check. Mark examples requiring
   unavailable credentials/services as untested. No automatic dependency install,
   network call, account setup or environment change to make a sample work.
5. Connect the output to an existing entry point when in scope; verify local
   links and referenced symbols/commands. Do not insert broad boilerplate,
   duplicate the README or create empty documentation sections.
6. Read back the final files and compare them with code and actual output.
   Return paths, scope, checked examples and remaining uncertainty; close the
   lifecycle. A request to draft without writing produces only the response.
   Committing, publishing or creating a PR are separate requested operations.