param(
  [string]$Root = "D:\Antigravity\tailkall"
)

$ErrorActionPreference = "Stop"

$venv = Join-Path $Root ".venv"
$python = Join-Path $venv "Scripts\python.exe"
$cache = Join-Path $Root "cache"
$models = Join-Path $Root "models"

New-Item -ItemType Directory -Force -Path $cache, $models | Out-Null
$env:HF_HOME = Join-Path $cache "huggingface"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $cache "huggingface\hub"
$env:MODELSCOPE_CACHE = Join-Path $cache "modelscope"
$env:TORCH_HOME = Join-Path $cache "torch"
$env:XDG_CACHE_HOME = $cache
$env:PIP_CACHE_DIR = Join-Path $cache "pip"

if (-not (Test-Path -LiteralPath $python)) {
  python -m venv $venv
}

& $python -m pip install --upgrade pip
& $python -m pip install huggingface_hub modelscope faster-whisper funasr
& $python -m pip install --upgrade --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu124

$download = @'
import os
from huggingface_hub import snapshot_download
from modelscope import snapshot_download as ms_snapshot_download

root = r"D:\Antigravity\tailkall"
os.environ["HF_HOME"] = os.path.join(root, "cache", "huggingface")
os.environ["HUGGINGFACE_HUB_CACHE"] = os.path.join(root, "cache", "huggingface", "hub")
os.environ["MODELSCOPE_CACHE"] = os.path.join(root, "cache", "modelscope")

snapshot_download(
    repo_id="Systran/faster-whisper-small",
    local_dir=os.path.join(root, "models", "faster-whisper", "small"),
    local_dir_use_symlinks=False,
)

try:
    ms_snapshot_download(
        "iic/SenseVoiceSmall",
        local_dir=os.path.join(root, "models", "sensevoice", "SenseVoiceSmall"),
    )
except Exception:
    snapshot_download(
        repo_id="FunAudioLLM/SenseVoiceSmall",
        local_dir=os.path.join(root, "models", "sensevoice", "SenseVoiceSmall"),
        local_dir_use_symlinks=False,
    )
'@

& $python -c $download

Write-Output "python: $python"
Write-Output "faster-whisper: $(Join-Path $models 'faster-whisper\small')"
Write-Output "sensevoice: $(Join-Path $models 'sensevoice\SenseVoiceSmall')"
