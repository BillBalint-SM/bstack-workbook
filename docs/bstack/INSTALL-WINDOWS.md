# bstack telepítés GitHub-klónból — Windows x64 és Codex

Ez a fejlesztői forrásból helyben előállított csomag útja. A támogatott stabil
Codex-verzió csak a végső elfogadás után kerül ide. A
`0.1.0-beta.1` jelölés jelenleg jelöltet, nem kész kiadást jelent.

Előfeltétel: natív Windows x64, telepített Codex, Git, Bun, Git Bash, jq és
PowerShell. A böngészős skillekhez a browser runtime külön előfeltételei is
szükségesek. A parancsok PowerShellben futnak; a build Git Bash-t használ.

```powershell
git clone https://github.com/BillBalint-SM/bstack-workbook.git bstack
Set-Location bstack
bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
$env:BUN_CMD = (Get-Command bun -CommandType Application).Source.Replace('\','/')
$gitRoot = Split-Path (Split-Path (Get-Command git -CommandType Application).Source -Parent) -Parent
$gitBash = Join-Path $gitRoot 'bin\bash.exe'
if (-not (Test-Path -LiteralPath $gitBash)) { throw 'Git Bash not found' }
& $gitBash scripts/build.sh
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$releaseRoot = Join-Path $env:LOCALAPPDATA 'bstack\releases\0.1.0-beta.1'
bun scripts/package-bstack.ts (Join-Path $releaseRoot 'bstack')
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
```

A csomag a `$releaseRoot\bstack` mappában van, a helyi marketplace leírása
pedig `$releaseRoot\.agents\plugins\marketplace.json`. A csomag saját
`runtime` mappát és függőségeket tartalmaz; a futó plugin nem olvas a GitHubról
klónozott fejlesztői mappából. A `bstack.ps1 -Mode check` a helyi függőségeket
és a csomag épségét ellenőrzi.

```powershell
bun scripts/check-bstack-package.ts (Join-Path $releaseRoot 'bstack')
if ($LASTEXITCODE -ne 0) { throw 'Package check failed' }
codex plugin marketplace add $releaseRoot
codex plugin add bstack@bstack-local
```

A telepítés után új Codex-feladatban ellenőrizendő a `bstack` skillfelismerés,
a futtatás és a hook trust állapota. A Codex a plugin hookjait csak a natív
felületen történt ellenőrzés és bizalmi döntés után futtatja. A kiadási
elfogadás része egy ettől a fejlesztői klóntól független Windows-profilban
végzett GitHub-klón → build → plugin-telepítés → használat próba.

Eltávolításkor előbb a `codex plugin remove bstack@bstack-local` és a
`codex plugin marketplace remove bstack-local` művelet következik; a saját
állapottárat (`~/.bstack/state`) csak külön felhasználói döntéssel szabad
törölni.
