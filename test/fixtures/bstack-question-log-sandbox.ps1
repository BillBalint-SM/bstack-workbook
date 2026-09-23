param([Parameter(Mandatory)][string]$StateRoot)
$ErrorActionPreference = 'Stop'
# Run inside an existing Codex sandbox with StateRoot writable. Never set up
# permissions here. Use a fresh isolated state root, not the live .gstack store.
if (-not [IO.Path]::IsPathRooted($StateRoot)) { throw 'Absolute isolated state root required' }
$env:GSTACK_HOME = $StateRoot
$env:GSTACK_STATE_ROOT = $StateRoot
$env:GSTACK_PROJECT_SLUG = 'question-log-regression'
$env:GSTACK_QUESTION_LOG_NO_DERIVE = '1'
$env:BSTACK_LOGGER = (Resolve-Path "$PSScriptRoot/../../bin/gstack-question-log").Path.Replace('\','/')
$bunDirectory = Split-Path (Get-Command bun -CommandType Application -ErrorAction Stop).Source
$env:PATH = $bunDirectory + ';' + $env:PATH
@'
set -e
export PATH="/usr/bin:/bin:$PATH"
"$BSTACK_LOGGER" '{"skill":"review","question_id":"review-sandbox-regression","question_summary":"Synthetic sandbox test","category":"clarification","options_count":2,"user_choice":"fixture","session_id":"synthetic-test","tool_use_id":"synthetic-sandbox-regression"}'
'@ | & 'C:/Program Files/Git/bin/bash.exe' --noprofile --norc -s
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$records = @(Get-Content -LiteralPath "$StateRoot/projects/question-log-regression/question-log.jsonl" | ConvertFrom-Json | Where-Object tool_use_id -eq 'synthetic-sandbox-regression')
if ($records.Count -ne 1 -or $records[0].user_choice -ne 'fixture') { throw 'Expected one synthetic record (also on rerun)' }
Write-Output 'PASS: sandbox question logger and dedup'
