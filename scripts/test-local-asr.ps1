param(
  [string]$Root = "D:\Antigravity\tailkall"
)

$ErrorActionPreference = "Stop"

$python = Join-Path $Root ".venv\Scripts\python.exe"
$ffmpeg = "ffmpeg"
$sample = Join-Path $Root "models\sensevoice\SenseVoiceSmall\example\zh.mp3"
$wav = Join-Path $Root "tmp\asr-smoke.wav"

New-Item -ItemType Directory -Force -Path (Join-Path $Root "tmp") | Out-Null

& $ffmpeg -y -i $sample $wav 2>$null

& $python (Join-Path $Root "scripts\asr-sensevoice.py") --audio $wav --model (Join-Path $Root "models\sensevoice\SenseVoiceSmall") --out (Join-Path $Root "tmp\asr-smoke-sensevoice.txt") --device auto --language zh

$results = @(
  Join-Path $Root "tmp\asr-smoke-sensevoice.txt"
)

foreach ($result in $results) {
  $text = Get-Content -LiteralPath $result -Encoding UTF8 -Raw
  if ([string]::IsNullOrWhiteSpace($text)) {
    throw "ASR smoke output is empty: $result"
  }
  Write-Output "$result => $text"
}
