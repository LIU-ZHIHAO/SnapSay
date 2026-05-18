param(
  [string]$Root = "D:\Antigravity\tailkall"
)

$ErrorActionPreference = "Stop"

$python = Join-Path $Root ".venv\Scripts\python.exe"
$whisper = Join-Path $Root "models\whisper\Release\whisper-cli.exe"
$whisperModel = Join-Path $Root "models\whisper\ggml-small.bin"
$ffmpeg = Join-Path $Root "models\whisper\ffmpeg.exe"
$sample = Join-Path $Root "models\sensevoice\SenseVoiceSmall\example\zh.mp3"
$wav = Join-Path $Root "tmp\asr-smoke.wav"

New-Item -ItemType Directory -Force -Path (Join-Path $Root "tmp") | Out-Null

& $ffmpeg -y -i $sample $wav 2>$null

& $whisper -m $whisperModel -f $wav -l zh -otxt -of (Join-Path $Root "tmp\asr-smoke-whisper") -np
& $python (Join-Path $Root "scripts\asr-faster-whisper.py") --audio $wav --model (Join-Path $Root "models\faster-whisper\small") --out (Join-Path $Root "tmp\asr-smoke-faster.txt") --device auto --language zh
& $python (Join-Path $Root "scripts\asr-sensevoice.py") --audio $wav --model (Join-Path $Root "models\sensevoice\SenseVoiceSmall") --out (Join-Path $Root "tmp\asr-smoke-sensevoice.txt") --device auto --language zh

$results = @(
  Join-Path $Root "tmp\asr-smoke-whisper.txt"
  Join-Path $Root "tmp\asr-smoke-faster.txt"
  Join-Path $Root "tmp\asr-smoke-sensevoice.txt"
)

foreach ($result in $results) {
  $text = Get-Content -LiteralPath $result -Encoding UTF8 -Raw
  if ([string]::IsNullOrWhiteSpace($text)) {
    throw "ASR smoke output is empty: $result"
  }
  Write-Output "$result => $text"
}
