# BontaFlowStack

BontaFlowStack is a Codex Desktop plugin for Windows x64. The plugin identity is
`bontaflowstack`; its short command and router name is `bfstack`.

## Install

Download the complete `bontaflowstack-0.1.4-*.zip` from the
[v0.1.4 release](https://github.com/BillBalint-SM/bontaflowstack-workbook/releases/tag/v0.1.4).
Its SHA-256 is
`53c7ae4021990a3712e89465584c8f8244747b23e343530f3bbec8ffb3f20559`.
Follow the [Windows installation guide](docs/bontaflowstack/INSTALL-WINDOWS.md).

The ZIP is the installable plugin. This repository contains its first-party
source, 40 skill definitions, marketplace metadata and attribution. Generated
binaries, Chromium, bundled tools and installed dependencies are kept in the
release ZIP because they are required by the installed package and are too
large for the source tree. Do not install this checkout as a plugin.

The source dependency versions are pinned in `runtime/bun.lock`. On Windows,
`scripts/build-renderers.ps1 -Install -InstallBrowser` builds the renderer
outputs from the checked-in sources with Bun. This is a development command;
the published ZIP is the verified installation unit.

## Verification status

The v0.1.4 ZIP passed the package integrity check. The full native Codex
Desktop acceptance campaign for this build has **not run**. A valid package
does not establish that every workflow is accepted.

Source and license information is in [references](docs/references.md) and
[`plugins/bontaflowstack/licenses`](plugins/bontaflowstack/licenses).
