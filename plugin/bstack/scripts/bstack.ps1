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
    if ($Mode -eq 'hook') {
        $hookInput = $scriptParts -join "`n"
        if ([string]::IsNullOrWhiteSpace($hookInput) -and [Console]::IsInputRedirected) {
            $hookInput = [Console]::In.ReadToEnd()
        }
        try {
            $eventData = $hookInput | ConvertFrom-Json
            $session = [string]$eventData.session_id
            if ($eventData.hook_event_name -eq 'PreToolUse' -and
                [System.IO.Path]::IsPathRooted([string]$eventData.cwd) -and
                $session -match '^[a-zA-Z0-9_-]{1,128}$') {
                if ($env:GSTACK_STATE_ROOT -or $env:GSTACK_HOME) { throw 'Custom state uses full safety path' }
                $profile = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
                $stateRoot = Join-Path $profile '.bstack/state'
                $stateFile = Join-Path $stateRoot "bstack/sessions/$session.json"
                if (-not (Test-Path -LiteralPath $stateFile)) { [Console]::Out.WriteLine('{}'); exit 0 }
                $state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
                if ($state.careful -eq $false -and -not $state.freeze) { [Console]::Out.WriteLine('{}'); exit 0 }
            }
        } catch { } # Unknown input or state is handled by the full safety path.
    }
    # RELEASE_BINDING: populated only in the sealed copy, before config is read.
    $configPath = Join-Path $PSScriptRoot '../runtime.json'
    $runtimeConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $runtime = [string]$runtimeConfig.runtime
    if (-not [System.IO.Path]::IsPathRooted($runtime)) {
        $runtime = Join-Path (Split-Path $configPath -Parent) $runtime
    }
    if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) { throw "bstack runtime missing: $runtime" }
    $bun = (Get-Command bun -CommandType Application -ErrorAction Stop).Source
    if ($runtimeConfig.PSObject.Properties.Name -contains 'integritySha256') {
        & $bun (Join-Path $PSScriptRoot 'verify-runtime.ts') $configPath $Mode
        if ($LASTEXITCODE -ne 0) { throw 'Release integrity check failed' }
    }
    if ($Mode -in @('run', 'hook', 'lifecycle', 'questions')) {
        # Pipeline input is text, never shell-interpolated command arguments.
        $scriptText = if ($Mode -eq 'hook') { $hookInput } else { $scriptParts -join "`n" }
        if ([string]::IsNullOrWhiteSpace($scriptText) -and [Console]::IsInputRedirected) {
            $scriptText = [Console]::In.ReadToEnd()
        }
        if ([string]::IsNullOrWhiteSpace($scriptText)) { throw 'run requires a Bash script on stdin' }
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
    [Console]::Error.WriteLine("bstack: $($_.Exception.Message)")
    if ($Mode -eq 'hook') { exit 2 } elseif ($Mode -in @('lifecycle', 'questions')) { exit 0 } else { exit 1 }
}
}
