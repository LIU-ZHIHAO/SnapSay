param(
  [switch]$WithLocalAsr,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @()
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
  }
}

function Stop-ProjectElectron {
  $electronPath = Join-Path $Root "node_modules\electron\dist\electron.exe"
  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $electronPath } |
    Stop-Process -Force
}

$runtimeDirs = @(
  "data",
  "logs",
  "cache",
  "models",
  "tmp"
)

foreach ($dir in $runtimeDirs) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Root $dir) | Out-Null
}

$env:npm_config_cache = Join-Path $Root "cache\npm"
$env:PIP_CACHE_DIR = Join-Path $Root "cache\pip"
$env:HF_HOME = Join-Path $Root "cache\huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $Root "cache\huggingface\hub"
$env:MODELSCOPE_CACHE = Join-Path $Root "cache\modelscope"
$env:TORCH_HOME = Join-Path $Root "cache\torch"
$env:XDG_CACHE_HOME = Join-Path $Root "cache"
$env:SNAPSAY_ROOT = $Root

Write-Output "SnapSay setup root: $Root"
Stop-ProjectElectron
Write-Output "Installing npm dependencies..."
Invoke-Checked "npm" @("install")

if ($WithLocalAsr) {
  Write-Output "Installing local SenseVoice ASR dependencies and model..."
  & (Join-Path $Root "scripts\setup-python-asr.ps1") -Root $Root
} else {
  Write-Output "Skipping local ASR setup. Run with -WithLocalAsr to install SenseVoice dependencies and model."
}

if (-not $SkipBuild) {
  Write-Output "Building SnapSay..."
  Invoke-Checked "npm" @("run", "build")
}

Write-Output "Setup complete."
Write-Output "Run the app with: npm run electron"
