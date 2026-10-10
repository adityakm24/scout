# Source this file to sync and apply the PM environment; deactivate restores it.
# Trusts the recorded tool digest. `scout pm install` re-checks the bytes.
# -TestExtras a,b selects runtime extras in the test environment (default: [all]).
param([string]$TestExtras = '')
$ErrorActionPreference = 'Stop'

$OutputEncoding = [System.Console]::OutputEncoding = [System.Console]::InputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

$repo = $PSScriptRoot
$bootstrapSaved = @{}
foreach ($key in @('PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV')) {
    $bootstrapSaved[$key] = [Environment]::GetEnvironmentVariable($key)
    Remove-Item "env:$key" -ErrorAction SilentlyContinue
}
try {
    # Run separately so setup's exit/failure cannot terminate the sourced shell.
    $shell = (Get-Process -Id $PID).Path
    $testArgs = @()
    if ($TestExtras) { $testArgs = @('-TestExtras', $TestExtras) }
    & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$repo\setup-scout.ps1" -RuntimeOnly @testArgs | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'activate: setup failed; shell environment unchanged' }
} finally {
    foreach ($key in $bootstrapSaved.Keys) {
        if ($null -eq $bootstrapSaved[$key]) { Remove-Item "env:$key" -ErrorAction SilentlyContinue }
        else { Set-Item "env:$key" $bootstrapSaved[$key] }
    }
}
if (Test-Path function:deactivate) { deactivate }
$py = $null
foreach ($candidate in @("$repo\.venv\Scripts\python.exe", "$repo\venv\Scripts\python.exe")) {
    if (Test-Path -LiteralPath $candidate) { $py = $candidate; break }
}
if (-not $py) {
    $roots = @($env:SCOUT_RUNTIME_DIR, "$repo\..\tools")
    $homeRoot = if ($env:SCOUT_HOME) { $env:SCOUT_HOME } else { "$env:LOCALAPPDATA\scout" }
    $roots += (Join-Path $homeRoot 'tools')
    foreach ($root in $roots) {
        if (-not $root) { continue }
        foreach ($entry in @(Get-ChildItem -LiteralPath $root -Directory -Filter 'python-*' -ErrorAction SilentlyContinue)) {
            $candidate = Join-Path $entry.FullName 'python.exe'
            if (Test-Path -LiteralPath $candidate) { $py = $candidate; break }
        }
        if ($py) { break }
    }
}
if (-not $py) { throw 'activate: no bootstrap Python found; run setup-scout.ps1' }
$priorPath = $env:PYTHONPATH
$priorHome = $env:PYTHONHOME
try {
    $env:PYTHONPATH = $repo
    Remove-Item env:PYTHONHOME -ErrorAction SilentlyContinue
    $json = (& $py -m pm.environments) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'activate: could not read the installed environment' }
    $composed = $json | ConvertFrom-Json
} finally {
    if ($null -eq $priorPath) { Remove-Item env:PYTHONPATH -ErrorAction SilentlyContinue } else { $env:PYTHONPATH = $priorPath }
    if ($null -eq $priorHome) { Remove-Item env:PYTHONHOME -ErrorAction SilentlyContinue } else { $env:PYTHONHOME = $priorHome }
}
# __SCOUT_ACTIVATED (the sentinel repo scripts and the shebang prologue read)
# is part of the composed env, so it is saved and restored with the rest.
$global:_scoutKeys = @($composed.PSObject.Properties.Name)
$global:_scoutSaved = @{}
foreach ($key in $global:_scoutKeys) {
    $global:_scoutSaved[$key] = [pscustomobject]@{
        WasSet = (Test-Path "env:$key")
        Value = [Environment]::GetEnvironmentVariable($key)
    }
}
foreach ($property in $composed.PSObject.Properties) {
    Set-Item -Path "env:$($property.Name)" -Value ([string]$property.Value)
}
# This checkout, not whichever `scout` PATH finds. A function beats PATH,
# an alias, and the MSIX execution alias. It runs only while the shell is
# inside this worktree.
$global:_scoutWorktree = $repo
# The branch names the worktree. A checkout cannot share a branch with another.
# git's "not a repository" is not an activation failure: the directory name is
# the label, and the command still refuses outside this tree.
$branch = $null
try { $branch = & git -C $repo rev-parse --abbrev-ref HEAD 2>$null } catch { $branch = $null }
if ($branch -and $branch -ne 'HEAD') {
    $global:_scoutWorktreeName = $branch
} else {
    $global:_scoutWorktreeName = Split-Path -Leaf $repo
}
if (Test-Path function:prompt) {
    $global:_scoutSavedPrompt = (Get-Item function:prompt).ScriptBlock
} else {
    $global:_scoutSavedPrompt = $null
}

function global:_scoutWorktreeHere {
    # Prompt calls this after every command. Keep the user's exit code.
    $saved = $global:LASTEXITCODE
    $top = $null
    try { $top = & git rev-parse --show-toplevel 2>$null } catch { $top = $null }
    $global:LASTEXITCODE = $saved
    if (-not $top) { return $false }
    $here = [System.IO.Path]::GetFullPath($top).TrimEnd('\')
    $root = [System.IO.Path]::GetFullPath($global:_scoutWorktree).TrimEnd('\')
    return $here.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)
}

function global:scout {
    if (-not (_scoutWorktreeHere)) {
        $here = (Get-Location).Path
        Write-Error "scout: $here is outside $($global:_scoutWorktree); refusing (the installed command is hidden while this checkout is active)" -ErrorAction Continue
        $global:LASTEXITCODE = 1
        return
    }
    Push-Location -LiteralPath $global:_scoutWorktree
    try {
        $py = $env:PYTHON
        if (-not $py) {
            foreach ($candidate in @(
                '.venv\Scripts\python.exe', 'venv\Scripts\python.exe',
                '.venv\bin\python', 'venv\bin\python'
            )) {
                if (Test-Path -LiteralPath $candidate) { $py = $candidate; break }
            }
        }
        if (-not $py) { $py = 'python' }
        & $py scout @args
    } finally {
        Pop-Location
    }
}

function global:prompt {
    $prefix = ''
    if (_scoutWorktreeHere) { $prefix = "($($global:_scoutWorktreeName)) " }
    if ($global:_scoutSavedPrompt) {
        return $prefix + (& $global:_scoutSavedPrompt)
    }
    return "$prefix$($(Get-Location).Path)> "
}

function global:deactivate {
    foreach ($key in $global:_scoutKeys) {
        $saved = $global:_scoutSaved[$key]
        if ($saved.WasSet) { Set-Item -Path "env:$key" -Value $saved.Value }
        else { Remove-Item -Path "env:$key" -ErrorAction SilentlyContinue }
    }
    if ($global:_scoutSavedPrompt) {
        Set-Item -Path function:prompt -Value $global:_scoutSavedPrompt
    } else {
        Remove-Item function:prompt -ErrorAction SilentlyContinue
    }
    $global:_scoutKeys = $null
    $global:_scoutSaved = $null
    $global:_scoutWorktree = $null
    $global:_scoutWorktreeName = $null
    $global:_scoutSavedPrompt = $null
    Remove-Item function:deactivate, function:scout, function:_scoutWorktreeHere -ErrorAction SilentlyContinue
}
