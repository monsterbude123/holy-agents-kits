<#
.SYNOPSIS
  把本地 bash 脚本送到远端执行(参数 / stdin 由脚本自己负责)。

.DESCRIPTION
  复用 website-helper-skill 的 SSH 通道(ssh-exec.py)。远端脚本以 base64 传输,
  规避 PowerShell 对 $ / ` / 引号的吞并。脚本输出原样回显。

.EXAMPLE
  pwsh -NoProfile -File .agents\tools\run-remote.ps1 -ScriptPath D:\workspace\deploy-services\.agents\tools\cutover.sh
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [string[]]$ArgList = @(),
  [switch]$AsRoot
)

$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'

$SSH_EXEC = 'C:\Users\septe\.agents\skills\website-helper-skill\scripts\ssh-exec.py'
if (-not (Test-Path $SSH_EXEC)) { throw "找不到 ssh-exec.py: $SSH_EXEC" }
if (-not (Test-Path $ScriptPath)) { throw "脚本不存在: $ScriptPath" }

$script = Get-Content -LiteralPath $ScriptPath -Raw -Encoding UTF8
$quoted = ($ArgList | ForEach-Object { "'" + ($_ -replace "'", "'\''") + "'" }) -join ' '
$wrapper = if ($quoted) { "cat <<'__DSH_SCRIPT_EOF__' | bash -s -- $quoted`n$script`n__DSH_SCRIPT_EOF__" }
            else { "cat <<'__DSH_SCRIPT_EOF__' | bash -s`n$script`n__DSH_SCRIPT_EOF__" }

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($wrapper))
& python $SSH_EXEC "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "远端脚本执行失败 (exit $LASTEXITCODE)" }
