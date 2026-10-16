$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$cloudflared = Join-Path $PSScriptRoot 'cloudflared\cloudflared.exe'
$config = Join-Path $PSScriptRoot 'cloudflared\config.yml'

if (-not (Test-Path $cloudflared)) {
    throw "Missing $cloudflared"
}

& $cloudflared tunnel --config $config run
exit $LASTEXITCODE
