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

Install Git, Bun, Git Bash, jq, PowerShell and Codex. In a fresh checkout,
run these commands in PowerShell:

```powershell
bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
$env:BUN_CMD = (Get-Command bun -CommandType Application).Source.Replace('\','/')
$gitRoot = Split-Path (Split-Path (Get-Command git -CommandType Application).Source -Parent) -Parent
$gitBash = Join-Path $gitRoot 'bin\bash.exe'
& $gitBash scripts/build.sh
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$releaseRoot = Join-Path $env:LOCALAPPDATA 'bstack\releases\0.1.0-beta.1'
bun scripts/package-bstack.ts (Join-Path $releaseRoot 'bstack')
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
bun scripts/check-bstack-package.ts (Join-Path $releaseRoot 'bstack')
```

The output is a local Codex plugin at `$releaseRoot\bstack`, with a
marketplace catalog at `$releaseRoot\.agents\plugins\marketplace.json`.
The bundled plugin uses its own `runtime` folder. Moving or editing the
source checkout does not change that installed runtime. The default data
location is `~/.bstack/state`.

The detailed [Windows installation guide](docs/bstack/INSTALL-WINDOWS.md)
covers local marketplace registration, Codex hook trust, removal and the
planned clean GitHub clone acceptance test. Installing the source
`plugin/bstack` directory directly is unsupported; use the generated package.

## Scope and evidence

The build currently exports 46 Windows/Codex skill entrypoints. They are
release candidates until the advertised workflows and their required branches
have been exercised from the installed package. A successful build or package
check alone does not establish workflow parity.
