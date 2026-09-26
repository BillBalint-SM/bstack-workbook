[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$InstallBrowser
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $repo 'runtime'
$source = Join-Path $repo 'plugins\bontaflowstack\runtime'
$bundledBun = Join-Path $source 'tools\bun.exe'
$bun = if (Test-Path -LiteralPath $bundledBun -PathType Leaf) { $bundledBun } else { 'bun' }
$env:NODE_PATH = Join-Path $runtime 'node_modules'

function Invoke-Bun([string[]]$Arguments) {
    & $bun @Arguments
    if ($LASTEXITCODE -ne 0) { throw "bun failed ($LASTEXITCODE): $($Arguments -join ' ')" }
}

if ($Install) {
    Push-Location $runtime
    try { Invoke-Bun @('install', '--ignore-scripts', '--frozen-lockfile') }
    finally { Pop-Location }
}

if ($InstallBrowser) {
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $source 'browse\.playwright-browsers'
    Push-Location $runtime
    try { Invoke-Bun @('x', 'playwright', 'install', 'chromium') }
    finally { Pop-Location }
}

foreach ($path in @(
    (Join-Path $source 'browse\dist'),
    (Join-Path $source 'design\dist')
)) {
    [IO.Directory]::CreateDirectory($path) | Out-Null
}

# design-html inlines this resource as a classic script and reads window.Pretext.
# Build the pinned official ESM release into that exact, self-contained browser
# contract; do not ship a relative-import module graph or use a CDN at runtime.
$pretextEntry = Join-Path $runtime 'pretext-browser-entry.js'
$pretextOutput = Join-Path $source 'design-html\vendor\pretext.js'
if (-not (Test-Path -LiteralPath $pretextEntry -PathType Leaf)) { throw "Required Pretext source is missing: $pretextEntry" }
Invoke-Bun @('build', $pretextEntry, '--target=browser', '--format=iife', '--outfile', $pretextOutput)

Invoke-Bun @('build', '--compile', (Join-Path $source 'browse\src\cli.ts'), '--outfile', (Join-Path $source 'browse\dist\browse.exe'))
Invoke-Bun @('build', '--compile', (Join-Path $source 'browse\src\find-browse.ts'), '--outfile', (Join-Path $source 'browse\dist\find-browse.exe'))
Invoke-Bun @('build', '--compile', (Join-Path $source 'design\src\cli.ts'), '--outfile', (Join-Path $source 'design\dist\design.exe'))

# Reuse the maintained Windows Node-server build strategy: Bun bundles the
# server with the same runtime externals, then the generated file receives the
# compatible Bun API shim. All outputs are regenerated under bfstack paths.
$server = Join-Path $source 'browse\dist\server-node.mjs'
Invoke-Bun @('build', (Join-Path $source 'browse\src\server.ts'), '--target=node', '--outfile', $server, '--external', 'playwright', '--external', 'playwright-core', '--external', 'diff', '--external', 'sharp', '--external', '@huggingface/transformers')
$serverText = [IO.File]::ReadAllText($server)
$serverText = $serverText.Replace('import.meta.dir', '__browseNodeSrcDir')
$header = @'
import { fileURLToPath as _ftp } from "node:url";
import { dirname as _dn } from "node:path";
import { createRequire as _createBrowseRequire } from "node:module";
const __browseNodeSrcDir = _dn(_dn(_ftp(import.meta.url))) + "/src";
const __browseRequire = _createBrowseRequire(import.meta.url);
__browseRequire("./bun-polyfill.cjs");
'@
$firstBreak = $serverText.IndexOf("`n")
if ($firstBreak -lt 0) { throw 'Generated browser server has no import header.' }
[IO.File]::WriteAllText($server, $serverText.Insert($firstBreak + 1, $header), [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $source 'browse\src\bun-polyfill.cjs') -Destination (Join-Path $source 'browse\dist\bun-polyfill.cjs') -Force

Write-Output 'bfstack renderer build completed; native acceptance remains NOT_RUN.'
