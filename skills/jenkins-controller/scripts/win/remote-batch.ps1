<#
.SYNOPSIS
  一次 SSH 往返跑完多个远端只读检查（速度纪律 §0.1 的执行器）。

.DESCRIPTION
  把一个"分段检查文件"整包 base64 送到远端，一次 SSH 执行完所有段，
  分段回显。禁止"发一条命令 → 等一次回显 → 再发一条"。

  检查文件格式（纯文本）:
      ### 容器状态
      docker ps --filter name=jenkins-190 --format '{{.Names}} {{.Status}}'
      ### 旧服务
      systemctl is-active jenkins.service

  规则:
    - "### 标题" 开头 = 新的一段
    - 其余非空行 = 要在远端执行的 bash 命令（逐行执行，输出合并 stderr）
    - 每条命令后自动打印 [exit=N]，一眼看出哪条失败

.EXAMPLE
  pwsh -NoProfile -File .agents\skills\jenkins-controller\scripts\win\remote-batch.ps1 `
       -ChecksFile .agents\skills\jenkins-controller\scripts\win\checks\host-baseline.txt
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ChecksFile,
  [string]$Title = 'remote batch'
)

$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'

$SSH_EXEC = 'C:\Users\septe\.agents\skills\website-helper-skill\scripts\ssh-exec.py'
if (-not (Test-Path $SSH_EXEC)) { throw "找不到 ssh-exec.py: $SSH_EXEC" }
if (-not (Test-Path $ChecksFile)) { throw "检查文件不存在: $ChecksFile" }

$lines = Get-Content -LiteralPath $ChecksFile -Encoding UTF8
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("set +e")
[void]$sb.AppendLine("echo '########## $Title ##########'")
$sectionCount = 0
$cmdCount = 0
foreach ($line in $lines) {
  if ($line -match '^\s*###\s*(.+?)\s*$') {
    $sectionCount++
    [void]$sb.AppendLine("echo")
    [void]$sb.AppendLine("echo '===== $($Matches[1]) ====='")
    continue
  }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  if ($line.TrimStart().StartsWith('#')) { continue }
  $cmd = $line
  if ($cmd -notmatch '2>&1') { $cmd = "$cmd 2>&1" }
  $cmdCount++
  [void]$sb.AppendLine($cmd)
  [void]$sb.AppendLine('rc=$?; echo "[exit=$rc]"')
}

$remote = $sb.ToString() -replace "`r`n", "`n"   # 必须 LF：CRLF 会让 bash 把 "2>&1\r" 当成歧义重定向
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
Write-Host "一次 SSH 往返：$sectionCount 段 / $cmdCount 条命令"
& python $SSH_EXEC "echo $b64 | base64 -d | bash"
exit $LASTEXITCODE
