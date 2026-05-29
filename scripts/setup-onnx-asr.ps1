param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$venv = Join-Path $Root ".venv"
$python = Join-Path $venv "Scripts\python.exe"
$cache = Join-Path $Root "cache"

New-Item -ItemType Directory -Force -Path $cache | Out-Null
$env:PIP_CACHE_DIR = Join-Path $cache "pip"
$env:HF_HOME = Join-Path $cache "huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $cache "huggingface\hub"
$env:MODELSCOPE_CACHE = Join-Path $cache "modelscope"
$env:TORCH_HOME = Join-Path $cache "torch"
$env:XDG_CACHE_HOME = $cache
$env:SNAPSAY_ROOT = $Root

if (-not (Test-Path -LiteralPath $python)) {
  python -m venv $venv
}

& $python -m pip install --upgrade pip
& $python -m pip install --upgrade numpy av onnxruntime-directml

& $python -c "import onnxruntime as ort; print('onnxruntime providers: ' + ', '.join(ort.get_available_providers()))"

Write-Output "python: $python"
