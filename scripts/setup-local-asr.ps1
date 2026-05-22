param(
  [string]$Root = "D:\Antigravity\tailkall",
  [ValidateSet("cuda", "cpu")]
  [string]$Acceleration = "cuda"
)

$ErrorActionPreference = "Stop"

$whisperDir = Join-Path $Root "models\whisper"
New-Item -ItemType Directory -Force -Path $whisperDir | Out-Null

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest"
$assetName = if ($Acceleration -eq "cuda") {
  "whisper-cublas-12.4.0-bin-x64.zip"
} else {
  "whisper-bin-x64.zip"
}
$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
if (-not $asset) {
  throw "Cannot find whisper.cpp release asset: $assetName"
}

$zipPath = Join-Path $whisperDir $asset.name
if (-not (Test-Path -LiteralPath $zipPath)) {
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
}
Expand-Archive -LiteralPath $zipPath -DestinationPath $whisperDir -Force

$modelPath = Join-Path $whisperDir "ggml-small.bin"
if (-not (Test-Path -LiteralPath $modelPath)) {
  Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -OutFile $modelPath
}

Write-Output "whisper.cpp: $(Join-Path $whisperDir 'Release\whisper-cli.exe')"
Write-Output "model: $modelPath"
Write-Output "ffmpeg fallback: system PATH command 'ffmpeg'"
