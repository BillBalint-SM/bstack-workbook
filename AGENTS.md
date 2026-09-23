# bstack source repository

Projektalapozás: kész. A karbantartott forrás a gyökérben lévő skillmodulokban,
`scripts/`, `bin/`, `browse/`, `design/`, `make-pdf/`, `lib/` és `plugin/bstack/`
alatt található; a használati leírás a `README.md` és `docs/bstack/INSTALL-WINDOWS.md`.

bstack is a shareable Codex plugin for native Windows x64. Work on this
target only. Other agent hosts, operating systems and mobile platforms are
outside the product scope. The gstack source history is an implementation
starting point, not a runtime dependency or a set of release promises.

## Build and package

The checked-in `plugin/bstack` directory is a build input and has no plugin
manifest. Never install it directly. Use the PowerShell commands in
`docs/bstack/INSTALL-WINDOWS.md` to generate the Codex skills and wrappers,
then package the runtime into a separate versioned directory.

The `SKILL.md` renders under `.agents/skills` are generated from `.tmpl`
files. Edit the template or resolver, then run `bun run gen:skill-docs --host
codex`; do not edit generated skills by hand. `scripts/build.sh` builds only
the Codex renders and Windows binaries. The package contains its own runtime,
dependencies, marketplace catalog and content manifest. It stores user data
under `~/.bstack/state` by default.

## Change discipline

Preserve unrelated working-tree content. Run targeted checks for changed
behavior while implementing. The final acceptance is a clean GitHub clone,
package build, Codex install and real workflow use in an isolated Windows
environment. A package build is not proof that every workflow succeeds.
Do not push, publish, activate a plugin globally or claim native hook trust
without the corresponding user decision and observed host evidence.
