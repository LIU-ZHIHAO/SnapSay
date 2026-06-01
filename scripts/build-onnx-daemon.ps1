param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$daemonScript = Join-Path $Root "scripts\asr-daemon-onnx.py"
$releaseRoot = Join-Path $Root "release"
$daemonDist = Join-Path $releaseRoot "asr-daemon-onnx"
$buildRoot = Join-Path $Root "tmp\pyinstaller-asr-daemon-onnx"
$cacheRoot = Join-Path $Root "cache"

if (-not (Test-Path -LiteralPath $daemonScript)) {
  throw "ONNX daemon script not found: $daemonScript"
}

New-Item -ItemType Directory -Force -Path $daemonDist, $buildRoot, $cacheRoot | Out-Null

$env:SNAPSAY_ROOT = $Root
$env:XDG_CACHE_HOME = $cacheRoot
$env:PIP_CACHE_DIR = Join-Path $cacheRoot "pip"
$env:HF_HOME = Join-Path $cacheRoot "huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $cacheRoot "huggingface\hub"
$env:MODELSCOPE_CACHE = Join-Path $cacheRoot "modelscope"
$env:PYINSTALLER_CONFIG_DIR = Join-Path $cacheRoot "pyinstaller"

$python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  $python = "python"
}

& $python -m pip install --upgrade pyinstaller numpy av kaldi-native-fbank onnxruntime-directml

if (Test-Path -LiteralPath $daemonDist) {
  Remove-Item -LiteralPath $daemonDist -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $daemonDist | Out-Null

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name asr-daemon-onnx `
  --distpath $releaseRoot `
  --workpath $buildRoot `
  --specpath $buildRoot `
  --collect-all av `
  --collect-all kaldi_native_fbank `
  --collect-all onnxruntime `
  --hidden-import numpy `
  --exclude-module funasr `
  --exclude-module modelscope `
  --exclude-module torch `
  --exclude-module torchaudio `
  --exclude-module torchvision `
  --exclude-module scipy `
  --exclude-module numba `
  --exclude-module llvmlite `
  --exclude-module sklearn `
  --exclude-module tensorboard `
  --exclude-module transformers `
  $daemonScript

$daemonExe = Join-Path $daemonDist "asr-daemon-onnx.exe"
if (-not (Test-Path -LiteralPath $daemonExe)) {
  throw "Failed to build ONNX daemon executable: $daemonExe"
}

Write-Output "ONNX daemon executable: $daemonExe"
