# Dev tunnel: exposes the whole project (Next.js app + Django API) on one public
# https://<random>.trycloudflare.com URL through a Cloudflare quick tunnel. No Cloudflare account needed.
#
#   powershell -ExecutionPolicy Bypass -File scripts\tunnel.ps1
#
# How: Next runs on :3000 with API_PROXY_TARGET set, so it forwards /api/* to Django on :8010
# (see frontend/next.config.ts). The browser only ever talks to the tunnel URL: no CORS changes.
# Stop your normal `npm run dev` first (it holds port 3000). Ctrl+C stops the tunnel; close the
# opened windows to stop Next / Django.
#
# Postgres and Redis must already be running (see backend/README.md). Celery is not started here.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$webPort = 3000
$apiPort = 8010

function Test-Port($port) {
  [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

# winget's install folder, for terminals opened before the install updated PATH
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe" }
if (-not (Test-Path $cloudflared)) {
  Write-Host "cloudflared not found. Install it with: winget install --id Cloudflare.cloudflared -e" -ForegroundColor Red
  exit 1
}

if (Test-Port $webPort) {
  Write-Host "Port $webPort is in use. Stop your dev server (npm run dev) and run this again." -ForegroundColor Red
  exit 1
}

# Django: reuse a running server, else start one
if (Test-Port $apiPort) {
  Write-Host "Django already running on :$apiPort"
} else {
  Write-Host "Starting Django on :$apiPort ..."
  Start-Process -FilePath "$root\backend\.venv\Scripts\python.exe" `
    -ArgumentList "manage.py", "runserver", "$apiPort" -WorkingDirectory "$root\backend"
}

# Next.js in proxy mode. These override frontend/.env.local for this process only.
$env:API_PROXY_TARGET = "http://localhost:$apiPort"
$env:NEXT_PUBLIC_SALES_PIPELINE_API = "/api/sales-pipeline"
$env:NEXT_PUBLIC_AUTH_API = "/api/auth"
Write-Host "Starting Next.js on :$webPort (API proxied to :$apiPort) ..."
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "-p", "$webPort" -WorkingDirectory "$root\frontend"

Write-Host "Waiting for Next.js ..."
$deadline = (Get-Date).AddSeconds(90)
while (-not (Test-Port $webPort)) {
  if ((Get-Date) -gt $deadline) { Write-Host "Next.js did not start; check its window." -ForegroundColor Red; exit 1 }
  Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "Opening the tunnel. Your public URL is the https://*.trycloudflare.com line below." -ForegroundColor Green
Write-Host "Email links (invites, alerts) use FRONTEND_URL in backend/.env; set it to that URL if you need them." -ForegroundColor Yellow
Write-Host ""
& $cloudflared tunnel --url "http://localhost:$webPort"
