<#
.SYNOPSIS
  把本地部署包(目录)打包上传到远端并解压。

.DESCRIPTION
  复用 website-helper-skill 的 SSH 通道(ssh-exec.py + C:\Users\septe\.agents\.env 里的
  SSH_HOST/SSH_USER/SSH_KEY_PATH)。不打印任何凭据值。

  远端命令全部走 base64 传输,规避 PowerShell 对 $ / ` / 引号的吞并。

.EXAMPLE
  pwsh -NoProfile -File .agents\tools\push-pkg.ps1 -LocalDir D:\workspace\deploy-services\test-190\jenkins -RemoteDir /opt/jenkins-190
#>
[CmdletBinding()]
param(
  [string]$LocalDir = 'D:\workspace\deploy-services\test-190\jenkins',
  [string]$RemoteDir = '/opt/deploy-services/test-190/jenkins'
)

$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'

$SSH_EXEC = 'C:\Users\septe\.agents\skills\website-helper-skill\scripts\ssh-exec.py'
if (-not (Test-Path $SSH_EXEC)) { throw "找不到 ssh-exec.py: $SSH_EXEC" }
if (-not (Test-Path $LocalDir)) { throw "本地目录不存在: $LocalDir" }

# 只打包需要上机的内容:.env / .git / 临时文件一律排除
$tarFile = Join-Path ([IO.Path]::GetTempPath()) ("jenkins-pkg-{0}.tar.gz" -f (Get-Date -Format 'yyyyMMddHHmmss'))
Push-Location $LocalDir
try {
  & tar -czf $tarFile --exclude=.env --exclude=.git --exclude='*.bak' .
  if ($LASTEXITCODE -ne 0) { throw "tar 打包失败 (exit $LASTEXITCODE)" }
} finally { Pop-Location }

Write-Host "本地包: $tarFile ($((Get-Item $tarFile).Length) bytes)"

$bytes = [IO.File]::ReadAllBytes($tarFile)
$b64 = [Convert]::ToBase64String($bytes)

# Windows 命令行有长度上限(~32KB)，base64 分块传输，远端拼接后解码
$chunkSize = 6000
$chunks = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $b64.Length; $i += $chunkSize) {
  $len = [Math]::Min($chunkSize, $b64.Length - $i)
  $chunks.Add($b64.Substring($i, $len))
}
Write-Host "base64 分块: $($chunks.Count) 块"

$remoteTmp = "/tmp/jenkins-pkg-$$.b64"
$remoteB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("rm -f '$remoteTmp'; touch '$remoteTmp'"))
& python $SSH_EXEC "echo $remoteB64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "远端初始化临时文件失败" }

$idx = 0
foreach ($c in $chunks) {
  $idx++
  $remoteB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("printf '%s' '$c' >> '$remoteTmp'"))
  & python $SSH_EXEC "echo $remoteB64 | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { throw "远端分块 $idx 传输失败" }
  Write-Host "  chunk $idx/$($chunks.Count) 已传输"
}

$remote = @"
set -e
mkdir -p '$RemoteDir'
base64 -d '$remoteTmp' | tar xz -C '$RemoteDir'
rm -f '$remoteTmp'
chmod 750 '$RemoteDir' 2>/dev/null || true
echo '--- 远端文件清单 ---'
find '$RemoteDir' -maxdepth 3 -type f -printf '%M %u:%g %8s %p\n' | sort
"@

$remoteB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
& python $SSH_EXEC "echo $remoteB64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "远端上传/解压失败 (exit $LASTEXITCODE)" }

Remove-Item $tarFile -Force
Write-Host "完成: $LocalDir -> $RemoteDir"
