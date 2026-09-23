# bstack

bstack is a Windows x64 skill package for Codex. It adapts the engineering
workflows of [gstack](https://github.com/garrytan/gstack) into an installable
Codex plugin with its own runtime, state directory and local marketplace.
The upstream project remains credited under its MIT license in [LICENSE](LICENSE).

**Status:** `0.1.0-beta.1` is a local release candidate. It is not yet a
published or fully accepted release. The supported stable Codex version will
be named after a native, clean-install test. macOS, Linux, iOS and other agent
hosts are outside this product's scope.

## Build on Windows

Install Git, Bun, Git Bash, jq, PowerShell and Codex, then follow the
[Windows installation guide](docs/bstack/INSTALL-WINDOWS.md). It covers the
GitHub clone, build, package check and Codex installation. The built plugin
contains its own runtime and stores user data under `~/.bstack/state` by
default. Installing the source `plugin/bstack` directory directly is
unsupported; use the generated package.

## Scope and evidence

The build currently exports 46 Windows/Codex skill entrypoints. They are
release candidates until the advertised workflows and their required branches
have been exercised from the installed package. A successful build or package
check alone does not establish workflow parity.
