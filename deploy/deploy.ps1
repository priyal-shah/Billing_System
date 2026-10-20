<#
.SYNOPSIS
  Upload the app to the EC2 server and (re)start it. Run this for the first deploy and every update.

.EXAMPLE
  cd E:\Billing_System\deploy
  .\deploy.ps1 -Server 13.233.10.5 -Key "$HOME\.ssh\billing-key.pem"
#>
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Key,
    [string]$User = 'ubuntu'
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) {
    throw 'deploy\.env not found. Copy deploy\.env.example to deploy\.env and fill it in first.'
}
if (-not (Test-Path $Key)) { throw "SSH key not found: $Key" }

$archive = Join-Path $env:TEMP 'billing-release.tar.gz'
Write-Host '==> Packaging backend_fastapi, frontend_react and deploy'
tar -czf $archive -C $root `
    --exclude=node_modules --exclude=.venv --exclude=__pycache__ --exclude=.pytest_cache `
    --exclude=dist --exclude=.env --exclude='*.tar.gz' `
    backend_fastapi frontend_react deploy
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }

$target = "$User@$Server"
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')

Write-Host "==> Uploading to $Server"
scp @sshOpts $archive "${target}:billing-release.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
scp @sshOpts $envFile "${target}:billing-env"
if ($LASTEXITCODE -ne 0) { throw 'Uploading .env failed' }

Write-Host '==> Building and starting containers (first build takes several minutes)'
$remote = @(
    'set -e',
    'mkdir -p ~/billing',
    'rm -rf ~/billing/backend_fastapi ~/billing/frontend_react ~/billing/deploy',
    'tar -xzf ~/billing-release.tar.gz -C ~/billing',
    'install -m 600 ~/billing-env ~/billing/deploy/.env',
    # Files edited on Windows may have CRLF line endings, which break .env values and shell scripts
    'sed -i "s/\r$//" ~/billing/deploy/.env ~/billing/deploy/Caddyfile ~/billing/deploy/*.sh',
    'rm -f ~/billing-env ~/billing-release.tar.gz',
    'cd ~/billing/deploy',
    'docker compose up -d --build --remove-orphans',
    'docker image prune -f > /dev/null',
    'docker compose ps'
) -join ' && '
ssh @sshOpts $target $remote
if ($LASTEXITCODE -ne 0) { throw 'Remote deploy failed. See the output above.' }

Remove-Item $archive -ErrorAction SilentlyContinue
$site = (Get-Content $envFile | Where-Object { $_ -match '^SITE_ADDRESS=' }) -replace '^SITE_ADDRESS=', ''
Write-Host ''
Write-Host "Deployed. Open https://$site (the HTTPS certificate can take a minute on first start)."
