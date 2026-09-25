<#
    一键安装 Infinite Canvas 本地 Agent（Windows）

    作用：把本地 Agent 装成"后台自动运行"的程序——不显示任何窗口，登录后自动启动。
    用法：在本机 PowerShell 里执行（或在画布「连接」页复制命令）：
        irm <画布地址>/canvas-agent/install.ps1 | iex

    默认使用 npm 上的最新版；本仓库开发时可先指定本地构建：
        $env:CANVAS_AGENT_COMMAND = "node C:\path\to\canvas-agent\dist\index.js"
        $env:CANVAS_AGENT_WORKDIR = "C:\path\to\canvas-agent"
#>
param()

$ErrorActionPreference = "Stop"
$command = if ($env:CANVAS_AGENT_COMMAND) { $env:CANVAS_AGENT_COMMAND } else { "npx -y @basketikun/canvas-agent@latest" }
$workdir = $env:CANVAS_AGENT_WORKDIR
$dir = Join-Path $env:USERPROFILE ".infinite-canvas"
$vbs = Join-Path $dir "start-agent.vbs"

Write-Host "正在安装本地 Agent..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$lines = @(
    "' 后台静默启动 Canvas Agent（不显示任何窗口）",
    'Set shell = CreateObject("WScript.Shell")'
)
if ($workdir) { $lines += 'shell.CurrentDirectory = "' + $workdir + '"' }
$lines += 'shell.Run "' + $command + '", 0, False'
[System.IO.File]::WriteAllText($vbs, ($lines -join "`r`n"), [System.Text.Encoding]::Unicode)
Write-Host "启动脚本: $vbs"

try {
    $startup = [Environment]::GetFolderPath("Startup")
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup "Infinite Canvas Agent.lnk"))
    $shortcut.TargetPath = "wscript.exe"
    $shortcut.Arguments = '"' + $vbs + '"'
    $shortcut.WorkingDirectory = $dir
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Infinite Canvas 本地 Agent（后台隐藏运行）"
    $shortcut.Save()
    Write-Host "已加入开机启动（后台隐藏运行）" -ForegroundColor Green
} catch {
    Write-Host "加入开机启动失败（不影响本次启动）: $($_.Exception.Message)" -ForegroundColor Yellow
}

Start-Process -FilePath "wscript.exe" -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
Start-Sleep -Seconds 3
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:17371/config" -TimeoutSec 5 -UseBasicParsing | Out-Null
    Write-Host "本地 Agent 已在后台运行，没有窗口。" -ForegroundColor Green
} catch {
    Write-Host "Agent 启动后暂时没有响应，稍等几秒再回画布点「连接」。" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "以后不需要手动启动：登录 Windows 后会自己跑起来。" -ForegroundColor Cyan
Write-Host "卸载：删除启动文件夹里的 'Infinite Canvas Agent.lnk'，并结束 node 进程即可。" -ForegroundColor DarkGray
