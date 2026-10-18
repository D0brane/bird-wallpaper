# 鸟群与隼

Windows 11 动态壁纸。鼠标和桌面图标是两种隼，鸟群会躲开它们，飞出屏幕后从对面回来。

需要 [Lively Wallpaper](https://github.com/rocksdanister/lively)。安装脚本会在缺少时用 winget 安装它。

## 一键安装

在 PowerShell 里运行：

```powershell
irm https://raw.githubusercontent.com/D0brane/bird-wallpaper/main/install.ps1 | iex
```

也可以下载本仓库后双击 `install.bat`。

脚本会把壁纸装到 `%LOCALAPPDATA%\BirdWallpaper`，设为当前壁纸，并登记登录后读取桌面图标位置的计划任务。桌面没显示、锁屏或壁纸没在播放时，这个任务只睡觉。
