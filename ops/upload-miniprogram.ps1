[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [ValidateLength(1, 200)]
  [string]$Description,

  [string]$CliPath = $env:WECHAT_DEVTOOLS_CLI
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $CliPath) {
  $devtools = Get-Process -Name 'wechatdevtools' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($devtools -and $devtools.Path) {
    $CliPath = Join-Path (Split-Path -Parent $devtools.Path) 'cli.bat'
  }
}

if (-not $CliPath -or -not (Test-Path -LiteralPath $CliPath)) {
  throw 'WeChat DevTools cli.bat was not found. Set WECHAT_DEVTOOLS_CLI first.'
}

Push-Location $root
try {
  & npm.cmd run verify:release
  if ($LASTEXITCODE -ne 0) { throw 'Release verification failed. Upload was stopped.' }

  & $CliPath islogin
  if ($LASTEXITCODE -ne 0) {
    throw 'WeChat DevTools is not logged in or its service port is disabled.'
  }

  $releaseDirectory = Join-Path $root '.release'
  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  $infoOutput = Join-Path $releaseDirectory 'miniprogram-upload.json'

  & $CliPath upload `
    --project $root `
    --version $Version `
    --desc $Description `
    --info-output $infoOutput
  if ($LASTEXITCODE -ne 0) { throw 'Mini Program upload failed.' }

  Write-Host "Mini Program $Version uploaded. Details: .release/miniprogram-upload.json"
}
finally {
  Pop-Location
}
