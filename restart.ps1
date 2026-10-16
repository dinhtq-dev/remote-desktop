$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

& (Join-Path $PSScriptRoot 'stop.ps1')

$runtime = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null

$vncPath = Join-Path $PSScriptRoot 'vnc\winvnc.exe'
if (-not (Test-Path $vncPath)) {
    throw "Missing bundled VNC server: $vncPath"
}

$vnc = Start-Process -FilePath $vncPath `
    -ArgumentList '-run' `
    -WorkingDirectory (Join-Path $PSScriptRoot 'vnc') `
    -WindowStyle Hidden `
    -PassThru

$vncReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 5900 -State Listen -ErrorAction SilentlyContinue) {
        $vncReady = $true
        break
    }
}

if (-not $vncReady) {
    throw 'Bundled VNC server failed to listen on 127.0.0.1:5900.'
}

$web = Start-Process -FilePath 'node.exe' `
    -ArgumentList @('server.mjs', '--production') `
    -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput (Join-Path $runtime 'web.out.log') `
    -RedirectStandardError (Join-Path $runtime 'web.err.log') `
    -WindowStyle Hidden `
    -PassThru

$tunnel = Start-Process -FilePath (Join-Path $PSScriptRoot 'cloudflared\cloudflared.exe') `
    -ArgumentList @('tunnel', '--config', (Join-Path $PSScriptRoot 'cloudflared\config.yml'), '--logfile', (Join-Path $runtime 'cloudflared.log'), 'run') `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -PassThru

Set-Content (Join-Path $runtime 'web.pid') $web.Id
Set-Content (Join-Path $runtime 'cloudflared.pid') $tunnel.Id
Set-Content (Join-Path $runtime 'vnc.pid') $vnc.Id

Start-Sleep -Seconds 3

if (-not (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)) {
    throw "Web app failed to start. Check $runtime\web.err.log"
}

if (-not (Get-Process -Id $tunnel.Id -ErrorAction SilentlyContinue)) {
    throw "Tunnel failed to start. Check $runtime\cloudflared.log"
}

Write-Host 'VNC, web app, and tunnel restarted: https://remote-1.dinhtq.vn/login'
