$ErrorActionPreference = "Stop"

$repo = "D0brane/bird-wallpaper"
$installDir = Join-Path $env:LOCALAPPDATA "BirdWallpaper"

function Find-Lively {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Lively Wallpaper\Lively.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Lively Wallpaper\Lively.exe")
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  return $null
}

function Get-SourceRoot {
  $beside = Join-Path $PSScriptRoot "LivelyInfo.json"
  if ($PSScriptRoot -and (Test-Path -LiteralPath $beside)) { return $PSScriptRoot }

  Write-Host "正在下载壁纸文件..."
  $zip = Join-Path $env:TEMP "bird-wallpaper.zip"
  $extract = Join-Path $env:TEMP "bird-wallpaper-src"
  Invoke-WebRequest -Uri "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $folder = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
  if (-not $folder) { throw "下载的压缩包里没有壁纸文件" }
  return $folder.FullName
}

function Copy-Wallpaper([string]$source, [string]$target) {
  $sourceFull = [IO.Path]::GetFullPath($source).TrimEnd('\')
  $targetFull = [IO.Path]::GetFullPath($target).TrimEnd('\')
  New-Item -ItemType Directory -Force -Path $targetFull | Out-Null
  if ($sourceFull -eq $targetFull) { return }
  $files = @(
    "index.html", "sim.js", "style.css", "LivelyInfo.json", "LivelyProperties.json",
    "bird-wallpaper.marker", "icon-probe.ps1", "install-probe.ps1", "install.ps1", "install.bat", "README.md", "assets.yaml"
  )
  foreach ($name in $files) {
    $from = Join-Path $source $name
    if (Test-Path -LiteralPath $from) {
      Copy-Item -LiteralPath $from -Destination (Join-Path $target $name) -Force
    }
  }
  foreach ($extra in @("params.json", "icons.json")) {
    $from = Join-Path $source $extra
    if (Test-Path -LiteralPath $from) {
      Copy-Item -LiteralPath $from -Destination (Join-Path $target $extra) -Force
    }
  }
  foreach ($dirName in @("birds", "backgrounds")) {
    $from = Join-Path $source $dirName
    $to = Join-Path $target $dirName
    if (-not (Test-Path -LiteralPath $from)) { continue }
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    Copy-Item -Path (Join-Path $from "*") -Destination $to -Force
  }
}

function Get-SupportText {
  "本壁纸支持 Windows 10 和 Windows 11，不是只支持 Windows 11；目前只在 Windows 11 上测试过。Windows 10 如果没有 winget，请先自行安装 Lively Wallpaper（https://github.com/rocksdanister/lively），然后重新运行本脚本。"
}

function Assert-SupportedWindows {
  $build = 0
  try {
    $current = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    [void][int]::TryParse([string]$current.CurrentBuild, [ref]$build)
  } catch {
    return
  }
  if ($build -gt 0 -and $build -lt 10240) {
    throw "只能在 Windows 10 或 Windows 11 上安装。$(Get-SupportText)"
  }
}

function Install-LivelyIfMissing {
  if (Find-Lively) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "没有找到 winget，无法自动安装 Lively Wallpaper。$(Get-SupportText)"
  }
  Write-Host "正在安装 Lively Wallpaper..."
  winget install --id rocksdanister.LivelyWallpaper -e --accept-package-agreements --accept-source-agreements
  $deadline = (Get-Date).AddMinutes(3)
  while (-not (Find-Lively) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (Find-Lively)) { throw "Lively Wallpaper 没有安装成功。$(Get-SupportText)" }
}

function Start-IconProbe([string]$probe) {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -match 'icon-probe\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 400
  $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  Start-Process -FilePath $powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $probe) -WindowStyle Hidden
}

Write-Host "安装鸟群与隼壁纸"
Assert-SupportedWindows
$source = Get-SourceRoot
Install-LivelyIfMissing
Copy-Wallpaper $source $installDir
& (Join-Path $installDir "install-probe.ps1")
Start-IconProbe (Join-Path $installDir "icon-probe.ps1")

$lively = Find-Lively
if (-not (Get-Process -Name "Lively" -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $lively
  Start-Sleep -Seconds 8
}
& $lively setwp --file $installDir | Out-Null
Write-Host "安装完成。壁纸目录：$installDir"
Write-Host "如果桌面没有立刻换上，打开一次 Lively Wallpaper，再双击 install.bat。"
