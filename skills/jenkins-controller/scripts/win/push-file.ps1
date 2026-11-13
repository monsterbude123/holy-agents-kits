<#
.SYNOPSIS
  把本地单个文件上传到远端(base64 传输,规避命令行长度与引号吞并问题)。

.DESCRIPTION
  远端命令走 base64 二次编码,规避 PowerShell 对 $ / ` / 引号的吞并。
  大文件按块传输(Windows 命令行有 ~32KB 上限),远端拼接后再解码。

.EXAMPLE
  pwsh -NoProfile -File .agents\tools\push-file.ps1 -LocalFile D:\...\Dockerfile -RemoteFile /opt/deploy-services/test-190/jenkins/Dockerfile
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LocalFile,
  [Parameter(Mandatory = $true)][string]$RemoteFile,
  [string]$Mode = '0644',
  [int]$ChunkSize = 6000
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
$SSH_EXEC = 'C:\Users\septe\.agents\skills\website-helper-skill\scripts\ssh-exec.py'
if (-not (Test-Path $LocalFile)) { throw "本地文件不存在: $LocalFile" }
if (-not (Test-Path $SSH_EXEC)) { throw "找不到 ssh-exec.py: $SSH_EXEC" }

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($LocalFile))

function Invoke-Remote([string]$script) {
  $enc = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
  & python $SSH_EXEC "echo $enc | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { throw "远端命令失败 (exit $LASTEXITCODE)" }
}

# 远端临时文件放同目录,保证最后一步可以原子替换(同一文件系统)
$remoteTmp = "$RemoteFile.b64tmp.$$"

if ($b64.Length -le $ChunkSize) {
  # 小文件:一次性传输
  Invoke-Remote "printf '%s' '$b64' | base64 -d > '$RemoteFile' && chmod $Mode '$RemoteFile' && echo OK: '$RemoteFile'"
  return
}

# 大文件:分块
Write-Host "文件较大($($b64.Length) base64 字符)，分块传输"
Invoke-Remote "rm -f '$remoteTmp'; : > '$remoteTmp'"
$total = [Math]::Ceiling($b64.Length / $ChunkSize)
$idx = 0
for ($i = 0; $i -lt $b64.Length; $i += $ChunkSize) {
  $len = [Math]::Min($ChunkSize, $b64.Length - $i)
  $chunk = $b64.Substring($i, $len)
  $idx++
  Invoke-Remote "printf '%s' '$chunk' >> '$remoteTmp'"
  Write-Host "  chunk $idx/$total"
}
Invoke-Remote "base64 -d '$remoteTmp' > '$RemoteFile' && rm -f '$remoteTmp' && chmod $Mode '$RemoteFile' && echo OK: '$RemoteFile'"
