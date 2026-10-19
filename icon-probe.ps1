param(
  [switch]$Once
)

$ErrorActionPreference = "Stop"

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BirdDesktop {
  public const uint LvmGetItemCount = 0x1004;
  public const uint LvmGetItemRect = 0x100E;
  public const uint ProcessVmOperation = 0x0008;
  public const uint ProcessVmRead = 0x0010;
  public const uint ProcessVmWrite = 0x0020;
  public const uint ProcessQueryInformation = 0x0400;
  public const uint MemCommit = 0x1000;
  public const uint MemReserve = 0x2000;
  public const uint MemRelease = 0x8000;
  public const uint PageReadWrite = 0x04;
  public const uint DesktopReadObjects = 0x0001;

  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr parent, EnumProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder name, int max);

  [DllImport("user32.dll")]
  public static extern IntPtr GetParent(IntPtr hWnd);

  public static string ClassOf(IntPtr hWnd) {
    var name = new System.Text.StringBuilder(256);
    GetClassName(hWnd, name, name.Capacity);
    return name.ToString();
  }

  public static IntPtr DesktopListView() {
    IntPtr found = IntPtr.Zero;
    EnumProc top = (hwnd, lp) => {
      string cls = ClassOf(hwnd);
      if (cls != "Progman" && cls != "WorkerW") return true;
      IntPtr list = IntPtr.Zero;
      EnumProc child = (childHwnd, childLp) => {
        if (ClassOf(childHwnd) == "SysListView32" && ClassOf(GetParent(childHwnd)) == "SHELLDLL_DefView") {
          list = childHwnd;
          return false;
        }
        return true;
      };
      EnumChildWindows(hwnd, child, IntPtr.Zero);
      if (list != IntPtr.Zero) {
        found = list;
        return false;
      }
      return true;
    };
    EnumWindows(top, IntPtr.Zero);
    return found;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);

  [DllImport("user32.dll")]
  public static extern uint GetDpiForWindow(IntPtr hwnd);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int index);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool CloseDesktop(IntPtr desktop);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int processId);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint allocation, uint protect);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint freeType);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr written);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr read);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
}
"@
} catch {
  if ($_.Exception.Message -notmatch "already exists") { throw }
}

function Send-ListMessage([IntPtr]$window, [uint32]$message, [IntPtr]$wparam, [IntPtr]$lparam) {
  $result = [IntPtr]::Zero
  $ok = [BirdDesktop]::SendMessageTimeout($window, $message, $wparam, $lparam, 2, 400, [ref]$result)
  if ($ok -eq [IntPtr]::Zero) { return $null }
  return $result
}

function Test-InputDesktop {
  $desktop = [BirdDesktop]::OpenInputDesktop(0, $false, [BirdDesktop]::DesktopReadObjects)
  if ($desktop -eq [IntPtr]::Zero) { return $false }
  [BirdDesktop]::CloseDesktop($desktop) | Out-Null
  return $true
}

function Get-DesktopListView {
  return [BirdDesktop]::DesktopListView()
}

function Test-LivelyPlayer {
  $names = @("Lively.Player.WebView2", "Lively.Player.CefSharp")
  foreach ($name in $names) {
    if (Get-Process -Name $name -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

function Get-WallpaperDirs {
  $dirs = New-Object System.Collections.Generic.List[string]
  $root = Split-Path -Parent $PSCommandPath
  if (Test-Path -LiteralPath (Join-Path $root "bird-wallpaper.marker")) {
    $dirs.Add($root)
  }
  $library = Join-Path $env:LOCALAPPDATA "Lively Wallpaper\Library\wallpapers"
  if (Test-Path -LiteralPath $library) {
    Get-ChildItem -LiteralPath $library -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      if (Test-Path -LiteralPath (Join-Path $_.FullName "bird-wallpaper.marker")) {
        $dirs.Add($_.FullName)
      }
    }
  }
  return $dirs
}

function Get-IconCenters {
  $list = Get-DesktopListView
  if ($list -eq [IntPtr]::Zero) { return $null }

  $processId = 0
  [BirdDesktop]::GetWindowThreadProcessId($list, [ref]$processId) | Out-Null
  $access = [BirdDesktop]::ProcessVmOperation -bor [BirdDesktop]::ProcessVmRead -bor [BirdDesktop]::ProcessVmWrite -bor [BirdDesktop]::ProcessQueryInformation
  $process = [BirdDesktop]::OpenProcess($access, $false, $processId)
  if ($process -eq [IntPtr]::Zero) { throw "OpenProcess failed" }

  $remote = [IntPtr]::Zero
  try {
    $remote = [BirdDesktop]::VirtualAllocEx($process, [IntPtr]::Zero, [UIntPtr]::new(16), [BirdDesktop]::MemCommit -bor [BirdDesktop]::MemReserve, [BirdDesktop]::PageReadWrite)
    if ($remote -eq [IntPtr]::Zero) { throw "VirtualAllocEx failed" }

    $dpi = [BirdDesktop]::GetDpiForWindow($list)
    if ($dpi -lt 96) { $dpi = 96 }
    $scale = $dpi / 96.0
    $originX = [BirdDesktop]::GetSystemMetrics(76)
    $originY = [BirdDesktop]::GetSystemMetrics(77)
    $countResult = Send-ListMessage $list ([BirdDesktop]::LvmGetItemCount) ([IntPtr]::Zero) ([IntPtr]::Zero)
    if ($null -eq $countResult) { throw "listview timeout" }
    $count = $countResult.ToInt32()
    $points = New-Object System.Collections.Generic.List[object]

    for ($index = 0; $index -lt $count; $index++) {
      $seed = [byte[]](0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      $written = [UIntPtr]::Zero
      [BirdDesktop]::WriteProcessMemory($process, $remote, $seed, [UIntPtr]::new(16), [ref]$written) | Out-Null
      $rectResult = Send-ListMessage $list ([BirdDesktop]::LvmGetItemRect) ([IntPtr]::new($index)) $remote
      if ($null -eq $rectResult) { throw "listview timeout" }
      $buffer = New-Object byte[] 16
      $read = [UIntPtr]::Zero
      [BirdDesktop]::ReadProcessMemory($process, $remote, $buffer, [UIntPtr]::new(16), [ref]$read) | Out-Null
      $left = [BitConverter]::ToInt32($buffer, 0)
      $top = [BitConverter]::ToInt32($buffer, 4)
      $right = [BitConverter]::ToInt32($buffer, 8)
      $bottom = [BitConverter]::ToInt32($buffer, 12)
      if ($right -le $left -or $bottom -le $top) { continue }
      $centerX = ($originX + (($left + $right) / 2.0)) / $scale
      $centerY = ($originY + (($top + $bottom) / 2.0)) / $scale
      $points.Add([pscustomobject]@{ x = $centerX; y = $centerY })
    }
    return $points
  } finally {
    if ($remote -ne [IntPtr]::Zero) {
      [BirdDesktop]::VirtualFreeEx($process, $remote, [UIntPtr]::Zero, [BirdDesktop]::MemRelease) | Out-Null
    }
    [BirdDesktop]::CloseHandle($process) | Out-Null
  }
}

function Write-Utf8([string]$path, [string]$text) {
  $tmp = "$path.tmp"
  $encoding = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($tmp, $text, $encoding)
  [System.IO.File]::Copy($tmp, $path, $true)
  Remove-Item -LiteralPath $tmp -Force
}

function Get-FolderAssetNames([string]$dir, [string]$folder, [string[]]$extensions) {
  $path = Join-Path $dir $folder
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  return @(Get-ChildItem -LiteralPath $path -File -ErrorAction SilentlyContinue |
    Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object { $_.Name } |
    Sort-Object)
}

function Update-FolderList([string]$dir, [string]$folder, [string[]]$extensions) {
  $path = Join-Path $dir $folder
  if (-not (Test-Path -LiteralPath $path)) { return }
  $names = @(Get-FolderAssetNames $dir $folder $extensions)
  $listParts = foreach ($name in $names) {
    '"' + ($name -replace '\\', '\\' -replace '"', '\"') + '"'
  }
  $listJson = "[" + ($listParts -join ",") + "]"
  $listPath = Join-Path $path "list.json"
  $current = ""
  if (Test-Path -LiteralPath $listPath) { $current = [System.IO.File]::ReadAllText($listPath) }
  if ($current -ne $listJson) { Write-Utf8 $listPath $listJson }
}

function Format-YamlString([string]$value) {
  return '"' + (($value -replace '\\', '\\' -replace '"', '\"')) + '"'
}

function ConvertTo-AssetsYaml([string]$bird, [string]$background, [string[]]$birds, [string[]]$backgrounds) {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("bird: $(Format-YamlString $bird)")
  $lines.Add("background: $(Format-YamlString $background)")
  $lines.Add("birds:")
  foreach ($name in @($birds)) { $lines.Add("  - $(Format-YamlString $name)") }
  $lines.Add("backgrounds:")
  foreach ($name in @($backgrounds)) { $lines.Add("  - $(Format-YamlString $name)") }
  return ($lines -join "`n") + "`n"
}

function Publish-AssetsYaml([string]$dir, [string]$bird, [string]$background) {
  $birds = @(Get-FolderAssetNames $dir "birds" @(".svg", ".png", ".webp", ".jpg", ".jpeg"))
  $backgrounds = @(Get-FolderAssetNames $dir "backgrounds" @(".jpg", ".jpeg", ".png", ".webp"))
  $yaml = ConvertTo-AssetsYaml $bird $background $birds $backgrounds
  $path = Join-Path $dir "assets.yaml"
  $current = ""
  if (Test-Path -LiteralPath $path) { $current = [System.IO.File]::ReadAllText($path) }
  if ($current -ne $yaml) { Write-Utf8 $path $yaml }
}

function Get-SavedImageChoice([string]$dir) {
  $bird = ""
  $background = ""
  $path = Join-Path $dir "params.json"
  if (Test-Path -LiteralPath $path) {
    try {
      $saved = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
      $bird = [string]$saved.birdImage
      $background = [string]$saved.backgroundImage
    } catch {}
  }
  return @{ bird = $bird; background = $background }
}

function Update-BackgroundLists {
  foreach ($dir in (Get-WallpaperDirs)) {
    Update-FolderList $dir "backgrounds" @(".jpg", ".jpeg", ".png", ".webp")
    Update-FolderList $dir "birds" @(".svg", ".png", ".webp", ".jpg", ".jpeg")
    $choice = Get-SavedImageChoice $dir
    Publish-AssetsYaml $dir $choice.bird $choice.background
  }
}

function Get-IconSignature($points) {
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $parts = foreach ($point in @($points)) {
    [string]::Format($culture, "{0:0.#},{1:0.#}", [double]$point.x, [double]$point.y)
  }
  return ($parts -join ";")
}

function Publish-Icons($points) {
  $items = @($points)
  $signature = Get-IconSignature $items
  if ($signature -eq $script:lastIconSignature) { return $items.Count }
  $parts = foreach ($point in $items) {
    $x = [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.###}", [double]$point.x)
    $y = [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.###}", [double]$point.y)
    "{`"x`":$x,`"y`":$y}"
  }
  $iconsJson = '{"icons":[' + ($parts -join ",") + ']}'
  foreach ($dir in (Get-WallpaperDirs)) {
    Write-Utf8 (Join-Path $dir "icons.json") $iconsJson
  }
  $script:lastIconSignature = $signature
  return $items.Count
}

function Publish-State($points) {
  $count = Publish-Icons $points
  Update-BackgroundLists
  return $count
}

function Test-SavedImageName([string]$name, [bool]$allowSvg) {
  if ([string]::IsNullOrEmpty($name)) { return $true }
  if ($name.Length -gt 80 -or $name -match '[\\/:]') { return $false }
  $ext = [IO.Path]::GetExtension($name).ToLowerInvariant()
  $allowed = @(".png", ".jpg", ".jpeg", ".webp")
  if ($allowSvg) { $allowed += ".svg" }
  return $allowed -contains $ext
}

function Format-SavedNumber($value, [int]$decimals) {
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $number = [Math]::Round([double]$value, $decimals)
  if ($decimals -le 0) { return [string]([int]$number) }
  return $number.ToString("0." + ("0" * $decimals), $culture)
}

function Get-ParamSpec {
  $path = Join-Path (Split-Path -Parent $PSCommandPath) "LivelyProperties.json"
  $schema = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
  $spec = [ordered]@{}
  foreach ($prop in $schema.PSObject.Properties) {
    if ($prop.Value.type -ne "slider") { continue }
    $step = [double]$prop.Value.step
    $stepText = $step.ToString([Globalization.CultureInfo]::InvariantCulture)
    $decimals = 0
    if ($stepText -match '\.(\d+)') { $decimals = $Matches[1].Length }
    $spec[$prop.Name] = @([double]$prop.Value.min, [double]$prop.Value.max, $decimals)
  }
  return $spec
}

function Get-SavedParams([string]$body) {
  $incoming = $body | ConvertFrom-Json
  $spec = Get-ParamSpec
  $saved = [ordered]@{}
  foreach ($name in $spec.Keys) {
    $prop = $incoming.PSObject.Properties[$name]
    if ($null -eq $prop) { return $null }
    $number = 0.0
    try { $number = [double]$prop.Value } catch { return $null }
    $min = [double]$spec[$name][0]
    $max = [double]$spec[$name][1]
    if ($number -lt $min) { $number = $min }
    if ($number -gt $max) { $number = $max }
    $saved[$name] = Format-SavedNumber $number ([int]$spec[$name][2])
  }
  $bird = [string]$incoming.birdImage
  $background = [string]$incoming.backgroundImage
  if (-not (Test-SavedImageName $bird $true) -or -not (Test-SavedImageName $background $false)) { return $null }
  $saved["birdImage"] = $bird
  $saved["backgroundImage"] = $background
  return $saved
}

function ConvertTo-ParamsJson($saved) {
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($name in $saved.Keys) {
    $value = $saved[$name]
    if ($name -eq "birdImage" -or $name -eq "backgroundImage") {
      $text = ([string]$value) -replace '\\', '\\' -replace '"', '\"'
      $parts.Add('"' + $name + '":"' + $text + '"')
    } else {
      $parts.Add('"' + $name + '":' + [string]$value)
    }
  }
  return "{" + ($parts -join ",") + "}"
}

function Publish-Params([string]$json) {
  $saved = $json | ConvertFrom-Json
  foreach ($dir in (Get-WallpaperDirs)) {
    Write-Utf8 (Join-Path $dir "params.json") $json
    Publish-AssetsYaml $dir ([string]$saved.birdImage) ([string]$saved.backgroundImage)
  }
}

function Send-ParamHttp($stream, [int]$code) {
  $reason = @{ 204 = "No Content"; 400 = "Bad Request"; 404 = "Not Found"; 413 = "Payload Too Large" }[$code]
  if (-not $reason) { $reason = "OK" }
  $head = "HTTP/1.1 $code $reason`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
  $bytes = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($bytes, 0, $bytes.Length)
}

function Receive-OneParam($client) {
  $client.ReceiveTimeout = 1500
  $client.SendTimeout = 1500
  $stream = $client.GetStream()
  $raw = New-Object System.IO.MemoryStream
  $temp = New-Object byte[] 2048
  while ($raw.Length -lt 32768) {
    $count = 0
    try { $count = $stream.Read($temp, 0, $temp.Length) } catch { return }
    if ($count -le 0) { return }
    $raw.Write($temp, 0, $count)
    $ascii = [Text.Encoding]::ASCII.GetString($raw.ToArray())
    $split = $ascii.IndexOf("`r`n`r`n")
    if ($split -lt 0) { continue }
    $headerLength = $split + 4
    $headers = $ascii.Substring(0, $split)
    $method = ($headers.Split(" ")[0]).ToUpperInvariant()
    if ($method -eq "OPTIONS") { Send-ParamHttp $stream 204; return }
    if ($method -ne "POST") { Send-ParamHttp $stream 404; return }
    $lengthMatch = [regex]::Match($headers, "(?im)^Content-Length:\s*(\d+)")
    $need = 0
    if ($lengthMatch.Success) { $need = [int]$lengthMatch.Groups[1].Value }
    if ($need -le 0 -or $need -gt 8192) { Send-ParamHttp $stream 413; return }
    while ($raw.Length -lt ($headerLength + $need)) {
      $count = $stream.Read($temp, 0, $temp.Length)
      if ($count -le 0) { return }
      $raw.Write($temp, 0, $count)
    }
    $bodyBytes = $raw.ToArray()
    $body = [Text.Encoding]::UTF8.GetString($bodyBytes, $headerLength, $need)
    $saved = Get-SavedParams $body
    if ($null -eq $saved) { Send-ParamHttp $stream 400; return }
    Publish-Params (ConvertTo-ParamsJson $saved)
    Send-ParamHttp $stream 204
    return
  }
}

function Receive-ParamSaves {
  if ($null -eq $script:paramListener) { return }
  while ($true) {
    $client = $null
    try { $client = $script:paramListener.AcceptTcpClient() } catch { break }
    if ($null -eq $client) { break }
    try { Receive-OneParam $client } catch {} finally { $client.Close() }
  }
}

function Wait-Probe([int]$milliseconds) {
  $left = $milliseconds
  while ($left -gt 0) {
    Receive-ParamSaves
    $slice = [Math]::Min(200, $left)
    Start-Sleep -Milliseconds $slice
    $left -= $slice
  }
}

[BirdDesktop]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$mutex = New-Object System.Threading.Mutex($false, "Local\BirdWallpaperIconProbe")
$ownsMutex = $false
try {
  $ownsMutex = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  $ownsMutex = $true
}
if (-not $ownsMutex) { exit 0 }

try {
  try {
    $script:paramListener = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, 8766)
    $script:paramListener.Start()
    $script:paramListener.Server.Blocking = $false
  } catch {
    $script:paramListener = $null
  }

  if ($Once) {
    $ready = (Get-DesktopListView) -ne [IntPtr]::Zero -and (Test-InputDesktop)
    if ($ready) {
      $points = Get-IconCenters
      if ($null -eq $points) { throw "desktop list is unavailable" }
      $count = Publish-State $points
      Write-Output "icons $count"
    } else {
      $reasons = @()
      if ((Get-DesktopListView) -eq [IntPtr]::Zero) { $reasons += "no-list" }
      if (-not (Test-InputDesktop)) { $reasons += "no-input-desktop" }
      Write-Output ("idle " + ($reasons -join ","))
    }
    return
  }

  while ($true) {
    $ready = (Get-DesktopListView) -ne [IntPtr]::Zero -and (Test-InputDesktop) -and (Test-LivelyPlayer)
    if (-not $ready) {
      $script:lastIconSignature = $null
      Wait-Probe 5000
      continue
    }

    try {
      $points = Get-IconCenters
      if ($null -ne $points) { Publish-State $points | Out-Null }
    } catch {}
    Wait-Probe 1500
  }
} finally {
  if ($null -ne $script:paramListener) { $script:paramListener.Stop() }
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
