$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$cloudflaredPath = Join-Path $projectRoot 'cloudflared\cloudflared.exe'

$webConnections = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
foreach ($connection in $webConnections) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -like '*server.mjs*') {
        Stop-Process -Id $connection.OwningProcess -Force
        Write-Host "Stopped web app (PID $($connection.OwningProcess))."
    }
}

Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $cloudflaredPath } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        Write-Host "Stopped tunnel (PID $($_.ProcessId))."
    }

$vncPath = Join-Path $projectRoot 'vnc\winvnc.exe'
Get-CimInstance Win32_Process -Filter "Name = 'winvnc.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $vncPath } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        Write-Host "Stopped VNC server (PID $($_.ProcessId))."
    }

Write-Host 'VNC server, web app, and tunnel stopped.'
