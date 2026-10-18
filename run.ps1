$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    $runtimePython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    if (-not (Test-Path -LiteralPath $runtimePython)) {
        $runtimePython = (Get-Command python -ErrorAction Stop).Source
    }
    & $runtimePython -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create Python environment.' }
}
& $taskPython (Join-Path $PSScriptRoot 'scripts/check_dependencies.py')
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing or restoring the pinned application dependencies...'
    & $taskPython -m pip install -r (Join-Path $PSScriptRoot 'requirements-lock.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install dependencies. Run Start.cmd again to retry.' }
    & $taskPython (Join-Path $PSScriptRoot 'scripts/check_dependencies.py')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency verification failed.' }
}
Write-Host 'Neryungri AI City: http://localhost:8765'
Write-Host 'Press Ctrl+C to stop.'
& $taskPython -m uvicorn app.main:app --host 127.0.0.1 --port 8765
if ($LASTEXITCODE -ne 0) { throw 'The server stopped with an error. Check the message above.' }
