param(
    [Parameter(Mandatory = $true)]
    [string]$PackagePath,
    [string]$ExtractionPath,
    [switch]$KeepExtraction
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $repo '.tmp'))
function Assert-ChildPath([string]$Path, [string]$Parent, [string]$Label) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) { throw "$Label must be inside $Parent" }
    $fullPath
}
function Assert-SafeRoot([string]$Path, [string]$Label) {
    $current = [IO.Path]::GetFullPath($Path)
    while (-not (Test-Path -LiteralPath $current)) { $current = [IO.Directory]::GetParent($current).FullName }
    while ($true) {
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Label uses a reparse-point ancestor: $current" }
        if ($current -eq $repo) { return }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { throw "$Label escapes the repository: $Path" }
        $current = $parent.FullName
    }
}
if (-not [IO.Path]::IsPathRooted($PackagePath)) { $PackagePath = Join-Path $repo $PackagePath }
$package = [IO.Path]::GetFullPath($PackagePath)
if (-not (Test-Path -LiteralPath $package -PathType Leaf) -or [IO.Path]::GetExtension($package) -ne '.zip') { throw 'PackagePath must name an existing ZIP file' }
if (-not $ExtractionPath) { $ExtractionPath = Join-Path $temporaryRoot ("package-check-" + [guid]::NewGuid().ToString('N')) }
elseif (-not [IO.Path]::IsPathRooted($ExtractionPath)) { $ExtractionPath = Join-Path $repo $ExtractionPath }
$destination = Assert-ChildPath $ExtractionPath $temporaryRoot 'ExtractionPath'
if (Test-Path -LiteralPath $destination) { throw "Refusing to overwrite existing extraction: $destination" }
Assert-SafeRoot $temporaryRoot 'Temporary root'
Assert-SafeRoot $destination 'Extraction path'

function Assert-ArchiveEntry([string]$Name, [hashtable]$Seen) {
    $normalized = $Name.Replace('/', '\')
    $isDirectory = $normalized.EndsWith('\')
    $normalized = $normalized.TrimEnd('\')
    if (-not $normalized -or [IO.Path]::IsPathRooted($normalized) -or $normalized -match ':') { throw "Unsafe ZIP entry: $Name" }
    foreach ($segment in $normalized.Split('\')) {
        if (-not $segment -or $segment -eq '.' -or $segment -eq '..' -or $segment.EndsWith('.') -or $segment.EndsWith(' ') -or $segment -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$') { throw "Unsafe ZIP entry: $Name" }
    }
    $canonical = $normalized.ToLowerInvariant()
    if ($Seen.ContainsKey($canonical)) { throw "Duplicate ZIP entry: $Name" }
    $Seen[$canonical] = $true
}

$startedExtraction = $false
try {
    $archive = [IO.Compression.ZipFile]::OpenRead($package)
    try {
        $seenEntries = @{}
        foreach ($entry in $archive.Entries) {
            Assert-ArchiveEntry $entry.FullName $seenEntries
        }
    } finally { $archive.Dispose() }
    $sidecar = "$package.sha256"
    if (Test-Path -LiteralPath $sidecar -PathType Leaf) {
        $line = (Get-Content -LiteralPath $sidecar -Raw).Trim()
        if ($line -notmatch '^([0-9a-fA-F]{64})  .+$' -or $matches[1].ToLowerInvariant() -ne (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Package checksum mismatch' }
    }
    $startedExtraction = $true
    [IO.Compression.ZipFile]::ExtractToDirectory($package, $destination)
    $manifestPath = Join-Path $destination 'package-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'package-manifest.json is missing' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.name -cne 'bontaflowstack' -or $manifest.nativeAcceptance -ne 'NOT_RUN') { throw 'Invalid package manifest' }
    $identity = [string]$manifest.name
    $pluginRelativePath = "plugins/$identity"
    $guideRelativePath = "docs/$identity"
    $expectedPluginDisplayName = 'BontaFlowStack'
    $expectedMarketplaceDisplayName = 'BontaFlowStack'
    $expected = @{}
    foreach ($file in @($manifest.files)) {
        if ($file.path -notmatch '^[^/\\]+(/[^/\\]+)*$') { throw "Unsafe manifest path: $($file.path)" }
        foreach ($segment in $file.path.Split('/')) {
            if ($segment -eq '.' -or $segment -eq '..' -or $segment.EndsWith('.') -or $segment.EndsWith(' ') -or $segment -match ':' ) { throw "Unsafe manifest path: $($file.path)" }
        }
        if ($expected.ContainsKey($file.path)) { throw "Duplicate manifest path: $($file.path)" }
        $expected[$file.path] = $file
        $actual = Join-Path $destination ($file.path.Replace('/', '\'))
        $actual = Assert-ChildPath $actual $destination 'Manifest path'
        if (-not (Test-Path -LiteralPath $actual -PathType Leaf)) { throw "Missing package file: $($file.path)" }
        $hash = (Get-FileHash -LiteralPath $actual -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ne $file.sha256 -or (Get-Item -LiteralPath $actual).Length -ne $file.bytes) { throw "Hash mismatch: $($file.path)" }
    }
    $actualFiles = @(Get-ChildItem -LiteralPath $destination -File -Recurse -Force | ForEach-Object { $_.FullName.Substring($destination.Length).TrimStart('\').Replace('\', '/') } | Where-Object { $_ -ne 'package-manifest.json' })
    if ($actualFiles.Count -ne $expected.Count -or @($actualFiles | Where-Object { -not $expected.ContainsKey($_) }).Count -ne 0) { throw 'Package contains unmanifested files' }
    $pluginManifestPath = Join-Path $destination "$pluginRelativePath/.codex-plugin/plugin.json"
    $marketplacePath = Join-Path $destination '.agents\plugins\marketplace.json'
    $guidePath = Join-Path $destination "$guideRelativePath/INSTALL-WINDOWS.md"
    if (-not (Test-Path -LiteralPath $pluginManifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $marketplacePath -PathType Leaf) -or -not (Test-Path -LiteralPath $guidePath -PathType Leaf)) { throw "Required $identity installation files are missing" }
    $plugin = Get-Content -LiteralPath $pluginManifestPath -Raw | ConvertFrom-Json
    if ($plugin.name -cne $identity -or $plugin.interface.displayName -cne $expectedPluginDisplayName) { throw 'Plugin identity does not match package manifest' }
    $marketplace = Get-Content -LiteralPath $marketplacePath -Raw | ConvertFrom-Json
    if ($marketplace.name -cne $identity -or $marketplace.interface.displayName -cne $expectedMarketplaceDisplayName -or @($marketplace.plugins).Count -ne 1 -or
        $marketplace.plugins[0].name -cne $identity -or $marketplace.plugins[0].source.source -cne 'local' -or $marketplace.plugins[0].source.path -cne "./$pluginRelativePath") {
        throw 'Marketplace identity does not match package manifest'
    }
    Write-Output "$identity package check PASS: $package"
} finally {
    if ($startedExtraction -and -not $KeepExtraction -and (Test-Path -LiteralPath $destination)) {
        Assert-ChildPath $destination $temporaryRoot 'Extraction cleanup' | Out-Null
        Assert-SafeRoot $destination 'Extraction cleanup'
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
}
