[CmdletBinding()]
param(
    [ValidateSet('check', 'read', 'run', 'hook', 'safety', 'lifecycle', 'questions')][string]$Mode = 'check',
    [string]$Skill,
    [string]$Action,
    [string]$Value,
    [Parameter(ValueFromPipeline = $true)][string]$BashScript
)
begin { $scriptParts = [System.Collections.Generic.List[string]]::new() }
process { if ($null -ne $BashScript) { $scriptParts.Add($BashScript) } }
end {
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $OutputEncoding
[Console]::OutputEncoding = $OutputEncoding
try {
    $configPath = Join-Path $PSScriptRoot '../runtime.json'
    $runtimeConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $pluginRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if ([IO.Path]::IsPathRooted($runtimeConfig.runtime)) { throw 'Runtime must be package-relative' }
    $runtime = [IO.Path]::GetFullPath((Join-Path $pluginRoot $runtimeConfig.runtime))
    if (-not $runtime.StartsWith($pluginRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime escapes the plugin' }
    if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) { throw "bfstack runtime missing: $runtime" }
    $bun = Join-Path $pluginRoot 'runtime\tools\bun.exe'
    if (-not (Test-Path -LiteralPath $bun -PathType Leaf)) {
        if ($env:BFSTACK_DEV_TOOLS -ne '1') { throw 'Bundled Bun is missing' }
        $bun = (Get-Command bun -CommandType Application -ErrorAction Stop).Source
    }
    if ($Mode -in @('run', 'hook', 'lifecycle', 'questions')) {
        # Pipeline input is text, never shell-interpolated command arguments.
        $scriptText = $scriptParts -join "`n"
        if ([string]::IsNullOrWhiteSpace($scriptText) -and [Console]::IsInputRedirected) {
            $scriptText = [Console]::In.ReadToEnd()
        }
        if ([string]::IsNullOrWhiteSpace($scriptText)) { throw 'run requires a Bash script on stdin' }
        $scriptText = $scriptText.TrimStart([char]0xFEFF)
        $scriptText | & $bun $runtime $Mode
    } elseif ($Mode -eq 'safety') {
        & $bun $runtime safety $Action $Value
    } elseif ($Mode -eq 'read') {
        & $bun $runtime read $Skill
    } else {
        & $bun $runtime check
    }
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("bfstack: $($_.Exception.Message)")
    if ($Mode -in @('hook', 'safety')) { exit 2 } elseif ($Mode -in @('lifecycle', 'questions')) { exit 0 } else { exit 1 }
}
}
