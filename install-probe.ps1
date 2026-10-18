$ErrorActionPreference = "Stop"
$probe = Join-Path $PSScriptRoot "icon-probe.ps1"
if (-not (Test-Path -LiteralPath $probe)) { throw "icon-probe.ps1 is missing" }

$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$probe`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT30S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "BirdWallpaperIconProbe" -Action $action -Trigger $trigger -Settings $settings -Description "Read desktop icon positions for the bird wallpaper while the desktop is visible." -Force | Out-Null
Write-Output "registered BirdWallpaperIconProbe"
