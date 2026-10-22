# Démarre l'agent caméra sur le PC Hôte (Windows).
# Le jeton CAMERA_AGENT_TOKEN et l'index CAMERA_INDEX sont lus dans le .env
# à la racine du projet : un seul endroit pour les secrets.
#
#   powershell -ExecutionPolicy Bypass -File camera-agent\start-agent.ps1
#   powershell -ExecutionPolicy Bypass -File camera-agent\start-agent.ps1 -List

param([switch]$List)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$envFile = Join-Path (Split-Path $here -Parent) '.env'
$venv = Join-Path $here '.venv'

if (-not (Test-Path $venv)) {
    Write-Host 'Création de l''environnement Python...'
    python -m venv $venv
    & "$venv\Scripts\pip.exe" install --quiet -r (Join-Path $here 'requirements.txt')
}

if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*(CAMERA_AGENT_TOKEN|CAMERA_INDEX|CAMERA_AGENT_PORT)\s*=\s*(.*?)\s*$') {
            Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
        }
    }
}

$agentArgs = @((Join-Path $here 'agent.py'))
if ($List) { $agentArgs += '--list' }

& "$venv\Scripts\python.exe" @agentArgs
