param([Parameter(Mandatory)][ValidateSet('on','off','status')][string]$State)
# Bascule manuelle de la limite de debit du WAF (le moteur de remediation fait la meme chose).
$active = Join-Path $PSScriptRoot 'state\active.conf'
switch ($State) {
  'on'  { Copy-Item (Join-Path $PSScriptRoot 'limits.on.conf') $active -Force }
  'off' { Remove-Item $active -ErrorAction SilentlyContinue }
}
if ($State -ne 'status') { docker kill -s HUP resilience-waf | Out-Null; Start-Sleep -Seconds 1 }
if (Test-Path $active) { 'LIMITE DE DEBIT : ACTIVE' } else { 'LIMITE DE DEBIT : INACTIVE' }