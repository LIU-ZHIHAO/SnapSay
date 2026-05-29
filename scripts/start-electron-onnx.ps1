param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Stop-ExistingExperimentProcesses {
  $electronDir = Join-Path $Root "node_modules\electron"
  Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -eq "electron.exe" -and $_.ExecutablePath -like "$electronDir*") -or
      ($_.Name -eq "node.exe" -and $_.CommandLine -like "*$Root*node_modules\electron*") -or
      ($_.Name -eq "python.exe" -and $_.CommandLine -like "*$Root*asr-daemon-onnx.py*")
    } |
    Where-Object { $_.ProcessId -ne $PID } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Stop-ExistingExperimentProcesses

$env:SNAPSAY_ASR_ENGINE = "sensevoice-onnx"
$env:ASR_ONNX_PROVIDER = "auto"
$env:SNAPSAY_ROOT = $Root
$env:PIP_CACHE_DIR = Join-Path $Root "cache\pip"
$env:HF_HOME = Join-Path $Root "cache\huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $Root "cache\huggingface\hub"
$env:MODELSCOPE_CACHE = Join-Path $Root "cache\modelscope"
$env:TORCH_HOME = Join-Path $Root "cache\torch"
$env:XDG_CACHE_HOME = Join-Path $Root "cache"

npm run build
electron .
