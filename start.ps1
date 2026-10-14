$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 20+ (including npm) first.'
}
if (-not (Test-Path .env)) {
    Write-Host 'Creating .env. Save the login password printed below.'
    node scripts/gen-env.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$envValues = @{}
Get-Content .env | ForEach-Object {
    if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $envValues[$Matches[1]] = $Matches[2].Trim('"', "'") }
}
$vncHost = if ($envValues.VNC_HOST) { $envValues.VNC_HOST } else { '127.0.0.1' }
$vncPort = if ($envValues.VNC_PORT) { [int]$envValues.VNC_PORT } else { 5900 }
$webPort = if ($envValues.PORT) { [int]$envValues.PORT } else { 3100 }

$connection = New-Object System.Net.Sockets.TcpClient
try {
    $connection.Connect($vncHost, $vncPort)
} catch {
    throw "No VNC server at ${vncHost}:${vncPort}. Install/start a VNC server on Windows, set a VNC password, and restrict its port to localhost. RDP is not VNC."
} finally {
    $connection.Dispose()
}

if (-not (Test-Path node_modules)) { npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
if (-not (Test-Path .next/BUILD_ID)) { npm run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }

Write-Host "Open http://127.0.0.1:${webPort}/login (Ctrl+C to stop web app)."
npm start
exit $LASTEXITCODE
