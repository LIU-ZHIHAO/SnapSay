param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:SNAPSAY_ASR_ENGINE = "sensevoice-onnx"
$env:SNAPSAY_ROOT = $Root
$env:PIP_CACHE_DIR = Join-Path $Root "cache\pip"
$env:HF_HOME = Join-Path $Root "cache\huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $Root "cache\huggingface\hub"
$env:MODELSCOPE_CACHE = Join-Path $Root "cache\modelscope"
$env:TORCH_HOME = Join-Path $Root "cache\torch"
$env:XDG_CACHE_HOME = Join-Path $Root "cache"

npm run build
electron .
