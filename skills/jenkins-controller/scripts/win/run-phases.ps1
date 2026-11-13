<#
  依次执行 cutover.sh 的多个阶段（在服务器上跑）
  pwsh -NoProfile -File .agents\tools\run-phases.ps1 -Phases prepare,migrate
  阶段名见 test-190\jenkins\scripts\cutover.sh：prepare|migrate|deploy|switch|finalize|all
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Phases,
  [string]$ScriptPath = 'D:\workspace\deploy-services\test-190\jenkins\scripts\cutover.sh'
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
foreach ($p in $Phases.Split(',')) {
  $p = $p.Trim()
  if (-not $p) { continue }
  Write-Host "########## PHASE: $p ##########"
  & pwsh -NoProfile -File 'D:\workspace\deploy-services\.agents\tools\run-remote.ps1' -ScriptPath $ScriptPath -ArgList $p
  Write-Host "########## PHASE $p DONE (exit=$LASTEXITCODE) ##########"
}
