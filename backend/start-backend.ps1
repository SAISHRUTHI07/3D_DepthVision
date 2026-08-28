$backend = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'

if (-not (Test-Path $python)) {
  $python = (Get-Command python -ErrorAction Stop).Source
}

# This venv's Windows launcher is not usable on some machines. Use the
# installed interpreter with the venv's site packages, which keeps all project
# dependencies isolated without relying on the broken launcher executable.
$env:PYTHONPATH = Join-Path $backend '.venv\Lib\site-packages'
& $python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
